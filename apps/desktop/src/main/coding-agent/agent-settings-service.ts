/**
 * agent-settings-service.ts - Desktop 全局 Pi agent 设置服务。
 *
 * 该服务运行在 Electron main 中，负责通过 Pi-compatible SettingsManager 读写
 * getAgentDir()/settings.json 中的非模型配置。renderer 只能看到 UI projection，
 * 不能直接读写 settings.json。
 */

import { app } from 'electron'
import { join } from 'node:path'
import {
  SettingsManager,
  type PackageSource,
  type TransportSetting
} from '../../../../../packages/coding-agent/src/core/settings-manager'
import { DefaultPackageManager } from '../../../../../packages/coding-agent/src/core/package-manager'
import { buildResourcesSnapshot } from '../../../../../packages/coding-agent/src/core/resource-snapshot'
import type { ProgressEvent as PackageProgressEvent } from '../../../../../packages/coding-agent/src/core/package-manager'
import { getAgentDir } from '../../../../../packages/coding-agent/src/config'
import type {
  AgentDefaultProjectTrust,
  AgentDoubleEscapeAction,
  AgentQueueMode,
  AgentSettingsDiagnostic,
  AgentSettingsSnapshot,
  AgentTransportMode,
  AgentTreeFilterMode,
  ResourcePackageInput,
  ResourcePackageProgressEvent,
  ResourcePackageSummary,
  ResourceSnapshot,
  UpdateResourcePackageInput,
  UpdateAgentSettingsInput
} from '@shared/coding-agent/types'

export interface AgentSettingsServiceOptions {
  agentDir?: string
  cwd?: string
}

export type ResourcePackageEventHandler = (event: ResourcePackageProgressEvent) => void

/** Desktop 全局 Pi agent 设置服务。 */
export class AgentSettingsService {
  private readonly agentDir: string
  private readonly cwd: string
  private readonly settingsPath: string
  private readonly settingsManager: SettingsManager
  private readonly packageManager: DefaultPackageManager
  private packageOperationQueue: Promise<void> = Promise.resolve()

  constructor(options: AgentSettingsServiceOptions = {}) {
    this.agentDir = options.agentDir ?? getAgentDir()
    this.cwd = options.cwd ?? app.getPath('userData')
    this.settingsPath = join(this.agentDir, 'settings.json')
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
    this.applyDelivery(input.delivery)
    this.applyRuntime(input.runtime)
    this.applyDisplay(input.display)
    this.applySafety(input.safety)
    this.applyMedia(input.media)
    this.applyResources(input.resources)
    this.applyShell(input.shell)
    this.applyAdvanced(input.advanced)
    await this.settingsManager.flush()
    return this.getAgentSettings()
  }

  /** 列出 Pi package manager 配置包。 */
  async listResourcePackages(): Promise<ResourcePackageSummary[]> {
    await this.settingsManager.reload()
    return this.createResourcePackageSummaries()
  }

  /** 获取 Pi-compatible resource / extension 发现快照。 */
  async getResourceSnapshot(): Promise<ResourceSnapshot> {
    return buildResourcesSnapshot({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: this.settingsManager,
      packageManager: this.packageManager
    })
  }

  /** 新增并持久化 package source。 */
  async addResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]> {
    const source = this.requirePackageSource(input.source)
    return this.runPackageOperation(async () => {
      await this.settingsManager.reload()
      this.packageManager.addSourceToSettings(source, { local: input.local })
      await this.settingsManager.flush()
      return this.listResourcePackages()
    })
  }

  /** 安装并持久化 package source。 */
  async installResourcePackage(
    input: ResourcePackageInput,
    onEvent?: ResourcePackageEventHandler
  ): Promise<ResourcePackageSummary[]> {
    const source = this.requirePackageSource(input.source)
    return this.runPackageOperation(async () => {
      await this.settingsManager.reload()
      await this.withPackageProgress(onEvent, async () => {
        await this.packageManager.installAndPersist(source, { local: input.local })
        await this.settingsManager.flush()
      })
      return this.listResourcePackages()
    })
  }

  /** 移除并持久化 package source。 */
  async removeResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]> {
    const source = this.requirePackageSource(input.source)
    return this.runPackageOperation(async () => {
      await this.settingsManager.reload()
      this.packageManager.removeSourceFromSettings(source, { local: input.local })
      await this.settingsManager.flush()
      return this.listResourcePackages()
    })
  }

  /** 更新已配置 package source。 */
  async updateResourcePackage(
    input: UpdateResourcePackageInput = {},
    onEvent?: ResourcePackageEventHandler
  ): Promise<ResourcePackageSummary[]> {
    return this.runPackageOperation(async () => {
      await this.settingsManager.reload()
      await this.withPackageProgress(onEvent, async () => {
        await this.packageManager.update(input.source)
      })
      return this.listResourcePackages()
    })
  }

  /** 获取图片是否自动缩放。 */
  async getImageAutoResize(): Promise<boolean> {
    await this.settingsManager.reload()
    return this.settingsManager.getImageAutoResize()
  }

  private createSnapshot(): AgentSettingsSnapshot {
    return {
      delivery: {
        steeringMode: this.settingsManager.getSteeringMode(),
        followUpMode: this.settingsManager.getFollowUpMode(),
        transport: this.settingsManager.getTransport()
      },
      runtime: {
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
        httpProxy: this.settingsManager.getHttpProxy()
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

  private applyRuntime(input: UpdateAgentSettingsInput['runtime']): void {
    if (!input) return
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

  private applySafety(input: UpdateAgentSettingsInput['safety']): void {
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

  private createResourcePackageSummaries(): ResourcePackageSummary[] {
    return this.packageManager.listConfiguredPackages().map((item) => ({
      source: item.source,
      scope: item.scope,
      filtered: item.filtered,
      installedPath: item.installedPath
    }))
  }

  private async withPackageProgress<T>(
    onEvent: ResourcePackageEventHandler | undefined,
    operation: () => Promise<T>
  ): Promise<T> {
    this.packageManager.setProgressCallback(
      onEvent ? (event) => onEvent(this.toResourcePackageProgressEvent(event)) : undefined
    )
    try {
      return await operation()
    } finally {
      this.packageManager.setProgressCallback(undefined)
    }
  }

  private async runPackageOperation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.packageOperationQueue.then(operation, operation)
    this.packageOperationQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
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
