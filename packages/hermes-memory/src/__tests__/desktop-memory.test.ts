import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDesktopMemoryRequest } from '../index.js'
import { detectProject } from '../project.js'
import { loadConfig } from '../config.js'
import { MemoryStore } from '../store/memory-store.js'
import { DatabaseManager } from '../store/db.js'
import {
  formatFailureMemoryContent,
  migrateProjectMemoryIdentity,
  removeSyncedMemories,
  searchMemories,
  syncMemoryEntry
} from '../store/sqlite-memory-store.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Desktop memory contract', () => {
  it('rejects malformed and unknown mutation messages', () => {
    expect(parseDesktopMemoryRequest({ type: 'hermes.refresh' })).toBeNull()
    expect(parseDesktopMemoryRequest({ type: 'hermes.refresh', requestId: 'refresh-1' })).toEqual({
      type: 'hermes.refresh',
      requestId: 'refresh-1'
    })
    expect(parseDesktopMemoryRequest({ type: 'hermes.remove', target: 'memory' })).toBeNull()
    expect(
      parseDesktopMemoryRequest({ type: 'hermes.destroy', requestId: '1', target: 'memory' })
    ).toBeNull()
    expect(
      parseDesktopMemoryRequest({
        type: 'hermes.add',
        requestId: '1',
        target: 'other',
        content: 'x'
      })
    ).toBeNull()
    expect(
      parseDesktopMemoryRequest({
        type: 'hermes.add',
        requestId: '1',
        target: 'memory',
        content: 'x'
      })
    ).toEqual({
      type: 'hermes.add',
      requestId: '1',
      target: 'memory',
      content: 'x',
      category: undefined
    })
  })

  it('serializes concurrent writers across store instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-lock-test-'))
    tempDirs.push(dir)
    const config = { ...loadConfig(join(dir, 'missing-config.json')), memoryDir: dir }
    const first = new MemoryStore(config)
    const second = new MemoryStore(config)

    await Promise.all([first.add('memory', 'from-thread-a'), second.add('memory', 'from-thread-b')])

    const reader = new MemoryStore(config)
    await reader.loadFromDisk()
    expect(reader.getMemoryEntries().sort()).toEqual(['from-thread-a', 'from-thread-b'])
  })

  it('does not overwrite memory when the existing file cannot be read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-read-error-test-'))
    tempDirs.push(dir)
    const memoryPath = join(dir, 'MEMORY.md')
    writeFileSync(memoryPath, 'must-survive', 'utf8')
    chmodSync(memoryPath, 0o000)

    const config = { ...loadConfig(join(dir, 'missing-config.json')), memoryDir: dir }
    const store = new MemoryStore(config)
    try {
      await expect(store.add('memory', 'new-entry')).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      chmodSync(memoryPath, 0o600)
    }
    expect(readFileSync(memoryPath, 'utf8')).toBe('must-survive')
  })

  it('isolates projects that share the same directory basename', () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-project-id-test-'))
    tempDirs.push(root)
    const firstCwd = join(root, 'client-a', 'app')
    const secondCwd = join(root, 'client-b', 'app')
    mkdirSync(firstCwd, { recursive: true })
    mkdirSync(secondCwd, { recursive: true })

    const first = detectProject('projects-memory', firstCwd)
    const second = detectProject('projects-memory', secondCwd)
    expect(first.name).toBe('app')
    expect(second.name).toBe('app')
    expect(first.id).not.toBe(second.id)
    expect(first.memoryDir).not.toBe(second.memoryDir)
  })

  it('migrates legacy SQLite project keys and merges partial-upgrade duplicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-project-key-test-'))
    tempDirs.push(dir)
    const manager = new DatabaseManager(dir)
    syncMemoryEntry(manager, { content: 'legacy-only', target: 'memory', project: 'app' })
    syncMemoryEntry(manager, { content: 'duplicate', target: 'memory', project: 'app' })
    syncMemoryEntry(manager, { content: 'duplicate', target: 'memory', project: 'app-deadbeef' })

    expect(migrateProjectMemoryIdentity(manager, 'app', 'app-deadbeef')).toEqual({
      migrated: 1,
      merged: 1
    })
    expect(searchMemories(manager, 'legacy-only', { project: 'app-deadbeef' })).toHaveLength(1)
    expect(searchMemories(manager, 'duplicate', { project: 'app-deadbeef' })).toHaveLength(1)
    expect(searchMemories(manager, 'legacy-only', { project: 'app' })).toHaveLength(0)
    manager.close()
  })

  it('restores FTS triggers and indexes after migrating a legacy memories table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-legacy-schema-test-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'sessions.db')
    const legacy = new DatabaseSync(dbPath)
    legacy.exec(`
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target TEXT NOT NULL CHECK (target IN ('memory', 'user')),
        content TEXT NOT NULL,
        created DATE NOT NULL,
        last_referenced DATE NOT NULL
      );
    `)
    legacy.close()

    const manager = new DatabaseManager(dir)
    syncMemoryEntry(manager, { content: 'post migration', target: 'memory', project: null })
    expect(searchMemories(manager, 'post migration')).toHaveLength(1)

    const db = manager.getDb()
    const objects = db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE name IN ('memories_ai', 'memories_ad', 'memories_au', 'idx_memories_project', 'idx_memories_target', 'idx_memories_category')
    `
      )
      .all() as Array<{ name: string }>
    expect(objects.map((row) => row.name).sort()).toEqual([
      'idx_memories_category',
      'idx_memories_project',
      'idx_memories_target',
      'memories_ad',
      'memories_ai',
      'memories_au'
    ])
    manager.close()
  })

  it('configures SQLite to wait for normal cross-worker write contention', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-busy-timeout-test-'))
    tempDirs.push(dir)
    const manager = new DatabaseManager(dir)
    const row = manager.getDb().prepare('PRAGMA busy_timeout').get() as { timeout: number }
    expect(Number(Object.values(row)[0])).toBe(5000)
    manager.close()
  })

  it('uses node:sqlite FTS5 and keeps failure identity removable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-desktop-test-'))
    tempDirs.push(dir)
    const manager = new DatabaseManager(dir)
    const content = formatFailureMemoryContent('failure-body', { category: 'insight' })

    syncMemoryEntry(manager, {
      content,
      target: 'failure',
      category: 'insight',
      project: null
    })
    expect(searchMemories(manager, 'failure-body')).toHaveLength(1)

    expect(removeSyncedMemories(manager, content, { target: 'failure', project: null })).toEqual({
      matched: 1,
      removed: 1
    })
    expect(searchMemories(manager, 'failure-body')).toHaveLength(0)
    manager.close()
  })
})
