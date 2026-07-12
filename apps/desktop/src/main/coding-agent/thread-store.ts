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

type StoredDiagnosticRecord = DiagnosticRecord & { id: string; createdAt: string }

/** Thread registry 及其 main 侧投影记录的可恢复快照。 */
export interface CodingThreadStoreSnapshot {
  threads: ThreadSummary[]
  toolCalls: ToolCallRecord[]
  fileChanges: FileChangeRecord[]
  approvals: ApprovalRecord[]
  workerRuns: WorkerRunRecord[]
  diagnostics: StoredDiagnosticRecord[]
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
  private readonly diagnostics: StoredDiagnosticRecord[] = []

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
   * 删除指定 Project 的全部 thread metadata（包含已归档 thread）。
   * @param projectId - Project ID。
   * @returns 删除的 thread ID。
   */
  deleteThreadsByProject(projectId: string): string[] {
    const snapshot = this.createSnapshot()
    const threadIds = [...this.threads.values()]
      .filter((thread) => thread.projectId === projectId)
      .map((thread) => thread.threadId)
    const deletedThreadIds = new Set(threadIds)
    for (const threadId of threadIds) {
      this.threads.delete(threadId)
    }
    this.toolCalls.splice(
      0,
      this.toolCalls.length,
      ...this.toolCalls.filter((record) => !deletedThreadIds.has(record.threadId))
    )
    this.fileChanges.splice(
      0,
      this.fileChanges.length,
      ...this.fileChanges.filter((record) => !deletedThreadIds.has(record.threadId))
    )
    for (const [approvalId, record] of this.approvals) {
      if (deletedThreadIds.has(record.threadId)) {
        this.approvals.delete(approvalId)
      }
    }
    this.workerRuns.splice(
      0,
      this.workerRuns.length,
      ...this.workerRuns.filter(
        (record) => !record.threadId || !deletedThreadIds.has(record.threadId)
      )
    )
    this.diagnostics.splice(
      0,
      this.diagnostics.length,
      ...this.diagnostics.filter(
        (record) => !record.threadId || !deletedThreadIds.has(record.threadId)
      )
    )
    try {
      this.flush()
    } catch (error) {
      try {
        this.restoreSnapshot(snapshot)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `failed to delete and restore Project thread metadata: ${projectId}`
        )
      }
      throw error
    }
    return threadIds
  }

  /**
   * 创建 thread registry 及其 main 侧投影记录快照。
   * @returns 可用于事务回滚的完整快照。
   */
  createSnapshot(): CodingThreadStoreSnapshot {
    return {
      threads: [...this.threads.values()].map((thread) => ({ ...thread })),
      toolCalls: this.toolCalls.map((record) => ({ ...record })),
      fileChanges: this.fileChanges.map((record) => ({ ...record })),
      approvals: [...this.approvals.values()].map((record) => ({ ...record })),
      workerRuns: this.workerRuns.map((record) => ({ ...record })),
      diagnostics: this.diagnostics.map((record) => ({ ...record }))
    }
  }

  /**
   * 恢复完整 thread store 快照，并同步写回 metadata 文件。
   * 即使写盘失败，main 内存也会保持为待恢复状态。
   * @param snapshot - 事务开始前的快照。
   */
  restoreSnapshot(snapshot: CodingThreadStoreSnapshot): void {
    this.restoreSnapshotInMemory(snapshot)
    this.flush()
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

  dismissApproval(approvalId: string): void {
    const record = this.approvals.get(approvalId)
    if (!record) {
      return
    }
    this.approvals.set(approvalId, {
      ...record,
      status: 'dismissed',
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

  /** 只恢复内存数据，供 restoreSnapshot 保证失败时的内存一致性。 */
  private restoreSnapshotInMemory(snapshot: CodingThreadStoreSnapshot): void {
    this.threads.clear()
    for (const thread of snapshot.threads) {
      this.threads.set(thread.threadId, { ...thread })
    }
    this.toolCalls.splice(
      0,
      this.toolCalls.length,
      ...snapshot.toolCalls.map((record) => ({ ...record }))
    )
    this.fileChanges.splice(
      0,
      this.fileChanges.length,
      ...snapshot.fileChanges.map((record) => ({ ...record }))
    )
    this.approvals.clear()
    for (const record of snapshot.approvals) {
      this.approvals.set(record.approvalId, { ...record })
    }
    this.workerRuns.splice(
      0,
      this.workerRuns.length,
      ...snapshot.workerRuns.map((record) => ({ ...record }))
    )
    this.diagnostics.splice(
      0,
      this.diagnostics.length,
      ...snapshot.diagnostics.map((record) => ({ ...record }))
    )
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
