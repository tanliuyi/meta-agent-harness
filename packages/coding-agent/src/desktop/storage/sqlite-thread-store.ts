/**
 * 实现基于 Node SQLite 的 desktop thread 索引 store。
 */

import { dirname } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { ThreadId } from '../protocol/identity.ts'
import type { ThreadSnapshot } from '../protocol/snapshot.ts'
import type { ThreadSummary } from '../protocol/thread.ts'
import type { ThreadStore } from './thread-store.ts'

interface ThreadRow {
  /** Thread ID。 */
  thread_id: string
  /** 摘要 JSON 字符串。 */
  summary_json: string
  /** 归档时间，未归档时为 null。 */
  archived_at: string | null
  /** 更新时间。 */
  updated_at: string
}

interface SnapshotRow {
  /** Snapshot JSON 字符串。 */
  snapshot_json: string
}

/**
 * 基于 Node SQLite 的 ThreadStore 实现。
 */
export class SqliteThreadStore implements ThreadStore {
  private readonly db: DatabaseSync

  /**
   * 创建或打开 SQLite thread store。
   * @param dbPath - 数据库文件路径，传入 ':memory:' 时使用内存数据库。
   */
  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const dir = dirname(dbPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
    this.db = new DatabaseSync(dbPath)
    this.migrate()
  }

  /** 保存或更新 thread 摘要。 */
  saveThread(summary: ThreadSummary): void {
    this.db
      .prepare(
        `insert into threads(thread_id, summary_json, archived_at, updated_at)
				 values (?, ?, ?, ?)
				 on conflict(thread_id) do update set
				   summary_json = excluded.summary_json,
				   archived_at = excluded.archived_at,
				   updated_at = excluded.updated_at`
      )
      .run(summary.threadId, JSON.stringify(summary), null, summary.updatedAt)
  }

  /** 保存或更新 thread snapshot。 */
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

  /** 获取指定 thread 摘要。 */
  getThread(threadId: ThreadId): ThreadSummary | undefined {
    const row = this.db.prepare('select * from threads where thread_id = ?').get(threadId) as
      ThreadRow | undefined
    return row ? (JSON.parse(row.summary_json) as ThreadSummary) : undefined
  }

  /** 获取指定 thread snapshot。 */
  getSnapshot(threadId: ThreadId): ThreadSnapshot | undefined {
    const row = this.db
      .prepare('select snapshot_json from thread_snapshots where thread_id = ?')
      .get(threadId) as SnapshotRow | undefined
    return row ? (JSON.parse(row.snapshot_json) as ThreadSnapshot) : undefined
  }

  /** 列出所有 thread 摘要，按更新时间倒序排列。 */
  listThreads(): ThreadSummary[] {
    return (
      this.db.prepare('select * from threads order by updated_at desc').all() as unknown as ThreadRow[]
    ).map((row) => JSON.parse(row.summary_json) as ThreadSummary)
  }

  /** 删除指定 thread 及其 snapshot。 */
  deleteThread(threadId: ThreadId): void {
    this.db.prepare('delete from thread_snapshots where thread_id = ?').run(threadId)
    this.db.prepare('delete from threads where thread_id = ?').run(threadId)
  }

  /** 关闭数据库连接。 */
  close(): void {
    this.db.close()
  }

  /** 初始化数据库表结构。 */
  private migrate(): void {
    this.db.exec(`
			create table if not exists threads (
				thread_id text primary key,
				summary_json text not null,
				archived_at text,
				updated_at text not null
			);
			create table if not exists thread_snapshots (
				thread_id text primary key,
				snapshot_json text not null,
				updated_at text not null
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
		`)
  }
}
