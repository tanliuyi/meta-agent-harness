import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { migrateExtensionRoot } from '../extension-root-migration.js'
import { DatabaseManager } from '../store/db.js'
import {
  replaceCanonicalSyncedMemory,
  searchMemories,
  syncMemoryEntry
} from '../store/sqlite-memory-store.js'
import { MemoryStore } from '../store/memory-store.js'
import { SkillStore } from '../store/skill-store.js'
import {
  ActiveProjectContext,
  type ActiveProjectProvider,
  type ActiveProjectSnapshot
} from '../active-project-context.js'
import {
  scheduleLiveSessionIndex,
  waitForLiveSessionIndex
} from '../handlers/session-live-index.js'
import { resolveSessionFlushCwd } from '../handlers/session-flush.js'
import type { MemoryConfig } from '../types.js'

const roots: string[] = []
const config: MemoryConfig = {
  memoryMode: 'policy-only',
  memoryCharLimit: 5000,
  userCharLimit: 5000,
  projectCharLimit: 5000,
  nudgeInterval: 10,
  reviewEnabled: false,
  flushOnCompact: false,
  flushOnShutdown: false,
  flushMinTurns: 6,
  autoConsolidate: false,
  correctionDetection: false,
  failureInjectionEnabled: true,
  failureInjectionMaxAgeDays: 7,
  failureInjectionMaxEntries: 5,
  nudgeToolCalls: 15,
  consolidationTimeoutMs: 60000
}

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-regression-'))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('storage regressions', () => {
  it('recovers a populated legacy database over an initialized empty target', async () => {
    const root = await tempDir()
    const legacy = path.join(root, 'memory')
    const target = path.join(root, 'pi-hermes-memory')
    const targetDb = new DatabaseManager(target)
    targetDb.getDb()
    targetDb.close()
    const legacyDb = new DatabaseManager(legacy)
    syncMemoryEntry(legacyDb, { content: 'legacy fact', target: 'memory', project: null })
    legacyDb.close()

    const result = await migrateExtensionRoot(legacy, target)
    const migrated = new DatabaseManager(target)
    expect(searchMemories(migrated, 'legacy fact')).toHaveLength(1)
    migrated.close()
    await expect(fs.access(path.join(legacy, 'sessions.db'))).rejects.toThrow()
    expect(result.warnings).toEqual([])
  })

  it('preserves both non-empty databases', async () => {
    const root = await tempDir()
    const legacy = path.join(root, 'memory')
    const target = path.join(root, 'pi-hermes-memory')
    const targetDb = new DatabaseManager(target)
    syncMemoryEntry(targetDb, { content: 'target fact', target: 'memory', project: null })
    targetDb.close()
    const legacyDb = new DatabaseManager(legacy)
    syncMemoryEntry(legacyDb, { content: 'legacy fact', target: 'memory', project: null })
    legacyDb.close()

    const result = await migrateExtensionRoot(legacy, target)
    expect(result.warnings.join(' ')).toContain('Both legacy and target')
    await expect(fs.access(path.join(legacy, 'sessions.db'))).resolves.toBeUndefined()
    const retained = new DatabaseManager(target)
    expect(searchMemories(retained, 'target fact')).toHaveLength(1)
    retained.close()
  })

  it('preserves conflicting flat and canonical skills in the global root', async () => {
    const root = await tempDir()
    const global = path.join(root, 'skills')
    await fs.mkdir(path.join(global, 'foo'), { recursive: true })
    await fs.writeFile(path.join(global, 'foo.md'), '# flat source')
    await fs.writeFile(path.join(global, 'foo', 'SKILL.md'), '# canonical target')
    const store = new SkillStore({
      globalSkillsDir: global,
      projectSkillsDir: null,
      projectName: null,
      legacySkillsDir: path.join(root, 'legacy-skills'),
      legacyPiGlobalSkillsDir: path.join(root, 'pi-skills'),
      migrationSentinelPath: path.join(root, '.migrated')
    })

    const result = await store.migrateLegacySkills()

    expect(result.warnings.join(' ')).toContain('preserved both files')
    expect(await fs.readFile(path.join(global, 'foo.md'), 'utf8')).toBe('# flat source')
    expect(await fs.readFile(path.join(global, 'foo', 'SKILL.md'), 'utf8')).toBe(
      '# canonical target'
    )
  })

  it('preserves a conflicting legacy flat skill and deduplicates equivalent content', async () => {
    const root = await tempDir()
    const legacy = path.join(root, 'legacy-skills')
    const global = path.join(root, 'skills')
    await fs.mkdir(path.join(global, 'foo'), { recursive: true })
    await fs.mkdir(path.join(global, 'same'), { recursive: true })
    await fs.mkdir(legacy, { recursive: true })
    await fs.writeFile(path.join(global, 'foo', 'SKILL.md'), '# canonical target')
    await fs.writeFile(path.join(global, 'same', 'SKILL.md'), '# same\n')
    await fs.writeFile(path.join(legacy, 'foo.md'), '# legacy source')
    await fs.writeFile(path.join(legacy, 'same.md'), '# same\r\n')
    const store = new SkillStore({
      globalSkillsDir: global,
      projectSkillsDir: null,
      projectName: null,
      legacySkillsDir: legacy,
      legacyPiGlobalSkillsDir: path.join(root, 'pi-skills'),
      migrationSentinelPath: path.join(root, '.migrated')
    })

    const result = await store.migrateLegacySkills()

    expect(result.warnings.join(' ')).toContain('foo.md')
    expect(await fs.readFile(path.join(legacy, 'foo.md'), 'utf8')).toBe('# legacy source')
    await expect(fs.access(path.join(legacy, 'same.md'))).rejects.toThrow()
  })
})

describe('failure replacement', () => {
  it('keeps Markdown and project-scoped SQLite metadata canonical after replace', async () => {
    const root = await tempDir()
    const store = new MemoryStore({ ...config, memoryDir: root })
    const db = new DatabaseManager(root)
    await store.loadFromDisk()
    const added = await store.addFailure('old body', {
      category: 'correction',
      failureReason: 'bad assumption',
      toolState: 'dirty',
      correctedTo: 'new approach',
      project: 'project-id'
    })
    expect(added.success).toBe(true)
    const original = store.getAllFailureEntries()[0]
    syncMemoryEntry(db, {
      content: original,
      target: 'failure',
      project: 'project-id',
      category: 'correction',
      failureReason: 'bad assumption',
      toolState: 'dirty',
      correctedTo: 'new approach'
    })

    const result = await store.replace('failure', 'old body', 'new body')
    expect(result.updated_entry).toBe(
      '[correction] new body — Failed: bad assumption — Tool state: dirty — Corrected to: new approach — Project: project-id'
    )
    expect(store.getAllFailureEntries()).toEqual([result.updated_entry])
    const synced = replaceCanonicalSyncedMemory(
      db,
      'old body',
      result.updated_entry!,
      'failure',
      null
    )

    expect(synced.matched).toBe(1)
    expect(synced.entries[0]).toMatchObject({
      content: result.updated_entry,
      category: 'correction',
      failureReason: 'bad assumption',
      toolState: 'dirty',
      correctedTo: 'new approach',
      project: 'project-id'
    })
    expect(searchMemories(db, 'new body', { project: 'project-id' })).toHaveLength(1)
    db.close()
  })
})

describe('lifecycle isolation', () => {
  it('uses the active cwd and skips stored projects without a canonical cwd during flush', () => {
    let snapshot: ActiveProjectSnapshot = {
      info: { name: 'active', id: 'active-id', memoryDir: '/memory/active-id' },
      store: null,
      cwd: '/workspace/active'
    }
    const provider = { get: () => snapshot } as ActiveProjectProvider
    expect(resolveSessionFlushCwd('/workspace/session', provider)).toBe('/workspace/active')

    snapshot = {
      info: { name: 'stored', id: 'stored-id', memoryDir: '/memory/stored-id' },
      store: null,
      cwd: null
    }
    expect(resolveSessionFlushCwd('/workspace/session', provider)).toBeNull()
  })

  it('keeps the previous project active when a new store fails to load', async () => {
    const root = await tempDir()
    const context = new ActiveProjectContext({
      projectsMemoryDir: path.join(root, 'projects'),
      createStore: (info) => {
        const store = new MemoryStore({ ...config, memoryDir: info.memoryDir ?? undefined })
        if (info.name === 'broken')
          store.loadFromDisk = async () => {
            throw new Error('load failed')
          }
        return store
      }
    })
    const first = await context.activateCwd(path.join(root, 'working'))
    await expect(context.activateCwd(path.join(root, 'broken'))).rejects.toThrow('load failed')
    expect(context.get()).toBe(first)
  })

  it('allows independent live index states to schedule concurrently', async () => {
    const callbacks: Array<() => void> = []
    const stateA = { inProgress: false, promise: null as Promise<void> | null }
    const stateB = { inProgress: false, promise: null as Promise<void> | null }
    const db = { withCorruptionRecovery: (fn: () => void) => fn() } as DatabaseManager
    const manager = {} as Parameters<typeof scheduleLiveSessionIndex>[1]
    const options = (state: typeof stateA) => ({
      state,
      setTimeoutFn: (callback: () => void) => callbacks.push(callback),
      indexLiveSessionFn: (() => undefined) as never
    })
    expect(scheduleLiveSessionIndex(db, manager, options(stateA))).toBe(true)
    expect(scheduleLiveSessionIndex(db, manager, options(stateB))).toBe(true)
    callbacks.forEach((callback) => callback())
    expect(await waitForLiveSessionIndex(100, stateA)).toBe(true)
    expect(await waitForLiveSessionIndex(100, stateB)).toBe(true)
  })
})
