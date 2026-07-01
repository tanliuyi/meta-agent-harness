/**
 * 本文件实现 Electron main 侧 SQLite thread registry 与 snapshot store。
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ThreadSnapshot, ThreadSummary } from '../../shared/coding-agent/types'

/** 数据库 threads 表行。 */
interface ThreadRow {
  /** 摘要 JSON 字符串。 */
  summary_json: string
}

/** 数据库 thread_snapshots 表行。 */
interface SnapshotRow {
  /** 快照 JSON 字符串。 */
  snapshot_json: string
}

/** 消息索引记录。 */
export interface MessageIndexRecord {
  /** 线程 ID。 */
  threadId: string
  /** canonical session entry ID。 */
  sessionEntryId: string
  /** 消息角色。 */
  role: string
  /** 摘要文本。 */
  summary?: string
  /** 创建时间。 */
  createdAt?: string
}

/** 工具调用投影记录。 */
export interface ToolCallRecord {
  /** 线程 ID。 */
  threadId: string
  /** 工具调用 ID。 */
  toolCallId: string
  /** 工具名称。 */
  toolName: string
  /** 调用状态。 */
  status: string
  /** 参数 JSON。 */
  args?: unknown
  /** 结果摘要。 */
  resultSummary?: string
  /** 开始时间。 */
  startedAt?: string
  /** 结束时间。 */
  finishedAt?: string
}

/** 文件变更投影记录。 */
export interface FileChangeRecord {
  /** 线程 ID。 */
  threadId: string
  /** 关联工具调用 ID。 */
  toolCallId?: string
  /** 文件路径。 */
  path: string
  /** 变更类型。 */
  changeType: string
  /** 可选 patch。 */
  patch?: string
  /** 创建时间。 */
  createdAt?: string
}

/** 审批投影记录。 */
export interface ApprovalRecord {
  /** 审批 ID。 */
  approvalId: string
  /** 线程 ID。 */
  threadId: string
  /** 审批状态。 */
  status: string
  /** 请求体。 */
  request: unknown
  /** 响应体。 */
  response?: unknown
  /** 创建时间。 */
  createdAt?: string
  /** 解决时间。 */
  resolvedAt?: string
}

/** worker run 记录。 */
export interface WorkerRunRecord {
  /** Worker ID。 */
  workerId: string
  /** 线程 ID。 */
  threadId?: string
  /** 运行状态。 */
  status: string
  /** 脱敏后的 pid。 */
  pidHash?: string
  /** 启动时间。 */
  startedAt?: string
  /** 退出时间。 */
  exitedAt?: string
  /** 退出码。 */
  exitCode?: number
  /** 退出 signal。 */
  signal?: string
  /** stderr 尾部。 */
  stderrTail?: string
}

/** 诊断记录。 */
export interface DiagnosticRecord {
  /** 诊断 ID。 */
  id?: string
  /** 线程 ID。 */
  threadId?: string
  /** 来源。 */
  source: string
  /** 严重程度。 */
  severity: string
  /** 消息。 */
  message: string
  /** 结构化详情。 */
  details?: unknown
  /** 创建时间。 */
  createdAt?: string
}

/** ThreadStore 构造选项。 */
export interface CodingThreadStoreOptions {
  /** 是否拥有数据库连接；拥有时 close 会关闭连接。 */
  ownsDb?: boolean
}

/**
 * Electron main 侧 SQLite thread registry 与 snapshot store。
 */
export class CodingThreadStore {
  private readonly db: DatabaseSync
  private readonly ownsDb: boolean

  /**
   * 创建 CodingThreadStore 实例。
   * @param dbOrPath - SQLite 数据库路径或已有连接；传 ':memory:' 使用内存数据库。
   * @param options - 构造选项。
   */
  constructor(dbOrPath: DatabaseSync | string, options: CodingThreadStoreOptions = {}) {
    if (typeof dbOrPath === 'string') {
      if (dbOrPath !== ':memory:') {
        mkdirSync(dirname(dbOrPath), { recursive: true })
      }
      this.db = new DatabaseSync(dbOrPath)
      this.ownsDb = options.ownsDb ?? true
    } else {
      this.db = dbOrPath
      this.ownsDb = options.ownsDb ?? false
    }
    migrateThreadSchema(this.db)
  }

  /**
   * 保存线程摘要。
   * @param thread - 线程摘要。
   */
  saveThread(thread: ThreadSummary): void {
    this.db
      .prepare(
        `insert into threads(thread_id, project_id, summary_json, updated_at)
         values (?, ?, ?, ?)
         on conflict(thread_id) do update set
           project_id = excluded.project_id,
           summary_json = excluded.summary_json,
           updated_at = excluded.updated_at`
      )
      .run(thread.threadId, thread.projectId, JSON.stringify(thread), thread.updatedAt)
  }

  /**
   * 保存线程快照。
   * @param snapshot - 线程快照。
   */
  saveSnapshot(snapshot: ThreadSnapshot): void {
    this.db
      .prepare(
        `insert into thread_snapshots(thread_id, snapshot_json, updated_at)
         values (?, ?, ?)
         on conflict(thread_id) do update set
           snapshot_json = excluded.snapshot_json,
           updated_at = excluded.updated_at`
      )
      .run(snapshot.threadId, JSON.stringify(snapshot), new Date().toISOString())
  }

  /**
   * 获取线程快照。
   * @param threadId - 线程 ID。
   * @returns 线程快照或 undefined。
   */
  getSnapshot(threadId: string): ThreadSnapshot | undefined {
    const row = this.db
      .prepare('select snapshot_json from thread_snapshots where thread_id = ?')
      .get(threadId) as SnapshotRow | undefined
    return row ? (JSON.parse(row.snapshot_json) as ThreadSnapshot) : undefined
  }

  /**
   * 列出线程摘要。
   * @param input - 可选过滤条件。
   * @returns 线程摘要列表，按 updated_at 降序。
   */
  listThreads(input: { projectId?: string } = {}): ThreadSummary[] {
    const rows = (
      input.projectId
        ? this.db
            .prepare('select summary_json from threads where project_id = ? order by updated_at desc')
            .all(input.projectId)
        : this.db.prepare('select summary_json from threads order by updated_at desc').all()
    ) as unknown as ThreadRow[]
    return rows.map((row) => JSON.parse(row.summary_json) as ThreadSummary)
  }

  /**
   * 保存消息索引。
   * @param record - 消息索引记录。
   */
  saveMessageIndex(record: MessageIndexRecord): void {
    this.db
      .prepare(
        `insert into message_index(thread_id, session_entry_id, role, summary, created_at)
         values (?, ?, ?, ?, ?)
         on conflict(thread_id, session_entry_id) do update set
           role = excluded.role,
           summary = excluded.summary,
           created_at = excluded.created_at`
      )
      .run(
        record.threadId,
        record.sessionEntryId,
        record.role,
        record.summary ?? null,
        record.createdAt ?? new Date().toISOString()
      )
  }

  /**
   * 列出线程消息索引。
   * @param threadId - 线程 ID。
   * @returns 消息索引记录。
   */
  listMessageIndex(threadId: string): MessageIndexRecord[] {
    const rows = this.db
      .prepare(
        `select thread_id, session_entry_id, role, summary, created_at
         from message_index where thread_id = ? order by created_at asc`
      )
      .all(threadId) as unknown as MessageIndexRow[]
    return rows.map((row) => ({
      threadId: row.thread_id,
      sessionEntryId: row.session_entry_id,
      role: row.role,
      summary: row.summary ?? undefined,
      createdAt: row.created_at
    }))
  }

  /**
   * 保存工具调用投影。
   * @param record - 工具调用记录。
   */
  saveToolCall(record: ToolCallRecord): void {
    this.db
      .prepare(
        `insert into tool_calls(
           thread_id, tool_call_id, tool_name, status, args_json,
           result_summary, started_at, finished_at
         )
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(thread_id, tool_call_id) do update set
           tool_name = excluded.tool_name,
           status = excluded.status,
           args_json = excluded.args_json,
           result_summary = excluded.result_summary,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at`
      )
      .run(
        record.threadId,
        record.toolCallId,
        record.toolName,
        record.status,
        stringifyOptionalJson(record.args),
        record.resultSummary ?? null,
        record.startedAt ?? new Date().toISOString(),
        record.finishedAt ?? null
      )
  }

  /**
   * 列出线程工具调用。
   * @param threadId - 线程 ID。
   * @returns 工具调用记录。
   */
  listToolCalls(threadId: string): ToolCallRecord[] {
    const rows = this.db
      .prepare(
        `select thread_id, tool_call_id, tool_name, status, args_json,
                result_summary, started_at, finished_at
         from tool_calls where thread_id = ? order by started_at asc`
      )
      .all(threadId) as unknown as ToolCallRow[]
    return rows.map((row) => ({
      threadId: row.thread_id,
      toolCallId: row.tool_call_id,
      toolName: row.tool_name,
      status: row.status,
      args: parseOptionalJson(row.args_json),
      resultSummary: row.result_summary ?? undefined,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined
    }))
  }

  /**
   * 保存文件变更投影。
   * @param record - 文件变更记录。
   */
  saveFileChange(record: FileChangeRecord): void {
    this.db
      .prepare(
        `insert into file_changes(thread_id, tool_call_id, path, change_type, patch, created_at)
         values (?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.threadId,
        record.toolCallId ?? null,
        record.path,
        record.changeType,
        record.patch ?? null,
        record.createdAt ?? new Date().toISOString()
      )
  }

  /**
   * 列出线程文件变更。
   * @param threadId - 线程 ID。
   * @returns 文件变更记录。
   */
  listFileChanges(threadId: string): FileChangeRecord[] {
    const rows = this.db
      .prepare(
        `select thread_id, tool_call_id, path, change_type, patch, created_at
         from file_changes where thread_id = ? order by created_at asc`
      )
      .all(threadId) as unknown as FileChangeRow[]
    return rows.map((row) => ({
      threadId: row.thread_id,
      toolCallId: row.tool_call_id ?? undefined,
      path: row.path,
      changeType: row.change_type,
      patch: row.patch ?? undefined,
      createdAt: row.created_at
    }))
  }

  /**
   * 保存审批请求投影。
   * @param record - 审批记录。
   */
  saveApprovalRequest(record: ApprovalRecord): void {
    this.db
      .prepare(
        `insert into approvals(
           approval_id, thread_id, status, request_json, response_json, created_at, resolved_at
         )
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(approval_id) do update set
           thread_id = excluded.thread_id,
           status = excluded.status,
           request_json = excluded.request_json,
           response_json = excluded.response_json,
           created_at = excluded.created_at,
           resolved_at = excluded.resolved_at`
      )
      .run(
        record.approvalId,
        record.threadId,
        record.status,
        JSON.stringify(record.request),
        stringifyOptionalJson(record.response),
        record.createdAt ?? new Date().toISOString(),
        record.resolvedAt ?? null
      )
  }

  /**
   * 解决审批请求。
   * @param approvalId - 审批 ID。
   * @param response - 审批响应。
   * @param status - 解决后的状态。
   */
  resolveApproval(approvalId: string, response: unknown, status = 'resolved'): void {
    this.db
      .prepare(
        `update approvals
         set status = ?, response_json = ?, resolved_at = ?
         where approval_id = ?`
      )
      .run(status, JSON.stringify(response), new Date().toISOString(), approvalId)
  }

  /**
   * 列出审批记录。
   * @param input - 过滤条件。
   * @returns 审批记录。
   */
  listApprovals(input: { threadId?: string; status?: string } = {}): ApprovalRecord[] {
    const rows = selectWithOptionalFilters<ApprovalRow>(
      this.db,
      `select approval_id, thread_id, status, request_json, response_json, created_at, resolved_at
       from approvals`,
      [
        ['thread_id', input.threadId],
        ['status', input.status]
      ],
      'created_at asc'
    )
    return rows.map((row) => ({
      approvalId: row.approval_id,
      threadId: row.thread_id,
      status: row.status,
      request: JSON.parse(row.request_json),
      response: parseOptionalJson(row.response_json),
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined
    }))
  }

  /**
   * 保存 worker run 记录。
   * @param record - worker run。
   */
  saveWorkerRun(record: WorkerRunRecord): void {
    this.db
      .prepare(
        `insert into worker_runs(
           worker_id, thread_id, status, pid_hash, started_at,
           exited_at, exit_code, signal, stderr_tail
         )
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(worker_id, started_at) do update set
           thread_id = excluded.thread_id,
           status = excluded.status,
           pid_hash = excluded.pid_hash,
           exited_at = excluded.exited_at,
           exit_code = excluded.exit_code,
           signal = excluded.signal,
           stderr_tail = excluded.stderr_tail`
      )
      .run(
        record.workerId,
        record.threadId ?? null,
        record.status,
        record.pidHash ?? null,
        record.startedAt ?? new Date().toISOString(),
        record.exitedAt ?? null,
        record.exitCode ?? null,
        record.signal ?? null,
        record.stderrTail ?? null
      )
  }

  /**
   * 完成 worker run。
   * @param input - worker run 完成信息。
   */
  finishWorkerRun(
    input: { workerId: string; startedAt: string } &
      Partial<Pick<WorkerRunRecord, 'status' | 'exitedAt' | 'exitCode' | 'signal' | 'stderrTail'>>
  ): void {
    this.db
      .prepare(
        `update worker_runs
         set status = ?, exited_at = ?, exit_code = ?, signal = ?, stderr_tail = ?
         where worker_id = ? and started_at = ?`
      )
      .run(
        input.status ?? 'exited',
        input.exitedAt ?? new Date().toISOString(),
        input.exitCode ?? null,
        input.signal ?? null,
        input.stderrTail ?? null,
        input.workerId,
        input.startedAt
      )
  }

  /**
   * 列出 worker run。
   * @param input - 过滤条件。
   * @returns worker run 记录。
   */
  listWorkerRuns(input: { threadId?: string; workerId?: string } = {}): WorkerRunRecord[] {
    const rows = selectWithOptionalFilters<WorkerRunRow>(
      this.db,
      `select worker_id, thread_id, status, pid_hash, started_at,
              exited_at, exit_code, signal, stderr_tail
       from worker_runs`,
      [
        ['thread_id', input.threadId],
        ['worker_id', input.workerId]
      ],
      'started_at asc'
    )
    return rows.map((row) => ({
      workerId: row.worker_id,
      threadId: row.thread_id ?? undefined,
      status: row.status,
      pidHash: row.pid_hash ?? undefined,
      startedAt: row.started_at,
      exitedAt: row.exited_at ?? undefined,
      exitCode: row.exit_code ?? undefined,
      signal: row.signal ?? undefined,
      stderrTail: row.stderr_tail ?? undefined
    }))
  }

  /**
   * 保存诊断记录。
   * @param record - 诊断记录。
   */
  saveDiagnostic(record: DiagnosticRecord): DiagnosticRecord & { id: string; createdAt: string } {
    const id = record.id ?? crypto.randomUUID()
    const createdAt = record.createdAt ?? new Date().toISOString()
    this.db
      .prepare(
        `insert into diagnostics(id, thread_id, source, severity, message, details_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           thread_id = excluded.thread_id,
           source = excluded.source,
           severity = excluded.severity,
           message = excluded.message,
           details_json = excluded.details_json,
           created_at = excluded.created_at`
      )
      .run(
        id,
        record.threadId ?? null,
        record.source,
        record.severity,
        record.message,
        stringifyOptionalJson(record.details),
        createdAt
      )
    return { ...record, id, createdAt }
  }

  /**
   * 列出诊断记录。
   * @param input - 过滤条件。
   * @returns 诊断记录。
   */
  listDiagnostics(input: { threadId?: string; source?: string } = {}): DiagnosticRecord[] {
    const rows = selectWithOptionalFilters<DiagnosticRow>(
      this.db,
      `select id, thread_id, source, severity, message, details_json, created_at
       from diagnostics`,
      [
        ['thread_id', input.threadId],
        ['source', input.source]
      ],
      'created_at asc'
    )
    return rows.map((row) => ({
      id: row.id,
      threadId: row.thread_id ?? undefined,
      source: row.source,
      severity: row.severity,
      message: row.message,
      details: parseOptionalJson(row.details_json),
      createdAt: row.created_at
    }))
  }

  /**
   * 关闭数据库连接。
   */
  close(): void {
    if (this.ownsDb) {
      this.db.close()
    }
  }
}

/**
 * 初始化 thread schema。
 * @param db - SQLite 数据库连接。
 */
function migrateThreadSchema(db: DatabaseSync): void {
  const threadColumns = db
    .prepare("select name from pragma_table_info('threads')")
    .all() as unknown as Array<{ name: string }>
  if (threadColumns.length > 0 && !threadColumns.some((column) => column.name === 'project_id')) {
    db.exec(`
      drop table if exists thread_snapshots;
      drop table if exists threads;
    `)
  }
  db.exec(`
    create table if not exists schema_meta (
      key text primary key,
      value text not null
    );
    create table if not exists threads (
      thread_id text primary key,
      project_id text not null,
      summary_json text not null,
      updated_at text not null
    );
    create index if not exists idx_threads_project_id
      on threads(project_id);
    create table if not exists thread_snapshots (
      thread_id text primary key,
      snapshot_json text not null,
      updated_at text not null
    );
    create table if not exists message_index (
      thread_id text not null,
      session_entry_id text not null,
      role text not null,
      summary text,
      created_at text not null,
      primary key(thread_id, session_entry_id)
    );
    create table if not exists tool_calls (
      thread_id text not null,
      tool_call_id text not null,
      tool_name text not null,
      status text not null,
      args_json text,
      result_summary text,
      started_at text not null,
      finished_at text,
      primary key(thread_id, tool_call_id)
    );
    create table if not exists file_changes (
      thread_id text not null,
      tool_call_id text,
      path text not null,
      change_type text not null,
      patch text,
      created_at text not null
    );
    create table if not exists approvals (
      approval_id text primary key,
      thread_id text not null,
      status text not null,
      request_json text not null,
      response_json text,
      created_at text not null,
      resolved_at text
    );
    create table if not exists worker_runs (
      worker_id text not null,
      thread_id text,
      status text not null,
      pid_hash text,
      started_at text not null,
      exited_at text,
      exit_code integer,
      signal text,
      stderr_tail text,
      primary key(worker_id, started_at)
    );
    create table if not exists diagnostics (
      id text primary key,
      thread_id text,
      source text not null,
      severity text not null,
      message text not null,
      details_json text,
      created_at text not null
    );
    insert into schema_meta(key, value)
      values ('desktop_schema_version', '2')
      on conflict(key) do update set value = excluded.value;
  `)
}

/** message_index 表行。 */
interface MessageIndexRow {
  thread_id: string
  session_entry_id: string
  role: string
  summary: string | null
  created_at: string
}

/** tool_calls 表行。 */
interface ToolCallRow {
  thread_id: string
  tool_call_id: string
  tool_name: string
  status: string
  args_json: string | null
  result_summary: string | null
  started_at: string
  finished_at: string | null
}

/** file_changes 表行。 */
interface FileChangeRow {
  thread_id: string
  tool_call_id: string | null
  path: string
  change_type: string
  patch: string | null
  created_at: string
}

/** approvals 表行。 */
interface ApprovalRow {
  approval_id: string
  thread_id: string
  status: string
  request_json: string
  response_json: string | null
  created_at: string
  resolved_at: string | null
}

/** worker_runs 表行。 */
interface WorkerRunRow {
  worker_id: string
  thread_id: string | null
  status: string
  pid_hash: string | null
  started_at: string
  exited_at: string | null
  exit_code: number | null
  signal: string | null
  stderr_tail: string | null
}

/** diagnostics 表行。 */
interface DiagnosticRow {
  id: string
  thread_id: string | null
  source: string
  severity: string
  message: string
  details_json: string | null
  created_at: string
}

/**
 * 序列化可选 JSON。
 * @param value - 任意值。
 * @returns JSON 字符串或 null。
 */
function stringifyOptionalJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

/**
 * 解析可选 JSON。
 * @param value - JSON 字符串或 null。
 * @returns 解析后的值。
 */
function parseOptionalJson(value: string | null): unknown {
  return value === null ? undefined : JSON.parse(value)
}

/**
 * 根据可选字段拼接简单 select。
 * @param db - 数据库连接。
 * @param sql - 基础 SQL。
 * @param filters - 可选过滤器。
 * @param orderBy - 排序字段。
 * @returns 查询结果。
 */
function selectWithOptionalFilters<T>(
  db: DatabaseSync,
  sql: string,
  filters: Array<[string, string | undefined]>,
  orderBy: string
): T[] {
  const activeFilters = filters.filter((filter): filter is [string, string] => Boolean(filter[1]))
  const where = activeFilters.map(([column]) => `${column} = ?`).join(' and ')
  const statement = `${sql}${where ? ` where ${where}` : ''} order by ${orderBy}`
  return db.prepare(statement).all(...activeFilters.map(([, value]) => value)) as unknown as T[]
}
