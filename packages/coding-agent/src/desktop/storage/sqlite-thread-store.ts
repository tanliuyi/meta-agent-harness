/**
 * 本文件实现基于 Node SQLite 的 desktop thread 索引 store。
 */

import { dirname } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { ThreadId } from '../protocol/identity.ts'
import type { ThreadSnapshot } from '../protocol/snapshot.ts'
import type { ThreadSummary } from '../protocol/thread.ts'
import type { ThreadStore } from './thread-store.ts'

interface ThreadRow {
  thread_id: string
  summary_json: string
  archived_at: string | null
  updated_at: string
}

interface SnapshotRow {
  snapshot_json: string
}

export class SqliteThreadStore implements ThreadStore {
  private readonly db: DatabaseSync

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

  getThread(threadId: ThreadId): ThreadSummary | undefined {
    const row = this.db.prepare('select * from threads where thread_id = ?').get(threadId) as
      ThreadRow | undefined
    return row ? (JSON.parse(row.summary_json) as ThreadSummary) : undefined
  }

  getSnapshot(threadId: ThreadId): ThreadSnapshot | undefined {
    const row = this.db
      .prepare('select snapshot_json from thread_snapshots where thread_id = ?')
      .get(threadId) as SnapshotRow | undefined
    return row ? (JSON.parse(row.snapshot_json) as ThreadSnapshot) : undefined
  }

  listThreads(): ThreadSummary[] {
    return (
      this.db.prepare('select * from threads order by updated_at desc').all() as unknown as ThreadRow[]
    ).map((row) => JSON.parse(row.summary_json) as ThreadSummary)
  }

  deleteThread(threadId: ThreadId): void {
    this.db.prepare('delete from thread_snapshots where thread_id = ?').run(threadId)
    this.db.prepare('delete from threads where thread_id = ?').run(threadId)
  }

  close(): void {
    this.db.close()
  }

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
