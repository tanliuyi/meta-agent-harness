/**
 * 本文件实现 Electron main 侧 SQLite thread registry 与 snapshot store。
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ThreadSnapshot, ThreadSummary } from '../../shared/coding-agent/types'

interface ThreadRow {
  summary_json: string
}

interface SnapshotRow {
  snapshot_json: string
}

export class CodingThreadStore {
  private readonly db: DatabaseSync

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

  getSnapshot(threadId: string): ThreadSnapshot | undefined {
    const row = this.db.prepare('select snapshot_json from thread_snapshots where thread_id = ?').get(threadId) as
      | SnapshotRow
      | undefined
    return row ? (JSON.parse(row.snapshot_json) as ThreadSnapshot) : undefined
  }

  listThreads(): ThreadSummary[] {
    return (this.db.prepare('select summary_json from threads order by updated_at desc').all() as unknown as ThreadRow[]).map(
      (row) => JSON.parse(row.summary_json) as ThreadSummary
    )
  }

  close(): void {
    this.db.close()
  }
}
