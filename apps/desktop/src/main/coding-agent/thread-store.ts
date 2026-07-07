/**
 * 本文件实现 Electron main 侧轻量 thread metadata registry。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  ApprovalRequest,
  ApprovalResponse,
  ListThreadsInput,
  ThreadSummary
} from '@shared/coding-agent/types'
import { getDesktopAgentDir } from './agent-dir'

/** Thread metadata 文件结构。 */
interface ThreadMetadataFile {
  /** schema version。 */
  version: 1
  /** Thread 摘要列表。 */
  threads: ThreadSummary[]
}

/** 工具调用投影记录。 */
export interface ToolCallRecord {
  threadId: string
  toolCallId: string
  toolName: string
  status: string
  args?: unknown
  resultSummary?: string
  startedAt?: string
  finishedAt?: string
}

/** 文件变更投影记录。 */
export interface FileChangeRecord {
  threadId: string
  toolCallId?: string
  path: string
  changeType: string
  diff?: string
  patch?: string
  additions?: number
  deletions?: number
  firstChangedLine?: number
  createdAt?: string
}

/** 审批投影记录。 */
export interface ApprovalRecord {
  approvalId: string
  threadId: string
  status: string
  request: ApprovalRequest
  response?: ApprovalResponse
  createdAt?: string
  resolvedAt?: string
}

/** worker run 记录。 */
export interface WorkerRunRecord {
  workerId: string
  threadId?: string
  status: string
  pidHash?: string
  startedAt?: string
  exitedAt?: string
  exitCode?: number
  signal?: string
  stderrTail?: string
}

/** 诊断记录。 */
export interface DiagnosticRecord {
  id?: string
  threadId?: string
  source: string
  severity: string
  message: string
  details?: unknown
  createdAt?: string
}

/** ThreadStore 构造选项。 */
export interface CodingThreadStoreOptions {
  /** 是否自动保存 thread metadata 到文件。 */
  persist?: boolean
}

/**
 * Electron main 侧 thread metadata registry。
 */
export class CodingThreadStore {
  private readonly metadataPath: string | undefined
  private readonly persist: boolean
  private readonly threads = new Map<string, ThreadSummary>()
  private readonly toolCalls: ToolCallRecord[] = []
  private readonly fileChanges: FileChangeRecord[] = []
  private readonly approvals = new Map<string, ApprovalRecord>()
  private readonly workerRuns: WorkerRunRecord[] = []
  private readonly diagnostics: Array<DiagnosticRecord & { id: string; createdAt: string }> = []

  /**
   * 创建 CodingThreadStore 实例。
   * @param metadataPath - metadata JSON 文件路径；传 ':memory:' 使用内存 registry。
   * @param options - 构造选项。
   */
  constructor(metadataPath = defaultThreadMetadataPath(), options: CodingThreadStoreOptions = {}) {
    this.metadataPath = metadataPath === ':memory:' ? undefined : metadataPath
    this.persist = options.persist ?? metadataPath !== ':memory:'
    this.load()
  }

  /**
   * 保存线程摘要。
   * @param thread - 线程摘要。
   */
  saveThread(thread: ThreadSummary): void {
    this.threads.set(thread.threadId, thread)
    this.flush()
  }

  /**
   * 列出线程摘要。
   * @param input - 可选过滤条件。
   * @returns 线程摘要列表，按 updated_at 降序。
   */
  listThreads(input: ListThreadsInput = {}): ThreadSummary[] {
    const includeArchived = input.archived === true
    return [...this.threads.values()]
      .filter((thread) => !input.projectId || thread.projectId === input.projectId)
      .filter((thread) => Boolean(thread.archivedAt) === includeArchived)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  recordToolCall(record: ToolCallRecord): void {
    const existing = this.toolCalls.findIndex(
      (item) => item.threadId === record.threadId && item.toolCallId === record.toolCallId
    )
    if (existing >= 0) {
      this.toolCalls[existing] = { ...this.toolCalls[existing], ...record }
      return
    }
    this.toolCalls.push({ ...record, startedAt: record.startedAt ?? new Date().toISOString() })
  }

  listToolCalls(threadId: string): ToolCallRecord[] {
    return this.toolCalls
      .filter((record) => record.threadId === threadId)
      .sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? ''))
  }

  recordFileChange(record: FileChangeRecord): void {
    this.fileChanges.push({ ...record, createdAt: record.createdAt ?? new Date().toISOString() })
  }

  listFileChanges(threadId: string): FileChangeRecord[] {
    return this.fileChanges
      .filter((record) => record.threadId === threadId)
      .sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''))
  }

  recordApprovalRequest(record: ApprovalRecord): void {
    this.approvals.set(record.approvalId, {
      ...record,
      createdAt: record.createdAt ?? new Date().toISOString()
    })
  }

  resolveApproval(approvalId: string, response: ApprovalResponse, status = 'resolved'): void {
    const record = this.approvals.get(approvalId)
    if (!record) {
      return
    }
    this.approvals.set(approvalId, {
      ...record,
      status,
      response,
      resolvedAt: new Date().toISOString()
    })
  }

  listApprovals(input: { threadId?: string; status?: string } = {}): ApprovalRecord[] {
    return [...this.approvals.values()]
      .filter((record) => !input.threadId || record.threadId === input.threadId)
      .filter((record) => !input.status || record.status === input.status)
      .sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''))
  }

  recordWorkerRun(record: WorkerRunRecord): void {
    this.workerRuns.push({ ...record, startedAt: record.startedAt ?? new Date().toISOString() })
  }

  finishWorkerRun(
    input: { workerId: string; startedAt: string } & Partial<
      Pick<WorkerRunRecord, 'status' | 'exitedAt' | 'exitCode' | 'signal' | 'stderrTail'>
    >
  ): void {
    const record = this.workerRuns.find(
      (item) => item.workerId === input.workerId && item.startedAt === input.startedAt
    )
    if (!record) {
      return
    }
    Object.assign(record, {
      status: input.status ?? 'exited',
      exitedAt: input.exitedAt ?? new Date().toISOString(),
      exitCode: input.exitCode,
      signal: input.signal,
      stderrTail: input.stderrTail
    })
  }

  listWorkerRuns(input: { threadId?: string; workerId?: string } = {}): WorkerRunRecord[] {
    return this.workerRuns
      .filter((record) => !input.threadId || record.threadId === input.threadId)
      .filter((record) => !input.workerId || record.workerId === input.workerId)
      .sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? ''))
  }

  recordDiagnostic(record: DiagnosticRecord): DiagnosticRecord & { id: string; createdAt: string } {
    const diagnostic = {
      ...record,
      id: record.id ?? crypto.randomUUID(),
      createdAt: record.createdAt ?? new Date().toISOString()
    }
    const existing = this.diagnostics.findIndex((item) => item.id === diagnostic.id)
    if (existing >= 0) {
      this.diagnostics[existing] = diagnostic
      return diagnostic
    }
    this.diagnostics.push(diagnostic)
    return diagnostic
  }

  listDiagnostics(input: { threadId?: string; source?: string } = {}): DiagnosticRecord[] {
    return this.diagnostics
      .filter((record) => !input.threadId || record.threadId === input.threadId)
      .filter((record) => !input.source || record.source === input.source)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /**
   * 关闭 store。
   */
  close(): void {
    this.flush()
  }

  /** 从 metadata 文件加载。 */
  private load(): void {
    if (!this.metadataPath || !existsSync(this.metadataPath)) {
      return
    }
    const metadata = JSON.parse(readFileSync(this.metadataPath, 'utf8')) as ThreadMetadataFile

    for (const thread of metadata.threads ?? []) {
      this.threads.set(thread.threadId, thread)
    }
  }

  /** 写入 metadata 文件。 */
  private flush(): void {
    if (!this.persist || !this.metadataPath) {
      return
    }
    mkdirSync(dirname(this.metadataPath), { recursive: true })
    const metadata: ThreadMetadataFile = {
      version: 1,
      threads: [...this.threads.values()]
    }
    writeFileSync(this.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  }
}

function defaultThreadMetadataPath(): string {
  return join(getDesktopAgentDir(), 'threads.json')
}
