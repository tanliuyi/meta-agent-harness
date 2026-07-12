/**
 * Pi Hermes Memory Extension
 *
 * Brings Hermes-style persistent memory and a learning loop to any Pi user.
 * After `pi install`, users get:
 *
 * 1. Persistent Memory — MEMORY.md + USER.md that survive across sessions
 * 2. Background Learning Loop — auto-saves notable facts every N turns
 * 3. Session-End Flush — saves memories before compaction/shutdown
 * 4. Auto-Consolidation — merges memory when full instead of erroring
 * 5. Correction Detection — immediate save on user corrections
 * 6. Procedural Skills — SKILL.md files for reusable procedures
 * 7. Tool-Call-Aware Nudge — review triggers on tool call count too
 * 8. /memory-insights — shows what's stored
 * 9. /memory-skills — lists procedural skills
 * 10. /memory-consolidate — manual consolidation trigger
 * 11. /memory-interview — onboarding interview to pre-fill user profile
 * 12. /memory-switch-project — select active project memory for this session
 * 13. Context Fencing — <memory-context> tags prevent injection through stored memory
 * 14. Memory Aging — entry timestamps guide consolidation
 *
 * See docs/ROADMAP.md for full roadmap and Hermes competitive analysis.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { MemoryStore } from './store/memory-store.js'
import { SkillStore } from './store/skill-store.js'
import { DatabaseManager } from './store/db.js'
import {
  formatFailureMemoryContent,
  migrateProjectMemoryIdentity,
  removeSyncedMemories,
  replaceCanonicalSyncedMemory,
  searchMemories,
  syncMemoryEntry
} from './store/sqlite-memory-store.js'
import { indexSession, upsertSessionFileMetadata } from './store/session-indexer.js'
import {
  scheduleSessionBackfill,
  waitForSessionBackfill,
  SESSION_BACKFILL_SHUTDOWN_TIMEOUT_MS
} from './handlers/session-backfill.js'
import {
  scheduleLiveSessionIndex,
  waitForLiveSessionIndex,
  SESSION_LIVE_INDEX_SHUTDOWN_TIMEOUT_MS
} from './handlers/session-live-index.js'
import { parseSessionFile } from './store/session-parser.js'
import { registerMemoryTool } from './tools/memory-tool.js'
import { registerSkillTool } from './tools/skill-tool.js'
import { registerSessionSearchTool } from './tools/session-search-tool.js'
import { registerMemorySearchTool } from './tools/memory-search-tool.js'
import { setupBackgroundReview } from './handlers/background-review.js'
import { setupSessionFlush } from './handlers/session-flush.js'
import { registerInsightsCommand } from './handlers/insights.js'
import { triggerConsolidation, registerConsolidateCommand } from './handlers/auto-consolidate.js'
import { setupCorrectionDetector } from './handlers/correction-detector.js'
import { registerSkillsCommand } from './handlers/skills-command.js'
import { registerInterviewCommand } from './handlers/interview.js'
import { registerSwitchProjectCommand } from './handlers/switch-project.js'
import { registerIndexSessionsCommand } from './handlers/index-sessions.js'
import { registerLearnMemoryCommand } from './handlers/learn-memory.js'
import {
  registerSyncMarkdownMemoriesCommand,
  syncMarkdownMemoriesToSqlite
} from './handlers/sync-markdown-memories.js'
import { registerPreviewContextCommand } from './handlers/preview-context.js'
import { loadConfig } from './config.js'
import {
  detectProject,
  detectProjectSkills,
  migrateLegacyBasenameProjectDirectory
} from './project.js'
import { buildPromptContext } from './prompt-context.js'
import { migrateLegacyProjectMemoryDirs } from './project-memory-migration.js'
import { migrateExtensionRoot } from './extension-root-migration.js'
import { AGENT_ROOT } from './paths.js'
import type { MemoryCategory } from './types.js'
import { ActiveProjectContext, type ActiveProjectProvider } from './active-project-context.js'

const DESKTOP_MEMORY_PANEL_ID = 'hermes-memory'
type DesktopMemoryTarget = 'memory' | 'user' | 'failure' | 'project'
type DesktopMemoryRequest =
  | { type: 'hermes.refresh'; requestId: string }
  | { type: 'hermes.search'; requestId: string; query: string }
  | {
      type: 'hermes.add'
      requestId: string
      target: DesktopMemoryTarget
      content: string
      category?: MemoryCategory
    }
  | {
      type: 'hermes.replace'
      requestId: string
      target: DesktopMemoryTarget
      oldText: string
      content: string
    }
  | { type: 'hermes.remove'; requestId: string; target: DesktopMemoryTarget; oldText: string }

export function parseDesktopMemoryRequest(value: unknown): DesktopMemoryRequest | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (input.type === 'hermes.refresh' && typeof input.requestId === 'string') {
    return { type: input.type, requestId: input.requestId }
  }
  if (
    input.type === 'hermes.search' &&
    typeof input.requestId === 'string' &&
    typeof input.query === 'string'
  ) {
    return { type: input.type, requestId: input.requestId, query: input.query }
  }
  const targets = new Set<DesktopMemoryTarget>(['memory', 'user', 'failure', 'project'])
  if (
    typeof input.requestId !== 'string' ||
    typeof input.target !== 'string' ||
    !targets.has(input.target as DesktopMemoryTarget)
  )
    return null
  const target = input.target as DesktopMemoryTarget
  if (input.type === 'hermes.add' && typeof input.content === 'string') {
    const categories = new Set<MemoryCategory>([
      'failure',
      'correction',
      'insight',
      'preference',
      'convention',
      'tool-quirk'
    ])
    const category =
      typeof input.category === 'string' && categories.has(input.category as MemoryCategory)
        ? (input.category as MemoryCategory)
        : undefined
    return {
      type: input.type,
      requestId: input.requestId,
      target,
      content: input.content,
      category
    }
  }
  if (
    input.type === 'hermes.replace' &&
    typeof input.oldText === 'string' &&
    typeof input.content === 'string'
  ) {
    return {
      type: input.type,
      requestId: input.requestId,
      target,
      oldText: input.oldText,
      content: input.content
    }
  }
  if (input.type === 'hermes.remove' && typeof input.oldText === 'string') {
    return { type: input.type, requestId: input.requestId, target, oldText: input.oldText }
  }
  return null
}

export function resolveProjectSkillDiscovery(
  skillStore: SkillStore,
  projectsMemoryDir: string | undefined,
  cwd?: string,
  activeProject?: ActiveProjectProvider
): { skillPaths: string[] } {
  const detected = activeProject
    ? { ...activeProject.get().info, skillsDir: skillStore.getProjectSkillsDir() }
    : detectProjectSkills(projectsMemoryDir, cwd)
  if (!activeProject) skillStore.setProjectContext(detected.id, detected.skillsDir)

  const skillPaths = [skillStore.getGlobalSkillsDir()]
  if (detected.skillsDir) skillPaths.push(detected.skillsDir)

  return { skillPaths }
}

export function registerProjectSkillDiscoveryHandler(
  pi: Pick<ExtensionAPI, 'on'>,
  skillStore: SkillStore,
  projectsMemoryDir: string | undefined,
  activeProject?: ActiveProjectProvider
): void {
  pi.on('resources_discover', async (event, _ctx) => {
    return resolveProjectSkillDiscovery(
      skillStore,
      projectsMemoryDir,
      (event as { cwd?: string }).cwd,
      activeProject
    )
  })
}

export default async function (pi: ExtensionAPI) {
  const config = loadConfig()

  const agentRoot = AGENT_ROOT
  const legacyGlobalDir = path.join(agentRoot, 'memory')
  const defaultGlobalDir = path.join(agentRoot, 'pi-hermes-memory')

  const configuredMemoryDir = config.memoryDir?.trim()
  const pointsToLegacyMemoryDir = configuredMemoryDir
    ? path.resolve(configuredMemoryDir) === path.resolve(legacyGlobalDir)
    : false

  const globalDir =
    !configuredMemoryDir || pointsToLegacyMemoryDir ? defaultGlobalDir : configuredMemoryDir

  const shouldMigrateExtensionRoot = !configuredMemoryDir || pointsToLegacyMemoryDir
  if (shouldMigrateExtensionRoot) {
    try {
      await migrateExtensionRoot(legacyGlobalDir, globalDir)
    } catch {
      // Best-effort migration only; startup continues with the target root.
    }
  }

  const store = new MemoryStore({ ...config, memoryDir: globalDir })
  // First collect pre-projects-memory layouts, then move the current project's
  // basename directory into its path-derived stable identity.
  migrateLegacyProjectMemoryDirs(agentRoot, config.projectsMemoryDir)
  const skillStore = new SkillStore({
    globalSkillsDir: path.join(globalDir, 'skills'),
    projectSkillsDir: null,
    projectName: null,
    legacySkillsDir: path.join(legacyGlobalDir, 'skills'),
    legacyPiGlobalSkillsDir: path.join(agentRoot, 'skills'),
    migrationSentinelPath: path.join(globalDir, '.skills-migrated-to-extension-storage')
  })
  const dbManager = new DatabaseManager(globalDir)
  const sessionsDir = path.join(agentRoot, 'sessions')
  const backfillState = { inProgress: false, promise: null as Promise<void> | null }
  const liveIndexState = { inProgress: false, promise: null as Promise<void> | null }
  const activeProject = new ActiveProjectContext({
    projectsMemoryDir: config.projectsMemoryDir,
    createStore: (info, cwd) => {
      const projectStore = new MemoryStore({
        ...config,
        memoryCharLimit: config.projectCharLimit,
        memoryDir: info.memoryDir ?? undefined
      })
      projectStore.setConsolidator(async (target, signal) =>
        triggerConsolidation(
          pi,
          projectStore,
          target,
          signal,
          config.consolidationTimeoutMs,
          target === 'memory' ? 'project' : target,
          config,
          cwd ?? undefined
        )
      )
      return projectStore
    },
    onActivate: (snapshot) => {
      skillStore.setProjectContext(
        snapshot.info.id,
        snapshot.info.memoryDir ? path.join(snapshot.info.memoryDir, 'skills') : null
      )
      if (snapshot.info.name && snapshot.info.id) {
        migrateProjectMemoryIdentity(dbManager, snapshot.info.name, snapshot.info.id)
      }
    }
  })

  try {
    syncMarkdownMemoriesToSqlite(dbManager, globalDir, config.projectsMemoryDir, agentRoot)
  } catch {
    // Best-effort only: failed SQLite backfill should not block extension startup.
  }

  const storeForDesktopTarget = (
    target: DesktopMemoryTarget,
    projectStore: MemoryStore | null
  ): MemoryStore => {
    if (target === 'project') {
      if (!projectStore) throw new Error('当前目录没有可用的项目记忆')
      return projectStore
    }
    return store
  }
  const normalizedDesktopTarget = (target: DesktopMemoryTarget): 'memory' | 'user' | 'failure' =>
    target === 'project' ? 'memory' : target
  const desktopProject = (target: DesktopMemoryTarget, projectId: string | null): string | null =>
    target === 'project' ? projectId : null
  const buildDesktopSnapshot = async () => {
    const project = activeProject.get()
    await store.loadFromDisk()
    if (project.store) await project.store.loadFromDisk()
    return {
      type: 'hermes.snapshot',
      version: 1,
      project: project.info.name,
      entries: {
        memory: store.getMemoryEntries(),
        user: store.getUserEntries(),
        failure: store.getAllFailureEntries(),
        project: project.store?.getMemoryEntries() ?? []
      },
      skills: await skillStore.loadIndex(),
      limits: {
        memory: config.memoryCharLimit,
        user: config.userCharLimit,
        project: config.projectCharLimit
      }
    }
  }
  const publishDesktopSnapshot = async (ctx: Pick<ExtensionContext, 'desktop'>): Promise<void> => {
    ctx.desktop.postPanelMessage(DESKTOP_MEMORY_PANEL_ID, await buildDesktopSnapshot())
  }

  // ── 1. Load memory from disk on session start ──
  pi.on('session_start', async (_event, ctx) => {
    await activeProject.activateCwd(ctx.cwd)
    await skillStore.migrateLegacySkills()
    await skillStore.ensureDiscoveredRoots()
    await store.loadFromDisk()
    ctx.desktop.registerNativePanel(DESKTOP_MEMORY_PANEL_ID, {
      viewType: 'pi.hermes-memory',
      title: '记忆',
      component: 'memory',
      icon: 'brain',
      order: 35
    })
    await publishDesktopSnapshot(ctx)

    scheduleSessionBackfill(dbManager, sessionsDir, {
      notify: (message, level) => {
        const ui = (ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui
        if (ui?.notify) {
          ui.notify(message, level)
        } else if (level === 'error' || level === 'warning') {
          console.warn(message)
        } else {
          console.info(message)
        }
      },
      state: backfillState
    })
  })

  pi.on('desktop_panel_view_state_changed', async (event, ctx) => {
    if (event.panelId === DESKTOP_MEMORY_PANEL_ID && event.visible) {
      await publishDesktopSnapshot(ctx)
    }
  })

  pi.on('desktop_panel_message', async (event, ctx) => {
    if (event.panelId !== DESKTOP_MEMORY_PANEL_ID) return
    const request = parseDesktopMemoryRequest(event.message)
    if (!request) return

    try {
      const project = activeProject.get()
      if (request.type === 'hermes.refresh') {
        ctx.desktop.postPanelMessage(DESKTOP_MEMORY_PANEL_ID, {
          type: 'hermes.actionResult',
          requestId: request.requestId,
          result: { success: true },
          snapshot: await buildDesktopSnapshot()
        })
        return
      }
      if (request.type === 'hermes.search') {
        ctx.desktop.postPanelMessage(DESKTOP_MEMORY_PANEL_ID, {
          type: 'hermes.searchResult',
          requestId: request.requestId,
          results: searchMemories(dbManager, request.query, {
            project: project.info.id ?? undefined,
            limit: 50
          })
        })
        return
      }

      const activeStore = storeForDesktopTarget(request.target, project.store)
      const target = normalizedDesktopTarget(request.target)
      await activeStore.loadFromDisk()
      let result
      if (request.type === 'hermes.add') {
        const category = request.category ?? 'insight'
        result =
          target === 'failure'
            ? await activeStore.addFailure(request.content, { category })
            : await activeStore.add(target, request.content)
        if (result.success) {
          syncMemoryEntry(dbManager, {
            content:
              target === 'failure'
                ? formatFailureMemoryContent(request.content, { category })
                : request.content,
            target,
            project: desktopProject(request.target, project.info.id),
            category: target === 'failure' ? category : null
          })
        }
      } else if (request.type === 'hermes.replace') {
        result = await activeStore.replace(target, request.oldText, request.content)
        if (result.success && result.updated_entry) {
          replaceCanonicalSyncedMemory(
            dbManager,
            request.oldText,
            result.updated_entry,
            target,
            desktopProject(request.target, project.info.id)
          )
        }
      } else {
        result = await activeStore.remove(target, request.oldText)
        if (result.success) {
          removeSyncedMemories(dbManager, request.oldText, {
            target,
            project: desktopProject(request.target, project.info.id)
          })
        }
      }
      ctx.desktop.postPanelMessage(DESKTOP_MEMORY_PANEL_ID, {
        type: 'hermes.actionResult',
        requestId: request.requestId,
        result,
        ...(result.success ? { snapshot: await buildDesktopSnapshot() } : {})
      })
    } catch (error) {
      ctx.desktop.postPanelMessage(DESKTOP_MEMORY_PANEL_ID, {
        type: 'hermes.actionResult',
        requestId: request.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) }
      })
    }
  })

  registerProjectSkillDiscoveryHandler(pi, skillStore, config.projectsMemoryDir, activeProject)

  // ── 2. Inject memory policy by default; legacy mode keeps full frozen memory blocks ──
  pi.on('before_agent_start', async (event, _ctx) => {
    const project = activeProject.get()
    await store.loadFromDisk()
    if (project.store) await project.store.loadFromDisk()
    const promptContext = await buildPromptContext(
      config,
      store,
      project.store,
      project.info.name ?? ''
    )

    if (promptContext) {
      return {
        systemPrompt: event.systemPrompt + '\n\n' + promptContext
      }
    }
  })

  // ── 3. Register the memory tool (with project store + SQLite sync) ──
  registerMemoryTool(pi, store, null, dbManager, null, activeProject)

  // ── 4. Register the skill tool ──
  registerSkillTool(pi, skillStore)

  // ── 5. Setup background learning loop (with tool-call-aware nudge) ──
  setupBackgroundReview(pi, store, null, config, {
    dbManager,
    activeProject
  })

  // ── 6. Setup session-end flush ──
  setupSessionFlush(pi, store, null, config, activeProject)

  // ── 7. Setup auto-consolidation (inject consolidator into stores) ──
  store.setConsolidator(async (target, signal) => {
    return triggerConsolidation(
      pi,
      store,
      target,
      signal,
      config.consolidationTimeoutMs,
      target,
      config
    )
  })
  registerConsolidateCommand(
    pi,
    store,
    config.consolidationTimeoutMs,
    null,
    null,
    config,
    activeProject
  )

  // ── 8. Setup correction detection ──
  setupCorrectionDetector(pi, store, null, config, dbManager, null, activeProject)

  // ── 9. Register commands ──
  registerInsightsCommand(pi, store, null, '', activeProject)
  registerSkillsCommand(pi, skillStore)
  registerInterviewCommand(pi, store)
  registerSwitchProjectCommand(pi, config, {
    getActiveProject: () => activeProject.get().info.id,
    switchProject: (id) => activeProject.activateStoredProject(id)
  })
  registerLearnMemoryCommand(pi)
  registerSyncMarkdownMemoriesCommand(pi, dbManager, globalDir, config.projectsMemoryDir, agentRoot)
  registerPreviewContextCommand(pi, store, null, '', config, activeProject)

  // ── 10. Live session indexing ──
  pi.on('message_end', async (_event, ctx) => {
    scheduleLiveSessionIndex(dbManager, ctx.sessionManager, {
      state: liveIndexState,
      onError: (err) =>
        console.warn(
          `⚠️ Live session indexing failed: ${err instanceof Error ? err.message : String(err)}`
        )
    })
  })

  // ── 11. SQLite session search + extended memory ──
  registerSessionSearchTool(pi, dbManager, config.sessionSearch ?? { variant: 'legacy' })
  registerMemorySearchTool(pi, dbManager)
  registerIndexSessionsCommand(pi)

  // ── 12. Auto-index session on shutdown ──
  // Registered last, so this runs after the session-flush shutdown handler and
  // is the final DB activity. Closing here truncates the WAL via
  // PRAGMA wal_checkpoint(TRUNCATE); without it the WAL only grows to its
  // high-water mark and is never reclaimed across sessions.
  //
  // Ordering is safe: Pi's ExtensionRunner.emit() runs same-extension handlers
  // sequentially in registration order and awaits each one, so the flush above
  // fully completes before close() runs. WARNING: do not register another
  // DB-writing session_shutdown handler after this block — it would run after
  // close() and silently no-op.
  pi.on('session_shutdown', async (_event, ctx) => {
    try {
      const sessionFile = ctx.sessionManager.getSessionFile()
      if (sessionFile && fs.existsSync(sessionFile)) {
        const sessionData = parseSessionFile(sessionFile)
        if (sessionData) {
          dbManager.withCorruptionRecovery(() => {
            indexSession(dbManager, sessionData)
            // Keep session_files metadata in sync with the final on-disk state.
            // Pi appends the closing session entry on shutdown after the last
            // message_end, so without this upsert the stored size/mtime would be
            // stale and the next startup would re-parse this file unnecessarily.
            upsertSessionFileMetadata(dbManager, sessionFile, sessionData.id)
          })
        }
      }
    } catch {
      // Silent fail — don't block shutdown
    } finally {
      try {
        await Promise.all([
          waitForSessionBackfill(SESSION_BACKFILL_SHUTDOWN_TIMEOUT_MS, backfillState),
          waitForLiveSessionIndex(SESSION_LIVE_INDEX_SHUTDOWN_TIMEOUT_MS, liveIndexState)
        ])
      } catch {
        // Best effort only — shutdown should not be held up by indexing errors.
      }
      try {
        dbManager.close()
      } catch {
        /* best effort — never block shutdown */
      }
    }
  })
}
