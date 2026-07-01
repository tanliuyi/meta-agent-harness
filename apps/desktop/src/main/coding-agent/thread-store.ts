/**
 * 本文件实现 Electron main 侧 SQLite thread registry 与 snapshot store。
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ThreadSnapshot, ThreadSummary } from '../../shared/coding-agent/types'

/**
 * 数据库 threads 表行。
 */
interface ThreadRow {
  /** 摘要 JSON 字符串。 */
  summary_json: string
}

/**
 * 数据库 thread_snapshots 表行。
 */
interface SnapshotRow {
  /** 快照 JSON 字符串。 */
  snapshot_json: string
}

/**
 * Electron main 侧 SQLite thread registry 与 snapshot store。
 */
export class CodingThreadStore {
  private readonly db: DatabaseSync

  /**
   * 创建 CodingThreadStore 实例。
   * @param dbPath - SQLite 数据库路径；传 ':memory:' 使用内存数据库。
   */
  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      create table if not exists threads (
        thread_id text primary key,
        summary_json text not null,
        updated_at text not null
      );
      create table if not exists thread_snapshots (
        thread_id text primary key,
        snapshot_json text not null,
        updated_at text not null
      );
    `)
  }

  /**
   * 保存线程摘要。
   * @param thread - 线程摘要。
   */
  saveThread(thread: ThreadSummary): void {
    this.db
      .prepare(
        `insert into threads(thread_id, summary_json, updated_at)
         values (?, ?, ?)
         on conflict(thread_id) do update set
           summary_json = excluded.summary_json,
           updated_at = excluded.updated_at`
      )
      .run(thread.threadId, JSON.stringify(thread), thread.updatedAt)
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
   * 列出所有线程摘要。
   * @returns 线程摘要列表，按 updated_at 降序。
   */
  listThreads(): ThreadSummary[] {
    return (
      this.db
        .prepare('select summary_json from threads order by updated_at desc')
        .all() as unknown as ThreadRow[]
    ).map((row) => JSON.parse(row.summary_json) as ThreadSummary)
  }

  /**
   * 关闭数据库连接。
   */
  close(): void {
    this.db.close()
  }
}
