/**
 * agent-settings-service.ts - Desktop 全局 Pi agent 设置服务。
 *
 * 该服务运行在 Electron main 中，负责通过 Pi-compatible SettingsManager 读写
 * getAgentDir()/settings.json 中的非模型配置。renderer 只能看到 UI projection，
 * 不能直接读写 settings.json。
 */

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { loadConfig as loadHermesMemoryConfig } from '@meta-agent/hermes-memory/config.js'
import {
  mergeLegacyDirectoryContents,
  migrateExtensionRoot
} from '@meta-agent/hermes-memory/extension-root-migration.js'
import { detectProject } from '@meta-agent/hermes-memory/project.js'
import { migrateLegacyProjectMemoryDirs } from '@meta-agent/hermes-memory/project-memory-migration.js'
import { DatabaseManager as HermesMemoryDatabaseManager } from '@meta-agent/hermes-memory/store/db.js'
import { SkillStore as HermesMemorySkillStore } from '@meta-agent/hermes-memory/store/skill-store.js'
import { MemoryStore as HermesMemoryStore } from '@meta-agent/hermes-memory/store/memory-store.js'
import {
  formatFailureMemoryContent,
  migrateProjectMemoryIdentity,
  parseMarkdownMemoryEntry,
  removeExactSyncedMemories,
  removeSyncedMemories,
  replaceCanonicalSyncedMemory,
  syncMemoryEntry
} from '@meta-agent/hermes-memory/store/sqlite-memory-store.js'
import {
  SettingsManager,
  type PackageSource,
  type TransportSetting
} from '@coding-agent-src/core/settings-manager'
import { DefaultPackageManager } from '@coding-agent-src/core/package-manager'
import { buildResourcesSnapshot } from '@coding-agent-src/core/resource-snapshot'
import type { ProgressEvent as PackageProgressEvent } from '@coding-agent-src/core/package-manager'
import { getAgentDir } from '@coding-agent-src/config'
import {
  readDesktopRuntimeConfig,
  writeDesktopRuntimeConfig,
  type DesktopRuntimeConfigInput
} from './desktop-runtime-config'
import type {
  AgentDefaultProjectTrust,
  AgentDoubleEscapeAction,
  AgentQueueMode,
  AgentSettingsDiagnostic,
  AgentSettingsSnapshot,
  AgentTransportMode,
  AgentTreeFilterMode,
  BrowserCdpAccessMode,
  BrowserWebPermissionMode,
  DesktopCapabilityAccessMode,
  HermesMemoryMutationInput,
  HermesMemorySnapshot,
  ResourcePackageInput,
  ResourcePackageProgressEvent,
  ResourcePackageSummary,
  ResourceSnapshot,
  ResourceSkillCommandInfo,
  UpdateResourcePackageInput,
  UpdateProjectExtensionPathsInput,
  UpdateAgentSettingsInput
} from '@shared/coding-agent/types'

export interface AgentSettingsServiceOptions {
  agentDir?: string
  cwd?: string
  desktopRuntimeConfigPath?: string
}

export type ResourcePackageEventHandler = (event: ResourcePackageProgressEvent) => void

/** 由 main ProjectStore/ProjectTrustService 解析的项目资源上下文。 */
export interface ProjectResourceContext {
  projectId?: string
  cwd: string
  projectTrusted: boolean
}

interface ResourcePackageContext {
  settingsManager: SettingsManager
  packageManager: DefaultPackageManager
  local: boolean
}

interface PersistedFileSnapshot {
  exists: boolean
  content?: string
}

/** Desktop 全局 Pi agent 设置服务。 */
export class AgentSettingsService {
  private readonly agentDir: string
  private readonly cwd: string
  private readonly settingsPath: string
  private readonly desktopRuntimeConfigPath: string
  private readonly settingsManager: SettingsManager
  private readonly packageManager: DefaultPackageManager
  private readonly mutationQueues = new Map<string, Promise<void>>()

  constructor(options: AgentSettingsServiceOptions = {}) {
    this.agentDir = options.agentDir ?? getAgentDir()
    this.cwd = options.cwd ?? app.getPath('userData')
    this.settingsPath = join(this.agentDir, 'settings.json')
    this.desktopRuntimeConfigPath =
      options.desktopRuntimeConfigPath ?? join(this.cwd, 'desktop-runtime.json')
    this.settingsManager = SettingsManager.create(this.cwd, this.agentDir, {
      projectTrusted: false
    })
    this.packageManager = new DefaultPackageManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: this.settingsManager
    })
  }

  /** 获取全局 agent 设置快照。 */
  async getAgentSettings(): Promise<AgentSettingsSnapshot> {
    await this.settingsManager.reload()
    return this.createSnapshot()
  }

  /** 更新全局 agent 设置。 */
  async updateAgentSettings(input: UpdateAgentSettingsInput): Promise<AgentSettingsSnapshot> {
    return this.runScopedMutation('global', async () => {
      this.settingsManager.drainErrors()
      await this.settingsManager.reload()
      const [settingsBefore, desktopRuntimeBefore] = await Promise.all([
        this.capturePersistedFile(this.settingsPath),
        this.capturePersistedFile(this.desktopRuntimeConfigPath)
      ])
      const desktopRuntimeInput: DesktopRuntimeConfigInput = {}

      try {
        this.applyDelivery(input.delivery)
        this.applyRuntime(input.runtime, desktopRuntimeInput)
        this.applyDisplay(input.display)
        this.applySafety(input.safety, desktopRuntimeInput)
        this.applyMedia(input.media)
        this.applyResources(input.resources)
        this.applyShell(input.shell)
        this.applyAdvanced(input.advanced)

        // Desktop capabilities are committed only after Pi settings are durably flushed.
        await this.settingsManager.flush()
        this.assertSettingsPersistenceSucceeded()
        await this.settingsManager.reload()
        this.assertSettingsPersistenceSucceeded()
        if (Object.keys(desktopRuntimeInput).length > 0) {
          this.commitDesktopRuntimeConfig(desktopRuntimeInput)
        }
        return this.createSnapshot()
      } catch (error) {
        try {
          await this.rollbackAgentSettingsUpdate(
            settingsBefore,
            desktopRuntimeBefore,
            Object.keys(desktopRuntimeInput).length > 0
          )
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Agent 设置保存失败，且无法完整恢复保存前状态'
          )
        }
        throw error
      }
    })
  }

  /** 列出 Pi package manager 配置包。 */
  async listResourcePackages(project?: ProjectResourceContext): Promise<ResourcePackageSummary[]> {
    const context = await this.createResourcePackageContext(project, false)
    return this.createResourcePackageSummaries(context.packageManager)
  }

  /** 获取 Pi-compatible resource / extension 发现快照。 */
  async getResourceSnapshot(input?: ProjectResourceContext): Promise<ResourceSnapshot> {
    let snapshot: ResourceSnapshot
    if (input) {
      const settingsManager = SettingsManager.create(input.cwd, this.agentDir, {
        projectTrusted: input.projectTrusted ?? false
      })
      const packageManager = new DefaultPackageManager({
        cwd: input.cwd,
        agentDir: this.agentDir,
        settingsManager
      })
      snapshot = await buildResourcesSnapshot({
        cwd: input.cwd,
        agentDir: this.agentDir,
        settingsManager,
        packageManager
      })
      return this.withSkillCommands(snapshot, input.cwd)
    }
    snapshot = await buildResourcesSnapshot({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: this.settingsManager,
      packageManager: this.packageManager
    })
    return this.withSkillCommands(snapshot, this.cwd)
  }

  /** 获取不依赖活跃会话的 Hermes Memory 设置快照。 */
  async getHermesMemorySnapshot(project?: ProjectResourceContext): Promise<HermesMemorySnapshot> {
    const context = await this.createHermesMemoryContext(project?.cwd)
    await context.globalStore.loadFromDisk()
    if (context.projectStore) await context.projectStore.loadFromDisk()
    await context.skillStore.migrateLegacySkills()
    await context.skillStore.ensureDiscoveredRoots()
    return {
      type: 'hermes.snapshot',
      project: context.project.name,
      entries: {
        memory: context.globalStore.getMemoryEntries(),
        user: context.globalStore.getUserEntries(),
        failure: context.globalStore.getAllFailureEntries(),
        project: context.projectStore?.getMemoryEntries() ?? []
      },
      skills: await context.skillStore.loadIndex(),
      limits: {
        memory: context.config.memoryCharLimit,
        user: context.config.userCharLimit,
        project: context.config.projectCharLimit
      }
    }
  }

  /** 修改 Hermes Memory 文件并返回最新设置快照。 */
  async mutateHermesMemory(
    input: HermesMemoryMutationInput,
    project?: ProjectResourceContext
  ): Promise<HermesMemorySnapshot> {
    if (input.target === 'project' && !project) {
      throw new Error('当前没有可用的项目记忆')
    }
    if (input.target === 'project' && !project?.projectTrusted) {
      throw new Error('Project 未受信任，无法修改项目记忆')
    }
    const context = await this.createHermesMemoryContext(project?.cwd)
    const store = input.target === 'project' ? context.projectStore : context.globalStore
    if (!store) throw new Error('当前没有可用的项目记忆')
    const target = input.target === 'project' ? 'memory' : input.target
    const projectId = input.target === 'project' ? context.project.id : null
    await store.loadFromDisk()
    const result =
      input.operation === 'add'
        ? target === 'failure'
          ? await store.addFailure(input.content, { category: 'insight' })
          : await store.add(target, input.content)
        : input.operation === 'replace'
          ? await store.replace(target, input.oldText, input.content)
          : await store.remove(target, input.oldText)
    if (!result.success) throw new Error(result.error ?? '记忆操作失败')

    const dbManager = new HermesMemoryDatabaseManager(context.globalDir)
    try {
      if (context.project.name && context.project.id) {
        migrateProjectMemoryIdentity(dbManager, context.project.name, context.project.id)
      }
      if (input.operation === 'add') {
        const category = target === 'failure' ? 'insight' : null
        syncMemoryEntry(dbManager, {
          content:
            target === 'failure'
              ? formatFailureMemoryContent(input.content, { category: 'insight' })
              : input.content,
          target,
          project: projectId,
          category
        })
        for (const evictedEntry of result.evicted_entries ?? []) {
          removeExactSyncedMemories(dbManager, evictedEntry, { target, project: projectId })
        }
      } else if (input.operation === 'replace' && result.updated_entry) {
        const syncResult = replaceCanonicalSyncedMemory(
          dbManager,
          input.oldText,
          result.updated_entry,
          target,
          projectId
        )
        if (syncResult.matched === 0) {
          syncMemoryEntry(
            dbManager,
            parseMarkdownMemoryEntry(result.updated_entry, target, projectId)
          )
        }
      } else if (input.operation === 'remove') {
        removeSyncedMemories(dbManager, input.oldText, { target, project: projectId })
      }
    } finally {
      dbManager.close()
    }
    return this.getHermesMemorySnapshot(project)
  }

  /** 获取项目级 extension 路径配置。 */
  async getProjectExtensionPaths(project: ProjectResourceContext): Promise<string[]> {
    const settingsManager = this.createProjectSettingsManager(project)
    await settingsManager.reload()
    return settingsManager.getProjectSettings().extensions ?? []
  }

  /** 更新项目级 extension 路径配置。 */
  async updateProjectExtensionPaths(
    input: UpdateProjectExtensionPathsInput,
    project: ProjectResourceContext
  ): Promise<string[]> {
    return this.runScopedMutation(this.getMutationScope(project), async () => {
      const settingsManager = this.createProjectSettingsManager(project)
      await settingsManager.reload()
      settingsManager.setProjectExtensionPaths(this.cleanStringList(input.extensions))
      await settingsManager.flush()
      await settingsManager.reload()
      return settingsManager.getProjectSettings().extensions ?? []
    })
  }

  /** 新增并持久化 package source。 */
  async addResourcePackage(
    input: ResourcePackageInput,
    project?: ProjectResourceContext
  ): Promise<ResourcePackageSummary[]> {
    const source = this.requirePackageSource(input.source)
    return this.runScopedMutation(this.getMutationScope(project), async () => {
      const context = await this.createResourcePackageContext(project, true)
      context.packageManager.addSourceToSettings(source, { local: context.local })
      await context.settingsManager.flush()
      return this.createResourcePackageSummaries(context.packageManager)
    })
  }

  /** 安装并持久化 package source。 */
  async installResourcePackage(
    input: ResourcePackageInput,
    onEvent?: ResourcePackageEventHandler,
    project?: ProjectResourceContext
  ): Promise<ResourcePackageSummary[]> {
    const source = this.requirePackageSource(input.source)
    return this.runScopedMutation(this.getMutationScope(project), async () => {
      const context = await this.createResourcePackageContext(project, true)
      await this.withPackageProgress(context.packageManager, onEvent, async () => {
        await context.packageManager.installAndPersist(source, { local: context.local })
        await context.settingsManager.flush()
      })
      return this.createResourcePackageSummaries(context.packageManager)
    })
  }

  /** 移除并持久化 package source。 */
  async removeResourcePackage(
    input: ResourcePackageInput,
    project?: ProjectResourceContext
  ): Promise<ResourcePackageSummary[]> {
    const source = this.requirePackageSource(input.source)
    return this.runScopedMutation(this.getMutationScope(project), async () => {
      const context = await this.createResourcePackageContext(project, true)
      context.packageManager.removeSourceFromSettings(source, { local: context.local })
      await context.settingsManager.flush()
      return this.createResourcePackageSummaries(context.packageManager)
    })
  }

  /** 更新已配置 package source。 */
  async updateResourcePackage(
    input: UpdateResourcePackageInput = {},
    onEvent?: ResourcePackageEventHandler,
    project?: ProjectResourceContext
  ): Promise<ResourcePackageSummary[]> {
    return this.runScopedMutation(this.getMutationScope(project), async () => {
      const context = await this.createResourcePackageContext(project, Boolean(project))
      await this.withPackageProgress(context.packageManager, onEvent, async () => {
        await context.packageManager.update(input.source)
      })
      return this.createResourcePackageSummaries(context.packageManager)
    })
  }

  /** 获取图片是否自动缩放。 */
  async getImageAutoResize(): Promise<boolean> {
    await this.settingsManager.reload()
    return this.settingsManager.getImageAutoResize()
  }

  private createSnapshot(): AgentSettingsSnapshot {
    const desktopRuntimeConfig = readDesktopRuntimeConfig(this.desktopRuntimeConfigPath)
    return {
      delivery: {
        steeringMode: this.settingsManager.getSteeringMode(),
        followUpMode: this.settingsManager.getFollowUpMode(),
        transport: this.settingsManager.getTransport()
      },
      runtime: {
        workerMode: desktopRuntimeConfig.workerMode,
        nodeSidecarExecPath: desktopRuntimeConfig.nodeSidecarExecPath,
        compactionEnabled: this.settingsManager.getCompactionEnabled(),
        compactionReserveTokens: this.settingsManager.getCompactionReserveTokens(),
        compactionKeepRecentTokens: this.settingsManager.getCompactionKeepRecentTokens(),
        branchSummaryReserveTokens: this.settingsManager.getBranchSummarySettings().reserveTokens,
        branchSummarySkipPrompt: this.settingsManager.getBranchSummarySkipPrompt(),
        retryEnabled: this.settingsManager.getRetryEnabled(),
        retryMaxRetries: this.settingsManager.getRetrySettings().maxRetries,
        retryBaseDelayMs: this.settingsManager.getRetrySettings().baseDelayMs,
        providerRetryTimeoutMs: this.settingsManager.getProviderRetrySettings().timeoutMs,
        providerRetryMaxRetries: this.settingsManager.getProviderRetrySettings().maxRetries,
        providerRetryMaxRetryDelayMs:
          this.settingsManager.getProviderRetrySettings().maxRetryDelayMs,
        httpIdleTimeoutMs: this.settingsManager.getHttpIdleTimeoutMs(),
        websocketConnectTimeoutMs: this.settingsManager.getWebSocketConnectTimeoutMs()
      },
      display: {
        theme: this.settingsManager.getThemeSetting(),
        quietStartup: this.settingsManager.getQuietStartup(),
        collapseChangelog: this.settingsManager.getCollapseChangelog(),
        hideThinkingBlock: this.settingsManager.getHideThinkingBlock(),
        doubleEscapeAction: this.settingsManager.getDoubleEscapeAction(),
        treeFilterMode: this.settingsManager.getTreeFilterMode(),
        showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
        editorPaddingX: this.settingsManager.getEditorPaddingX(),
        autocompleteMaxVisible: this.settingsManager.getAutocompleteMaxVisible()
      },
      safety: {
        defaultProjectTrust: this.settingsManager.getDefaultProjectTrust(),
        enableInstallTelemetry: this.settingsManager.getEnableInstallTelemetry(),
        enableAnalytics: this.settingsManager.getEnableAnalytics(),
        enableSkillCommands: this.settingsManager.getEnableSkillCommands(),
        warnAnthropicExtraUsage: this.settingsManager.getWarnings().anthropicExtraUsage ?? true,
        httpProxy: this.settingsManager.getHttpProxy(),
        browserCdpAccess: desktopRuntimeConfig.browserCdpAccess,
        browserWebPermissions: desktopRuntimeConfig.browserWebPermissions,
        filesystemAccess: desktopRuntimeConfig.filesystemAccess,
        extensionUrlAccess: desktopRuntimeConfig.extensionUrlAccess,
        externalProtocolAccess: desktopRuntimeConfig.externalProtocolAccess
      },
      media: {
        imageAutoResize: this.settingsManager.getImageAutoResize(),
        blockImages: this.settingsManager.getBlockImages(),
        showImages: this.settingsManager.getShowImages(),
        imageWidthCells: this.settingsManager.getImageWidthCells(),
        clearOnShrink: this.settingsManager.getClearOnShrink(),
        showTerminalProgress: this.settingsManager.getShowTerminalProgress()
      },
      resources: {
        packages: this.packageSourcesToStrings(this.settingsManager.getPackages()),
        extensions: this.settingsManager.getExtensionPaths(),
        skills: this.settingsManager.getSkillPaths(),
        prompts: this.settingsManager.getPromptTemplatePaths(),
        themes: this.settingsManager.getThemePaths()
      },
      shell: {
        shellPath: this.settingsManager.getShellPath(),
        shellCommandPrefix: this.settingsManager.getShellCommandPrefix(),
        npmCommand: this.settingsManager.getNpmCommand() ?? [],
        sessionDir: this.settingsManager.getGlobalSettings().sessionDir
      },
      advanced: {
        thinkingBudgets: { ...(this.settingsManager.getThinkingBudgets() ?? {}) },
        codeBlockIndent: this.settingsManager.getCodeBlockIndent()
      },
      storage: {
        agentDir: this.agentDir,
        settingsPath: this.settingsPath
      },
      diagnostics: this.createDiagnostics()
    }
  }

  private async withSkillCommands(
    snapshot: ResourceSnapshot,
    cwd: string
  ): Promise<ResourceSnapshot> {
    const discoveredSkillCommands: ResourceSkillCommandInfo[] = await Promise.all(
      snapshot.resources.skills
        .filter((skill) => skill.enabled)
        .map(async (skill) => {
          const metadata = await readSkillCommandMetadata(skill.path)
          return {
            name: `skill:${metadata.name}`,
            description: metadata.description,
            source: 'skill' as const,
            sourceInfo: skill.sourceInfo
          }
        })
    )
    const skillCommands = new Map<string, ResourceSkillCommandInfo>(
      discoveredSkillCommands.map((command) => [command.name, command])
    )
    const discoveredSkillNames = new Set(skillCommands.keys())
    for (const command of await this.getHermesMemorySkillCommands(cwd)) {
      if (!discoveredSkillNames.has(command.name)) {
        skillCommands.set(command.name, command)
      }
    }
    return {
      ...snapshot,
      skillCommands: [...skillCommands.values()]
    }
  }

  /** 获取 Desktop 内置 Hermes Memory 扩展通过 resources_discover 注入的技能。 */
  private async getHermesMemorySkillCommands(cwd: string): Promise<ResourceSkillCommandInfo[]> {
    const { skillStore } = await this.createHermesMemoryContext(cwd)
    await skillStore.migrateLegacySkills()
    await skillStore.ensureDiscoveredRoots()
    const skills = await skillStore.loadIndex()
    skills.sort(
      (left, right) => Number(left.scope === 'project') - Number(right.scope === 'project')
    )
    return skills.map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: 'skill',
      sourceInfo: {
        path: skill.path,
        source: '@meta-agent/hermes-memory',
        scope: skill.scope === 'global' ? 'user' : 'project',
        origin: 'top-level',
        baseDir: dirname(skill.path)
      }
    }))
  }

  private async createHermesMemoryContext(cwd?: string): Promise<{
    config: ReturnType<typeof loadHermesMemoryConfig>
    project: ReturnType<typeof detectProject>
    globalDir: string
    skillStore: HermesMemorySkillStore
    globalStore: HermesMemoryStore
    projectStore: HermesMemoryStore | null
  }> {
    const config = loadHermesMemoryConfig(join(this.agentDir, 'hermes-memory-config.json'))
    const legacyGlobalDir = join(this.agentDir, 'memory')
    const configuredMemoryDir = config.memoryDir?.trim()
    const shouldMigrateGlobalRoot =
      !configuredMemoryDir || resolve(configuredMemoryDir) === resolve(legacyGlobalDir)
    const globalDir = shouldMigrateGlobalRoot
      ? join(this.agentDir, 'pi-hermes-memory')
      : configuredMemoryDir
    if (shouldMigrateGlobalRoot) {
      await migrateExtensionRoot(legacyGlobalDir, globalDir)
    }

    const projectsMemoryDir = config.projectsMemoryDir ?? 'projects-memory'
    migrateLegacyProjectMemoryDirs(this.agentDir, projectsMemoryDir)
    const project = cwd
      ? detectProject(config.projectsMemoryDir, cwd)
      : { name: null, id: null, memoryDir: null }
    const projectsRoot = join(this.agentDir, projectsMemoryDir)
    const projectMemoryDir = project.id ? join(projectsRoot, project.id) : null
    if (project.name && projectMemoryDir) {
      const legacyProjectDir = join(projectsRoot, project.name)
      if (resolve(legacyProjectDir) !== resolve(projectMemoryDir) && existsSync(legacyProjectDir)) {
        await mergeLegacyDirectoryContents(legacyProjectDir, projectMemoryDir)
      }
    }
    const skillStore = new HermesMemorySkillStore({
      globalSkillsDir: join(globalDir, 'skills'),
      projectSkillsDir: projectMemoryDir ? join(projectMemoryDir, 'skills') : null,
      projectName: project.id,
      legacySkillsDir: join(legacyGlobalDir, 'skills'),
      legacyPiGlobalSkillsDir: join(this.agentDir, 'skills'),
      migrationSentinelPath: join(globalDir, '.skills-migrated-to-extension-storage')
    })
    return {
      config,
      project,
      globalDir,
      skillStore,
      globalStore: new HermesMemoryStore({ ...config, memoryDir: globalDir }),
      projectStore: projectMemoryDir
        ? new HermesMemoryStore({
            ...config,
            memoryDir: projectMemoryDir,
            memoryCharLimit: config.projectCharLimit
          })
        : null
    }
  }

  private createProjectSettingsManager(project: ProjectResourceContext): SettingsManager {
    if (!project.projectTrusted) {
      throw new Error('Project 未受信任，无法修改项目本地设置')
    }
    return SettingsManager.create(project.cwd, this.agentDir, {
      projectTrusted: project.projectTrusted
    })
  }

  private async createResourcePackageContext(
    project: ProjectResourceContext | undefined,
    requireProjectTrust: boolean
  ): Promise<ResourcePackageContext> {
    if (!project) {
      await this.settingsManager.reload()
      return {
        settingsManager: this.settingsManager,
        packageManager: this.packageManager,
        local: false
      }
    }
    if (requireProjectTrust && !project.projectTrusted) {
      throw new Error('Project 未受信任，无法修改项目本地 package 配置')
    }
    const settingsManager = SettingsManager.create(project.cwd, this.agentDir, {
      projectTrusted: project.projectTrusted
    })
    await settingsManager.reload()
    return {
      settingsManager,
      packageManager: new DefaultPackageManager({
        cwd: project.cwd,
        agentDir: this.agentDir,
        settingsManager
      }),
      local: true
    }
  }

  private applyDelivery(input: UpdateAgentSettingsInput['delivery']): void {
    if (!input) return
    if (input.steeringMode !== undefined) {
      this.settingsManager.setSteeringMode(this.requireQueueMode(input.steeringMode))
    }
    if (input.followUpMode !== undefined) {
      this.settingsManager.setFollowUpMode(this.requireQueueMode(input.followUpMode))
    }
    if (input.transport !== undefined) {
      this.settingsManager.setTransport(this.requireTransport(input.transport))
    }
  }

  private applyRuntime(
    input: UpdateAgentSettingsInput['runtime'],
    desktopRuntimeInput: DesktopRuntimeConfigInput
  ): void {
    if (!input) return
    if (input.workerMode !== undefined) {
      desktopRuntimeInput.workerMode = input.workerMode
    }
    if ('nodeSidecarExecPath' in input) {
      desktopRuntimeInput.nodeSidecarExecPath = input.nodeSidecarExecPath
    }
    if (input.compactionEnabled !== undefined) {
      this.settingsManager.setCompactionEnabled(input.compactionEnabled)
    }
    if (input.compactionReserveTokens !== undefined) {
      this.settingsManager.setCompactionReserveTokens(input.compactionReserveTokens)
    }
    if (input.compactionKeepRecentTokens !== undefined) {
      this.settingsManager.setCompactionKeepRecentTokens(input.compactionKeepRecentTokens)
    }
    if (input.branchSummaryReserveTokens !== undefined) {
      this.settingsManager.setBranchSummaryReserveTokens(input.branchSummaryReserveTokens)
    }
    if (input.branchSummarySkipPrompt !== undefined) {
      this.settingsManager.setBranchSummarySkipPrompt(input.branchSummarySkipPrompt)
    }
    if (input.retryEnabled !== undefined) {
      this.settingsManager.setRetryEnabled(input.retryEnabled)
    }
    if (input.retryMaxRetries !== undefined) {
      this.settingsManager.setRetryMaxRetries(input.retryMaxRetries)
    }
    if (input.retryBaseDelayMs !== undefined) {
      this.settingsManager.setRetryBaseDelayMs(input.retryBaseDelayMs)
    }
    if ('providerRetryTimeoutMs' in input) {
      this.settingsManager.setProviderRetryTimeoutMs(input.providerRetryTimeoutMs)
    }
    if ('providerRetryMaxRetries' in input) {
      this.settingsManager.setProviderRetryMaxRetries(input.providerRetryMaxRetries)
    }
    if (input.providerRetryMaxRetryDelayMs !== undefined) {
      this.settingsManager.setProviderRetryMaxRetryDelayMs(input.providerRetryMaxRetryDelayMs)
    }
    if (input.httpIdleTimeoutMs !== undefined) {
      this.settingsManager.setHttpIdleTimeoutMs(input.httpIdleTimeoutMs)
    }
    if ('websocketConnectTimeoutMs' in input) {
      this.settingsManager.setWebSocketConnectTimeoutMs(input.websocketConnectTimeoutMs)
    }
  }

  private applyDisplay(input: UpdateAgentSettingsInput['display']): void {
    if (!input) return
    if (input.quietStartup !== undefined) {
      this.settingsManager.setQuietStartup(input.quietStartup)
    }
    if ('theme' in input) {
      this.settingsManager.setTheme(input.theme?.trim() ?? '')
    }
    if (input.collapseChangelog !== undefined) {
      this.settingsManager.setCollapseChangelog(input.collapseChangelog)
    }
    if (input.hideThinkingBlock !== undefined) {
      this.settingsManager.setHideThinkingBlock(input.hideThinkingBlock)
    }
    if (input.doubleEscapeAction !== undefined) {
      this.settingsManager.setDoubleEscapeAction(
        this.requireDoubleEscapeAction(input.doubleEscapeAction)
      )
    }
    if (input.treeFilterMode !== undefined) {
      this.settingsManager.setTreeFilterMode(this.requireTreeFilterMode(input.treeFilterMode))
    }
    if (input.showHardwareCursor !== undefined) {
      this.settingsManager.setShowHardwareCursor(input.showHardwareCursor)
    }
    if (input.editorPaddingX !== undefined) {
      this.settingsManager.setEditorPaddingX(input.editorPaddingX)
    }
    if (input.autocompleteMaxVisible !== undefined) {
      this.settingsManager.setAutocompleteMaxVisible(input.autocompleteMaxVisible)
    }
  }

  private applySafety(
    input: UpdateAgentSettingsInput['safety'],
    desktopRuntimeInput: DesktopRuntimeConfigInput
  ): void {
    if (!input) return
    if (input.defaultProjectTrust !== undefined) {
      this.settingsManager.setDefaultProjectTrust(
        this.requireDefaultProjectTrust(input.defaultProjectTrust)
      )
    }
    if (input.enableInstallTelemetry !== undefined) {
      this.settingsManager.setEnableInstallTelemetry(input.enableInstallTelemetry)
    }
    if (input.enableAnalytics !== undefined) {
      this.settingsManager.setEnableAnalytics(input.enableAnalytics)
    }
    if (input.enableSkillCommands !== undefined) {
      this.settingsManager.setEnableSkillCommands(input.enableSkillCommands)
    }
    if (input.warnAnthropicExtraUsage !== undefined) {
      this.settingsManager.setWarnings({
        ...this.settingsManager.getWarnings(),
        anthropicExtraUsage: input.warnAnthropicExtraUsage
      })
    }
    if ('httpProxy' in input) {
      this.settingsManager.setHttpProxy(this.optionalString(input.httpProxy))
    }
    if (input.browserCdpAccess !== undefined) {
      desktopRuntimeInput.browserCdpAccess = this.requireBrowserCdpAccessMode(
        input.browserCdpAccess
      )
    }
    if (input.browserWebPermissions !== undefined) {
      desktopRuntimeInput.browserWebPermissions = this.requireBrowserWebPermissionMode(
        input.browserWebPermissions
      )
    }
    if (input.filesystemAccess !== undefined) {
      desktopRuntimeInput.filesystemAccess = this.requireDesktopCapabilityAccessMode(
        input.filesystemAccess,
        'filesystemAccess'
      )
    }
    if (input.extensionUrlAccess !== undefined) {
      desktopRuntimeInput.extensionUrlAccess = this.requireDesktopCapabilityAccessMode(
        input.extensionUrlAccess,
        'extensionUrlAccess'
      )
    }
    if (input.externalProtocolAccess !== undefined) {
      desktopRuntimeInput.externalProtocolAccess = this.requireDesktopCapabilityAccessMode(
        input.externalProtocolAccess,
        'externalProtocolAccess'
      )
    }
  }

  private applyMedia(input: UpdateAgentSettingsInput['media']): void {
    if (!input) return
    if (input.imageAutoResize !== undefined) {
      this.settingsManager.setImageAutoResize(input.imageAutoResize)
    }
    if (input.blockImages !== undefined) {
      this.settingsManager.setBlockImages(input.blockImages)
    }
    if (input.showImages !== undefined) {
      this.settingsManager.setShowImages(input.showImages)
    }
    if (input.imageWidthCells !== undefined) {
      this.settingsManager.setImageWidthCells(input.imageWidthCells)
    }
    if (input.clearOnShrink !== undefined) {
      this.settingsManager.setClearOnShrink(input.clearOnShrink)
    }
    if (input.showTerminalProgress !== undefined) {
      this.settingsManager.setShowTerminalProgress(input.showTerminalProgress)
    }
  }

  private applyResources(input: UpdateAgentSettingsInput['resources']): void {
    if (!input) return
    if (input.packages !== undefined) {
      this.settingsManager.setPackages(this.stringsToPackageSources(input.packages))
    }
    if (input.extensions !== undefined) {
      this.settingsManager.setExtensionPaths(input.extensions)
    }
    if (input.skills !== undefined) {
      this.settingsManager.setSkillPaths(input.skills)
    }
    if (input.prompts !== undefined) {
      this.settingsManager.setPromptTemplatePaths(input.prompts)
    }
    if (input.themes !== undefined) {
      this.settingsManager.setThemePaths(input.themes)
    }
  }

  private applyShell(input: UpdateAgentSettingsInput['shell']): void {
    if (!input) return
    if ('shellPath' in input) {
      this.settingsManager.setShellPath(this.optionalString(input.shellPath))
    }
    if ('shellCommandPrefix' in input) {
      this.settingsManager.setShellCommandPrefix(this.optionalString(input.shellCommandPrefix))
    }
    if (input.npmCommand !== undefined) {
      this.settingsManager.setNpmCommand(input.npmCommand.length > 0 ? input.npmCommand : undefined)
    }
    if ('sessionDir' in input) {
      this.settingsManager.setSessionDir(this.optionalString(input.sessionDir))
    }
  }

  private applyAdvanced(input: UpdateAgentSettingsInput['advanced']): void {
    if (!input) return
    if (input.thinkingBudgets !== undefined) {
      this.settingsManager.setThinkingBudgets(this.emptyObjectToUndefined(input.thinkingBudgets))
    }
    if (input.codeBlockIndent !== undefined) {
      this.settingsManager.setCodeBlockIndent(input.codeBlockIndent)
    }
  }

  private commitDesktopRuntimeConfig(input: DesktopRuntimeConfigInput): void {
    writeDesktopRuntimeConfig(input, this.desktopRuntimeConfigPath)
  }

  private assertSettingsPersistenceSucceeded(): void {
    const errors = this.settingsManager.drainErrors()
    if (errors.length === 0) return
    throw new AggregateError(
      errors.map((entry) => entry.error),
      'Pi settings 保存失败，Desktop runtime 配置未提交'
    )
  }

  private async capturePersistedFile(path: string): Promise<PersistedFileSnapshot> {
    try {
      return { exists: true, content: await readFile(path, 'utf-8') }
    } catch (error) {
      if (this.isFileNotFoundError(error)) return { exists: false }
      throw error
    }
  }

  private async restorePersistedFile(path: string, snapshot: PersistedFileSnapshot): Promise<void> {
    if (!snapshot.exists) {
      await rm(path, { force: true })
      return
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, snapshot.content ?? '', 'utf-8')
  }

  private async rollbackAgentSettingsUpdate(
    settingsBefore: PersistedFileSnapshot,
    desktopRuntimeBefore: PersistedFileSnapshot,
    restoreDesktopRuntime: boolean
  ): Promise<void> {
    const rollbackErrors: unknown[] = []

    // Setters enqueue writes immediately; wait for that queue before restoring the file snapshot.
    try {
      await this.settingsManager.reload()
    } catch (error) {
      rollbackErrors.push(error)
    }
    try {
      await this.restorePersistedFile(this.settingsPath, settingsBefore)
    } catch (error) {
      rollbackErrors.push(error)
    }
    if (restoreDesktopRuntime) {
      try {
        await this.restorePersistedFile(this.desktopRuntimeConfigPath, desktopRuntimeBefore)
      } catch (error) {
        rollbackErrors.push(error)
      }
    }
    try {
      await this.settingsManager.reload()
    } catch (error) {
      rollbackErrors.push(error)
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError(rollbackErrors, '无法恢复 Agent 设置保存前状态')
    }
  }

  private isFileNotFoundError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    )
  }

  private createDiagnostics(): AgentSettingsDiagnostic[] {
    return this.settingsManager.drainErrors().map((error, index) => ({
      id: `settings-${error.scope}-${index}`,
      severity: 'error',
      source: 'settings',
      message: `${error.scope} settings 加载或保存失败`,
      details: error.error.message
    }))
  }

  private packageSourcesToStrings(packages: PackageSource[]): string[] {
    return packages.map((source) => (typeof source === 'string' ? source : JSON.stringify(source)))
  }

  private createResourcePackageSummaries(
    packageManager: DefaultPackageManager
  ): ResourcePackageSummary[] {
    return packageManager.listConfiguredPackages().map((item) => ({
      source: item.source,
      scope: item.scope,
      filtered: item.filtered,
      installedPath: item.installedPath
    }))
  }

  private async withPackageProgress<T>(
    packageManager: DefaultPackageManager,
    onEvent: ResourcePackageEventHandler | undefined,
    operation: () => Promise<T>
  ): Promise<T> {
    packageManager.setProgressCallback(
      onEvent ? (event) => onEvent(this.toResourcePackageProgressEvent(event)) : undefined
    )
    try {
      return await operation()
    } finally {
      packageManager.setProgressCallback(undefined)
    }
  }

  private runScopedMutation<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueues.get(scope) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    const tail = run.then(
      () => undefined,
      () => undefined
    )
    this.mutationQueues.set(scope, tail)
    void tail.then(() => {
      if (this.mutationQueues.get(scope) === tail) {
        this.mutationQueues.delete(scope)
      }
    })
    return run
  }

  private getMutationScope(project?: ProjectResourceContext): string {
    if (!project) return 'global'
    const identity = project.projectId?.trim() || this.normalizeProjectPath(project.cwd)
    return `project:${identity}`
  }

  private normalizeProjectPath(path: string): string {
    const normalized = resolve(path)
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  private toResourcePackageProgressEvent(
    event: PackageProgressEvent
  ): ResourcePackageProgressEvent {
    return {
      type: event.type,
      action: event.action,
      source: event.source,
      message: event.message
    }
  }

  private requirePackageSource(source: string): string {
    const trimmed = source.trim()
    if (!trimmed) {
      throw new Error('package source is required')
    }
    return trimmed
  }

  private stringsToPackageSources(packages: string[]): PackageSource[] {
    return packages
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        if (!value.startsWith('{')) {
          return value
        }
        const parsed = JSON.parse(value) as PackageSource
        if (typeof parsed !== 'string' && typeof parsed.source !== 'string') {
          throw new Error('package object source is required')
        }
        return parsed
      })
  }

  private optionalString(value: string | undefined): string | undefined {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
  }

  private emptyObjectToUndefined<T extends Record<string, unknown>>(value: T): T | undefined {
    return Object.values(value).some((item) => item !== undefined) ? value : undefined
  }

  private cleanStringList(values: string[]): string[] {
    return values.map((value) => value.trim()).filter(Boolean)
  }

  private requireQueueMode(value: AgentQueueMode): AgentQueueMode {
    if (value === 'all' || value === 'one-at-a-time') return value
    throw new Error(`invalid queue mode: ${String(value)}`)
  }

  private requireTransport(value: AgentTransportMode): TransportSetting {
    if (
      value === 'auto' ||
      value === 'sse' ||
      value === 'websocket' ||
      value === 'websocket-cached'
    ) {
      return value
    }
    throw new Error(`invalid transport: ${String(value)}`)
  }

  private requireDefaultProjectTrust(value: AgentDefaultProjectTrust): AgentDefaultProjectTrust {
    if (value === 'ask' || value === 'always' || value === 'never') return value
    throw new Error(`invalid defaultProjectTrust: ${String(value)}`)
  }

  private requireBrowserCdpAccessMode(value: BrowserCdpAccessMode): BrowserCdpAccessMode {
    if (value === 'disabled' || value === 'safe' || value === 'full') return value
    throw new Error(`invalid browserCdpAccess: ${String(value)}`)
  }

  private requireBrowserWebPermissionMode(
    value: BrowserWebPermissionMode
  ): BrowserWebPermissionMode {
    if (value === 'disabled' || value === 'prompt' || value === 'full') return value
    throw new Error(`invalid browserWebPermissions: ${String(value)}`)
  }

  private requireDesktopCapabilityAccessMode(
    value: DesktopCapabilityAccessMode,
    field: string
  ): DesktopCapabilityAccessMode {
    if (value === 'safe' || value === 'full') return value
    throw new Error(`invalid ${field}: ${String(value)}`)
  }

  private requireDoubleEscapeAction(value: AgentDoubleEscapeAction): AgentDoubleEscapeAction {
    if (value === 'fork' || value === 'tree' || value === 'none') return value
    throw new Error(`invalid doubleEscapeAction: ${String(value)}`)
  }

  private requireTreeFilterMode(value: AgentTreeFilterMode): AgentTreeFilterMode {
    const valid: AgentTreeFilterMode[] = ['default', 'no-tools', 'user-only', 'labeled-only', 'all']
    if (valid.includes(value)) return value
    throw new Error(`invalid treeFilterMode: ${String(value)}`)
  }
}

interface SkillCommandMetadata {
  name: string
  description?: string
}

async function readSkillCommandMetadata(resourcePath: string): Promise<SkillCommandMetadata> {
  const skillFile = getSkillFilePath(resourcePath)
  const fallbackName = getSkillNameFromPath(resourcePath)
  try {
    const raw = await readFile(skillFile, 'utf-8')
    const frontmatter = parseSimpleFrontmatter(raw)
    return {
      name: frontmatter.name || fallbackName,
      description: frontmatter.description
    }
  } catch {
    return { name: fallbackName }
  }
}

function getSkillFilePath(resourcePath: string): string {
  const lowerName = basename(resourcePath).toLowerCase()
  if (lowerName === 'skill.md' || extname(resourcePath).toLowerCase() === '.md') {
    return resourcePath
  }
  return join(resourcePath, 'SKILL.md')
}

function getSkillNameFromPath(resourcePath: string): string {
  const normalized = resourcePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  const fileName = parts.at(-1) ?? ''
  if (fileName.toLowerCase() === 'skill.md' && parts.length >= 2) {
    return parts.at(-2) ?? fileName
  }
  if (extname(fileName)) {
    return fileName.replace(/\.[^.]+$/, '')
  }
  return basename(dirname(join(resourcePath, 'SKILL.md'))) || fileName
}

function parseSimpleFrontmatter(raw: string): Partial<SkillCommandMetadata> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) {
    return {}
  }
  const values: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!field) {
      continue
    }
    const key = field[1]
    const value = cleanFrontmatterString(field[2])
    if (key === 'name' || key === 'description') {
      values[key] = value
    }
  }
  return {
    name: values.name,
    description: values.description
  }
}

function cleanFrontmatterString(value: string): string {
  const trimmed = value.trim()
  const quoted = trimmed.match(/^(['"])(.*)\1$/)
  return (quoted ? quoted[2] : trimmed).trim()
}
