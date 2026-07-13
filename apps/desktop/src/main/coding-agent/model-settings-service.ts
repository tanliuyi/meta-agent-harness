/**
 * model-settings-service.ts - Desktop 全局模型设置服务。
 *
 * 该服务运行在 Electron main 中，负责受控读写 Pi-compatible settings/models
 * 配置，并向 renderer 返回不包含密钥明文的 UI projection。
 */

import { app, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AuthStorage } from '@coding-agent-src/core/auth-storage'
import { ModelRegistry } from '@coding-agent-src/core/model-registry'
import { SettingsManager } from '@coding-agent-src/core/settings-manager'
import { getAgentDir } from '@coding-agent-src/config'
import { normalizeAllowedExternalUrl } from './external-url'
import { readDesktopRuntimeConfig } from './desktop-runtime-config'
import type {
  CustomModelConfigFields,
  CustomModelConfigInput,
  CustomModelConfigSummary,
  CustomModelOverrideInput,
  CustomModelOverrideSummary,
  CustomProviderSummary,
  ModelProviderSummary,
  ModelRegistrySnapshot,
  ModelSettingsDiagnostic,
  ModelSettingsModelItem,
  ModelSettingsSnapshot,
  ModelOAuthLoginEvent,
  ModelOAuthPromptResponseInput,
  ProviderCredentialState,
  ProviderCredentialStatus,
  SensitiveConfigUpdate,
  ThinkingLevel,
  LoginProviderOAuthInput,
  SetProviderApiKeyInput,
  UpdateModelSettingsInput,
  UpsertCustomProviderInput
} from '@shared/coding-agent/types'
import { ModelOAuthPromptCoordinator, type ModelOAuthPromptSession } from './model-oauth-prompts'

interface ModelsJsonConfig {
  providers?: Record<string, StoredCustomProviderConfig>
}

interface StoredCustomProviderConfig {
  name?: string
  baseUrl?: string
  apiKey?: string
  api?: string
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  authHeader?: boolean
  models?: StoredCustomModelConfig[]
  modelOverrides?: Record<string, StoredCustomModelOverrideConfig>
}

type StoredCustomModelConfig = CustomModelConfigFields & {
  headers?: Record<string, string>
}

type StoredCustomModelOverrideConfig = CustomModelOverrideInput & {
  headers?: Record<string, string>
}

export interface ModelSettingsServiceOptions {
  agentDir?: string
  cwd?: string
  openExternal?: (url: string) => Promise<void>
}

export type ModelOAuthEventHandler = (event: ModelOAuthLoginEvent) => void

/** Desktop 全局模型设置服务。 */
export class ModelSettingsService {
  private readonly agentDir: string
  private readonly cwd: string
  private readonly settingsPath: string
  private readonly modelsPath: string
  private readonly authPath: string
  private readonly authStorage: AuthStorage
  private readonly openExternal: (url: string) => Promise<void>
  private readonly settingsManager: SettingsManager
  private readonly modelRegistry: ModelRegistry
  private modelsJsonLoadError: Error | undefined
  private readonly oauthPrompts = new ModelOAuthPromptCoordinator()
  private readonly activeOAuthProviderIds = new Set<string>()

  constructor(options: ModelSettingsServiceOptions = {}) {
    this.agentDir = options.agentDir ?? getAgentDir()
    this.cwd = options.cwd ?? app.getPath('userData')
    this.settingsPath = join(this.agentDir, 'settings.json')
    this.modelsPath = join(this.agentDir, 'models.json')
    this.authPath = join(this.agentDir, 'auth.json')
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url))
    mkdirSync(this.agentDir, { recursive: true })
    this.authStorage = AuthStorage.create(this.authPath)
    this.settingsManager = SettingsManager.create(this.cwd, this.agentDir, {
      projectTrusted: false
    })
    this.modelRegistry = ModelRegistry.create(this.authStorage, this.modelsPath)
  }

  /** 获取完整模型设置快照。 */
  async getModelSettings(): Promise<ModelSettingsSnapshot> {
    await this.settingsManager.reload()
    this.authStorage.reload()
    this.modelRegistry.refresh()
    return this.createSnapshot()
  }

  /** 更新全局默认模型、thinking level 和 enabled model patterns。 */
  async updateModelSettings(input: UpdateModelSettingsInput): Promise<ModelSettingsSnapshot> {
    this.modelRegistry.refresh()
    if (input.defaultProvider !== undefined || input.defaultModel !== undefined) {
      if (!input.defaultProvider || !input.defaultModel) {
        throw new Error('defaultProvider and defaultModel must be provided together')
      }
      const model = this.modelRegistry.find(input.defaultProvider, input.defaultModel)
      if (!model) {
        throw new Error(`model not found: ${input.defaultProvider}/${input.defaultModel}`)
      }
      this.settingsManager.setDefaultModelAndProvider(input.defaultProvider, input.defaultModel)
    }

    if (input.defaultThinkingLevel !== undefined) {
      this.settingsManager.setDefaultThinkingLevel(input.defaultThinkingLevel)
    }

    if (input.enabledModels !== undefined) {
      this.settingsManager.setEnabledModels(
        input.enabledModels.length > 0 ? input.enabledModels : undefined
      )
    }

    await this.settingsManager.flush()
    return this.getModelSettings()
  }

  /** 获取 registry 快照。 */
  async listModelRegistry(): Promise<ModelRegistrySnapshot> {
    return (await this.getModelSettings()).registry
  }

  /** 获取 provider 凭据状态。 */
  async listProviderCredentials(): Promise<ProviderCredentialStatus[]> {
    return (await this.getModelSettings()).credentials
  }

  /** 获取模型设置诊断。 */
  async listModelDiagnostics(): Promise<ModelSettingsDiagnostic[]> {
    return (await this.getModelSettings()).diagnostics
  }

  /** 获取自定义 provider 摘要。 */
  async listCustomProviders(): Promise<CustomProviderSummary[]> {
    return (await this.getModelSettings()).customProviders
  }

  /** 新增或更新自定义 provider。 */
  async upsertCustomProvider(input: UpsertCustomProviderInput): Promise<ModelSettingsSnapshot> {
    this.authStorage.reload()
    this.validateCustomProviderInput(input)
    const config = this.readModelsJsonForWrite()
    const providers = { ...(config.providers ?? {}) }
    const originalProvider = input.originalProvider?.trim()
    const isRename = Boolean(originalProvider && originalProvider !== input.provider)
    const previous = providers[originalProvider || input.provider]

    if (isRename && !previous) {
      throw new Error(`custom provider not found: ${originalProvider}`)
    }
    if (isRename && providers[input.provider]) {
      throw new Error(`custom provider already exists: ${input.provider}`)
    }

    this.validateModelIdentityChanges(input, previous)
    const nextProvider = this.toStoredProviderConfig(input, previous)
    this.assertRequestCredentialBoundary(
      originalProvider || input.provider,
      input,
      previous,
      nextProvider
    )
    providers[input.provider] = nextProvider
    if (isRename) {
      delete providers[originalProvider!]
    }
    this.writeModelsJson({ providers })

    this.modelRegistry.refresh()
    return this.getModelSettings()
  }

  /** 删除自定义 provider。 */
  async deleteCustomProvider(provider: string): Promise<ModelSettingsSnapshot> {
    const config = this.readModelsJsonForWrite()
    const providers = { ...(config.providers ?? {}) }
    if (!providers[provider]) {
      throw new Error(`custom provider not found: ${provider}`)
    }
    delete providers[provider]
    this.writeModelsJson({ providers })
    this.modelRegistry.refresh()
    return this.getModelSettings()
  }

  /** 保存或清除 Pi-compatible auth.json 中的 provider 凭据。 */
  async setProviderApiKey(input: SetProviderApiKeyInput): Promise<ModelSettingsSnapshot> {
    if (!input.provider.trim()) {
      throw new Error('provider is required')
    }
    if (input.mode === 'clear') {
      this.authStorage.remove(input.provider)
      this.authStorage.reload()
      this.modelRegistry.refresh()
      return this.getModelSettings()
    }
    if (!input.key.trim()) {
      throw new Error('api key is required')
    }
    this.authStorage.set(input.provider, {
      type: 'api_key',
      key: input.key,
      env: input.env
    })
    this.authStorage.reload()
    this.modelRegistry.refresh()
    return this.getModelSettings()
  }

  /** 使用 OAuth 登录 provider，并写入 Pi-compatible auth.json。 */
  async loginProviderOAuth(
    input: LoginProviderOAuthInput,
    onEvent?: ModelOAuthEventHandler,
    session: ModelOAuthPromptSession = {}
  ): Promise<ModelSettingsSnapshot> {
    const providerId = input.provider.trim()
    if (!providerId) {
      throw new Error('provider is required')
    }
    this.modelRegistry.refresh()
    const provider = this.authStorage.getOAuthProviders().find((item) => item.id === providerId)
    if (!provider) {
      throw new Error(`provider does not support OAuth: ${providerId}`)
    }
    if (this.activeOAuthProviderIds.has(providerId)) {
      throw new Error(`OAuth login is already in progress for provider: ${providerId}`)
    }
    const loginId = randomUUID()
    this.activeOAuthProviderIds.add(providerId)

    try {
      onEvent?.({ type: 'started', provider: providerId, providerName: provider.name })
      await this.authStorage.login(providerId, {
        signal: session.signal,
        onAuth: (info) => {
          const authUrl = normalizeOAuthExternalUrl(info.url, this.cwd)
          onEvent?.({
            type: 'authUrl',
            provider: providerId,
            url: authUrl,
            instructions: info.instructions
          })
          void this.openExternal(authUrl).catch((error) => {
            onEvent?.({
              type: 'progress',
              provider: providerId,
              message: `浏览器打开失败：${error instanceof Error ? error.message : String(error)}`
            })
          })
        },
        onDeviceCode: (info) => {
          const verificationUri = normalizeOAuthExternalUrl(info.verificationUri, this.cwd)
          onEvent?.({
            type: 'deviceCode',
            provider: providerId,
            userCode: info.userCode,
            verificationUri,
            intervalSeconds: info.intervalSeconds,
            expiresInSeconds: info.expiresInSeconds
          })
          void this.openExternal(verificationUri).catch((error) => {
            onEvent?.({
              type: 'progress',
              provider: providerId,
              message: `浏览器打开失败：${error instanceof Error ? error.message : String(error)}`
            })
          })
        },
        onProgress: (message) => {
          onEvent?.({ type: 'progress', provider: providerId, message })
        },
        onSelect: async (prompt) => {
          const selectedOptionId =
            prompt.options.find((option) => option.id === input.selectOptionId)?.id ??
            prompt.options[0]?.id
          onEvent?.({
            type: 'selection',
            provider: providerId,
            message: prompt.message,
            selectedOptionId,
            options: prompt.options.map((option) => ({ id: option.id, label: option.label }))
          })
          return selectedOptionId
        },
        onPrompt: async (prompt) => {
          return this.oauthPrompts.request({
            loginId,
            provider: providerId,
            ownerId: session.ownerId,
            prompt,
            signal: session.signal,
            timeoutMs: session.promptTimeoutMs,
            onEvent
          })
        },
        onManualCodeInput: async () => {
          return this.oauthPrompts.request({
            loginId,
            provider: providerId,
            ownerId: session.ownerId,
            prompt: {
              message: '粘贴授权回调 URL 或授权码',
              placeholder: 'http://127.0.0.1:.../?code=... 或 code',
              allowEmpty: false,
              manualCode: true
            },
            signal: session.signal,
            timeoutMs: session.promptTimeoutMs,
            onEvent
          })
        }
      })
      this.authStorage.reload()
      this.modelRegistry.refresh()
      onEvent?.({ type: 'succeeded', provider: providerId })
      return this.getModelSettings()
    } catch (error) {
      onEvent?.({
        type: 'failed',
        provider: providerId,
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    } finally {
      this.oauthPrompts.rejectLogin(loginId)
      this.activeOAuthProviderIds.delete(providerId)
    }
  }

  /** 响应 OAuth 登录过程中的 renderer 输入请求。 */
  respondOAuthPrompt(input: ModelOAuthPromptResponseInput, ownerId?: number): void {
    this.oauthPrompts.respond(input, ownerId)
  }

  /** 强制刷新模型 registry。 */
  async refreshModelRegistry(): Promise<ModelSettingsSnapshot> {
    this.modelRegistry.refresh()
    return this.getModelSettings()
  }

  private createSnapshot(): ModelSettingsSnapshot {
    const registry = this.createRegistrySnapshot()
    const credentials = this.createCredentialStatuses(registry.providers)
    const diagnostics = this.createDiagnostics()

    return {
      settings: {
        defaultProvider: this.settingsManager.getDefaultProvider(),
        defaultModel: this.settingsManager.getDefaultModel(),
        defaultThinkingLevel: this.settingsManager.getDefaultThinkingLevel(),
        enabledModels: this.settingsManager.getGlobalSettings().enabledModels
      },
      registry,
      credentials,
      diagnostics,
      customProviders: this.createCustomProviderSummaries(),
      storage: {
        agentDir: this.agentDir,
        settingsPath: this.settingsPath,
        modelsPath: this.modelsPath
      }
    }
  }

  private createRegistrySnapshot(): ModelRegistrySnapshot {
    const availableKeys = new Set(
      this.modelRegistry.getAvailable().map((model) => this.getModelKey(model.provider, model.id))
    )
    const modelsJson = this.readModelsJson()
    const customProviders = new Set(Object.keys(modelsJson.providers ?? {}))
    const allModels = this.modelRegistry.getAll()
    const models: ModelSettingsModelItem[] = allModels.map((model) => ({
      provider: model.provider,
      id: model.id,
      displayName: model.name,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
      supportsTools: true,
      supportsImages: model.input?.includes('image') ?? false,
      supportsReasoning: Boolean(model.reasoning),
      thinkingLevels: this.getThinkingLevels(model.thinkingLevelMap, Boolean(model.reasoning)),
      source: customProviders.has(model.provider) ? 'custom' : 'builtin',
      status: availableKeys.has(this.getModelKey(model.provider, model.id))
        ? 'available'
        : 'missingAuth'
    }))

    const providers = this.createProviderSummaries(models)
    return {
      models,
      providers,
      loadError: this.modelRegistry.getError(),
      refreshedAt: new Date().toISOString()
    }
  }

  private createProviderSummaries(models: ModelSettingsModelItem[]): ModelProviderSummary[] {
    const customProviders = new Set(Object.keys(this.readModelsJson().providers ?? {}))
    const summaries = new Map<string, ModelProviderSummary>()
    for (const model of models) {
      const credentialStatus = this.mapAuthStatus(model.provider)
      const existing =
        summaries.get(model.provider) ??
        ({
          id: model.provider,
          displayName: this.modelRegistry.getProviderDisplayName(model.provider),
          source: customProviders.has(model.provider) ? 'custom' : 'builtin',
          modelCount: 0,
          availableModelCount: 0,
          credentialStatus
        } satisfies ModelProviderSummary)
      existing.modelCount += 1
      if (model.status === 'available') {
        existing.availableModelCount += 1
      }
      summaries.set(model.provider, existing)
    }
    return [...summaries.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  private createCredentialStatuses(providers: ModelProviderSummary[]): ProviderCredentialStatus[] {
    const oauthProviders = new Set(
      this.authStorage.getOAuthProviders().map((provider) => provider.id)
    )
    return providers.map((provider) => {
      const authStatus = this.modelRegistry.getProviderAuthStatus(provider.id)
      return {
        provider: provider.id,
        status: this.mapAuthStatus(provider.id),
        source: this.mapCredentialSource(authStatus.source),
        oauthAvailable: oauthProviders.has(provider.id),
        message: authStatus.label
      }
    })
  }

  private createDiagnostics(): ModelSettingsDiagnostic[] {
    const diagnostics: ModelSettingsDiagnostic[] = []
    const registryError = this.modelRegistry.getError()
    if (registryError) {
      diagnostics.push({
        id: 'models-json-load-error',
        severity: 'error',
        source: 'modelRegistry',
        message: 'models.json 加载失败',
        details: registryError
      })
    }
    if (this.modelsJsonLoadError) {
      diagnostics.push({
        id: 'models-json-parse-error',
        severity: 'error',
        source: 'modelRegistry',
        message: 'models.json 解析失败',
        details: this.modelsJsonLoadError.message
      })
    }
    for (const error of this.settingsManager.drainErrors()) {
      diagnostics.push({
        id: `settings-${error.scope}-${diagnostics.length}`,
        severity: 'error',
        source: 'settings',
        message: `${error.scope} settings 加载或保存失败`,
        details: error.error.message
      })
    }
    for (const error of this.authStorage.drainErrors()) {
      diagnostics.push({
        id: `auth-${diagnostics.length}`,
        severity: 'error',
        source: 'auth',
        message: '凭据状态加载失败',
        details: error.message
      })
    }
    return diagnostics
  }

  private createCustomProviderSummaries(): CustomProviderSummary[] {
    const config = this.readModelsJson()
    return Object.entries(config.providers ?? {})
      .map(([provider, value]) => ({
        provider,
        name: value.name,
        baseUrl: value.baseUrl,
        api: value.api,
        compat: value.compat,
        authHeader: value.authHeader,
        modelCount: value.models?.length ?? 0,
        models: value.models?.map((model) => this.toCustomModelSummary(model)),
        modelOverrides: value.modelOverrides
          ? Object.fromEntries(
              Object.entries(value.modelOverrides).map(([modelId, modelOverride]) => [
                modelId,
                this.toCustomModelOverrideSummary(modelOverride)
              ])
            )
          : undefined,
        overridesBuiltIn: this.modelRegistry.getAll().some((model) => model.provider === provider),
        hasApiKeyConfig: Boolean(value.apiKey),
        hasHeadersConfig: this.hasConfiguredHeaders(value.headers)
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider))
  }

  private toCustomModelSummary(model: StoredCustomModelConfig): CustomModelConfigSummary {
    return {
      ...this.toStoredModelFields(model),
      hasHeadersConfig: this.hasConfiguredHeaders(model.headers)
    }
  }

  private toCustomModelOverrideSummary(
    modelOverride: StoredCustomModelOverrideConfig
  ): CustomModelOverrideSummary {
    return {
      ...this.toStoredModelOverrideFields(modelOverride),
      hasHeadersConfig: this.hasConfiguredHeaders(modelOverride.headers)
    }
  }

  private hasConfiguredHeaders(headers: Record<string, string> | undefined): boolean {
    return Boolean(headers && Object.keys(headers).length > 0)
  }

  private mapAuthStatus(provider: string): ProviderCredentialState {
    const authStatus = this.modelRegistry.getProviderAuthStatus(provider)
    if (authStatus.configured) {
      return 'configured'
    }
    return 'missing'
  }

  private mapCredentialSource(
    source: ReturnType<ModelRegistry['getProviderAuthStatus']>['source']
  ): ProviderCredentialStatus['source'] {
    if (!source) {
      return undefined
    }
    if (source === 'stored') {
      return 'credentialStore'
    }
    if (source === 'environment') {
      return 'env'
    }
    if (source === 'fallback') {
      return undefined
    }
    return source
  }

  private getThinkingLevels(
    map: Record<string, string | null | undefined> | undefined,
    supportsReasoning: boolean
  ): ThinkingLevel[] {
    if (!supportsReasoning) {
      return ['off']
    }
    const levels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    return levels.filter((level) => map?.[level] !== null)
  }

  private getModelKey(provider: string, id: string): string {
    return `${provider}:${id}`
  }

  private readModelsJson(): ModelsJsonConfig {
    if (!existsSync(this.modelsPath)) {
      this.modelsJsonLoadError = undefined
      return { providers: {} }
    }
    try {
      const parsed = JSON.parse(readFileSync(this.modelsPath, 'utf-8')) as ModelsJsonConfig
      this.modelsJsonLoadError = undefined
      return parsed
    } catch (error) {
      this.modelsJsonLoadError = error instanceof Error ? error : new Error(String(error))
      return { providers: {} }
    }
  }

  private readModelsJsonForWrite(): ModelsJsonConfig {
    const config = this.readModelsJson()
    if (this.modelsJsonLoadError) {
      throw new Error(`models.json 解析失败: ${this.modelsJsonLoadError.message}`)
    }
    return config
  }

  private writeModelsJson(config: ModelsJsonConfig): void {
    mkdirSync(dirname(this.modelsPath), { recursive: true })
    const tempPath = `${this.modelsPath}.${process.pid}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600
    })
    renameSync(tempPath, this.modelsPath)
  }

  private validateCustomProviderInput(input: UpsertCustomProviderInput): void {
    if (!input.provider.trim()) {
      throw new Error('provider is required')
    }
    this.validateSensitiveConfigUpdate(
      input.apiKeyUpdate,
      'apiKeyUpdate',
      (value) => typeof value === 'string' && Boolean(value.trim())
    )
    this.validateSensitiveConfigUpdate(input.headersUpdate, 'headersUpdate', (value) =>
      this.isStringRecord(value)
    )
    this.validateSensitiveConfigUpdate(
      input.modelOverrideHeadersUpdate,
      'modelOverrideHeadersUpdate',
      (value) => this.isNestedStringRecord(value)
    )
    if (input.modelOverrideHeadersUpdate?.mode === 'replace') {
      const modelOverrides = input.modelOverrides ?? {}
      for (const modelId of Object.keys(input.modelOverrideHeadersUpdate.value)) {
        if (!Object.hasOwn(modelOverrides, modelId)) {
          throw new Error(`model override headers reference unknown model: ${modelId}`)
        }
      }
    }
    if (input.models?.length) {
      if (!input.baseUrl && input.models.some((model) => !model.baseUrl)) {
        throw new Error('baseUrl is required when defining custom models')
      }
      const seen = new Set<string>()
      for (const model of input.models) {
        if (!model.id.trim()) {
          throw new Error('model id is required')
        }
        if (
          model.previousId !== undefined &&
          (typeof model.previousId !== 'string' || !model.previousId.trim())
        ) {
          throw new Error(`previous model id is invalid for model: ${model.id}`)
        }
        if (seen.has(model.id)) {
          throw new Error(`duplicate model id: ${model.id}`)
        }
        seen.add(model.id)
        if (!input.api && !model.api) {
          throw new Error(`api is required for model: ${model.id}`)
        }
        if (model.contextWindow !== undefined && model.contextWindow <= 0) {
          throw new Error(`contextWindow must be greater than 0 for model: ${model.id}`)
        }
        if (model.maxTokens !== undefined && model.maxTokens <= 0) {
          throw new Error(`maxTokens must be greater than 0 for model: ${model.id}`)
        }
        this.validateSensitiveConfigUpdate(
          model.headersUpdate,
          `headersUpdate for model: ${model.id}`,
          (value) => this.isStringRecord(value)
        )
      }
    }
  }

  private toStoredProviderConfig(
    input: UpsertCustomProviderInput,
    previous: StoredCustomProviderConfig | undefined
  ): StoredCustomProviderConfig {
    return {
      name: input.name,
      baseUrl: input.baseUrl,
      apiKey: this.resolveSensitiveConfigUpdate(previous?.apiKey, input.apiKeyUpdate),
      api: input.api,
      headers: this.resolveSensitiveConfigUpdate(previous?.headers, input.headersUpdate),
      compat: input.compat,
      authHeader: input.authHeader,
      models: this.toStoredModels(input.models, previous?.models),
      modelOverrides: this.toStoredModelOverrides(
        input.modelOverrides,
        previous?.modelOverrides,
        input.modelOverrideHeadersUpdate
      )
    }
  }

  private assertRequestCredentialBoundary(
    previousProviderId: string,
    input: UpsertCustomProviderInput,
    previous: StoredCustomProviderConfig | undefined,
    next: StoredCustomProviderConfig
  ): void {
    const previousTargets = previous
      ? this.getProviderRequestTargets(previousProviderId, previous)
      : new Set<string>()
    const nextTargets = this.getProviderRequestTargets(input.provider, next)
    const introducesNewTarget =
      !previous || [...nextTargets].some((target) => !previousTargets.has(target))

    if (
      introducesNewTarget &&
      (this.activeOAuthProviderIds.has(previousProviderId) ||
        this.activeOAuthProviderIds.has(input.provider))
    ) {
      throw new Error(
        'provider identity or request targets cannot change while OAuth login is in progress'
      )
    }
    if (
      introducesNewTarget &&
      (this.authStorage.hasAuth(previousProviderId) || this.authStorage.hasAuth(input.provider))
    ) {
      throw new Error(
        'stored provider credential must be cleared before changing provider identity or request targets'
      )
    }
    if (!previous) {
      return
    }

    if (introducesNewTarget) {
      this.assertSensitiveConfigIsNotPreserved(previous.apiKey, input.apiKeyUpdate, 'apiKeyUpdate')
      this.assertSensitiveConfigIsNotPreserved(
        previous.headers,
        input.headersUpdate,
        'headersUpdate'
      )
    }

    const previousModels = new Map(previous.models?.map((model) => [model.id, model]) ?? [])
    for (const [index, inputModel] of (input.models ?? []).entries()) {
      const previousModel = previousModels.get(inputModel.previousId?.trim() || inputModel.id)
      if (!this.hasSensitiveConfig(previousModel?.headers)) {
        continue
      }
      if (
        inputModel.headersUpdate?.mode === 'replace' ||
        inputModel.headersUpdate?.mode === 'clear'
      ) {
        continue
      }
      const nextModel = next.models?.[index]
      if (
        !nextModel ||
        this.getModelRequestTarget(previousProviderId, previous, previousModel!) !==
          this.getModelRequestTarget(input.provider, next, nextModel)
      ) {
        throw new Error(
          `headersUpdate for model ${inputModel.id} cannot preserve headers across request targets`
        )
      }
    }

    if (!input.modelOverrideHeadersUpdate || input.modelOverrideHeadersUpdate.mode === 'preserve') {
      for (const modelId of Object.keys(next.modelOverrides ?? {})) {
        const previousOverride = previous.modelOverrides?.[modelId]
        if (!this.hasSensitiveConfig(previousOverride?.headers)) {
          continue
        }
        if (
          this.getModelOverrideRequestTarget(previousProviderId, previous, modelId) !==
          this.getModelOverrideRequestTarget(input.provider, next, modelId)
        ) {
          throw new Error(
            `modelOverrideHeadersUpdate cannot preserve headers for ${modelId} across request targets`
          )
        }
      }
    }
  }

  private validateModelIdentityChanges(
    input: UpsertCustomProviderInput,
    previous: StoredCustomProviderConfig | undefined
  ): void {
    const previousModelIds = new Set(previous?.models?.map((model) => model.id) ?? [])
    const claimedPreviousIds = new Set<string>()
    for (const model of input.models ?? []) {
      const previousId = model.previousId?.trim()
      if (!previousId) {
        continue
      }
      if (!previousModelIds.has(previousId)) {
        throw new Error(`previous model id does not exist: ${previousId}`)
      }
      if (claimedPreviousIds.has(previousId)) {
        throw new Error(`previous model id is claimed more than once: ${previousId}`)
      }
      claimedPreviousIds.add(previousId)
      if (previousId !== model.id && previousModelIds.has(model.id)) {
        throw new Error(`model rename target already exists: ${model.id}`)
      }
    }
  }

  private assertSensitiveConfigIsNotPreserved<T>(
    previous: T | undefined,
    update: SensitiveConfigUpdate<T> | undefined,
    label: string
  ): void {
    if (this.hasSensitiveConfig(previous) && (!update || update.mode === 'preserve')) {
      throw new Error(`${label} cannot preserve sensitive configuration across request targets`)
    }
  }

  private hasSensitiveConfig(value: unknown): boolean {
    if (typeof value === 'string') {
      return Boolean(value)
    }
    return Boolean(
      value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
    )
  }

  private getProviderRequestTargets(
    providerId: string,
    provider: StoredCustomProviderConfig
  ): Set<string> {
    const targets = new Set<string>()
    const models = provider.models ?? []
    for (const model of models) {
      targets.add(this.getModelRequestTarget(providerId, provider, model))
    }
    if (models.length === 0 || models.some((model) => !model.baseUrl)) {
      targets.add(this.getRequestTarget(providerId, provider.baseUrl, provider.api))
    }
    for (const modelId of Object.keys(provider.modelOverrides ?? {})) {
      targets.add(this.getModelOverrideRequestTarget(providerId, provider, modelId))
    }
    return targets
  }

  private getModelRequestTarget(
    providerId: string,
    provider: StoredCustomProviderConfig,
    model: StoredCustomModelConfig
  ): string {
    return this.getRequestTarget(
      providerId,
      model.baseUrl ?? provider.baseUrl,
      model.api ?? provider.api
    )
  }

  private getModelOverrideRequestTarget(
    providerId: string,
    provider: StoredCustomProviderConfig,
    modelId: string
  ): string {
    return JSON.stringify([
      this.getRequestTarget(providerId, provider.baseUrl, provider.api),
      modelId
    ])
  }

  private getRequestTarget(
    providerId: string,
    baseUrl: string | undefined,
    api: string | undefined
  ): string {
    let normalizedBaseUrl = baseUrl?.trim() || '<inherited>'
    try {
      const parsed = new URL(normalizedBaseUrl)
      parsed.hash = ''
      normalizedBaseUrl = parsed.toString()
    } catch {
      // Invalid URLs are diagnosed by the model registry; preserve their exact request identity here.
    }
    return JSON.stringify([providerId.trim(), normalizedBaseUrl, api?.trim() || '<inherited>'])
  }

  private toStoredModels(
    models: CustomModelConfigInput[] | undefined,
    previousModels: StoredCustomModelConfig[] | undefined
  ): StoredCustomModelConfig[] | undefined {
    if (!models) {
      return undefined
    }
    const previousById = new Map(previousModels?.map((model) => [model.id, model]) ?? [])
    return models.map((model) => ({
      ...this.toStoredModelFields(model),
      headers: this.resolveSensitiveConfigUpdate(
        previousById.get(model.previousId?.trim() || model.id)?.headers,
        model.headersUpdate
      )
    }))
  }

  private toStoredModelOverrides(
    modelOverrides: Record<string, CustomModelOverrideInput> | undefined,
    previousOverrides: Record<string, StoredCustomModelOverrideConfig> | undefined,
    headersUpdate: SensitiveConfigUpdate<Record<string, Record<string, string>>> | undefined
  ): Record<string, StoredCustomModelOverrideConfig> | undefined {
    if (!modelOverrides) {
      return undefined
    }
    const previousHeaders = Object.fromEntries(
      Object.entries(previousOverrides ?? {}).flatMap(([modelId, modelOverride]) =>
        modelOverride.headers ? [[modelId, modelOverride.headers]] : []
      )
    )
    const nextHeaders = this.resolveSensitiveConfigUpdate(
      Object.keys(previousHeaders).length > 0 ? previousHeaders : undefined,
      headersUpdate
    )
    return Object.fromEntries(
      Object.entries(modelOverrides).map(([modelId, modelOverride]) => [
        modelId,
        {
          ...this.toStoredModelOverrideFields(modelOverride),
          headers: nextHeaders?.[modelId]
        }
      ])
    )
  }

  private toStoredModelFields(model: CustomModelConfigFields): CustomModelConfigFields {
    return {
      id: model.id,
      name: model.name,
      api: model.api,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      thinkingLevelMap: model.thinkingLevelMap,
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: model.cost,
      compat: model.compat
    }
  }

  private toStoredModelOverrideFields(
    modelOverride: CustomModelOverrideInput
  ): CustomModelOverrideInput {
    return {
      name: modelOverride.name,
      reasoning: modelOverride.reasoning,
      thinkingLevelMap: modelOverride.thinkingLevelMap,
      input: modelOverride.input,
      contextWindow: modelOverride.contextWindow,
      maxTokens: modelOverride.maxTokens,
      cost: modelOverride.cost,
      compat: modelOverride.compat
    }
  }

  private resolveSensitiveConfigUpdate<T>(
    previous: T | undefined,
    update: SensitiveConfigUpdate<T> | undefined
  ): T | undefined {
    if (!update || update.mode === 'preserve') {
      return previous
    }
    if (update.mode === 'clear') {
      return undefined
    }
    return update.value
  }

  private validateSensitiveConfigUpdate<T>(
    update: SensitiveConfigUpdate<T> | undefined,
    label: string,
    validateValue: (value: unknown) => boolean
  ): void {
    if (update === undefined) {
      return
    }
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new Error(`${label} must be a sensitive config update`)
    }
    if (update.mode === 'preserve' || update.mode === 'clear') {
      return
    }
    if (update.mode !== 'replace' || !validateValue(update.value)) {
      throw new Error(`${label} has an invalid replacement value`)
    }
  }

  private isStringRecord(value: unknown): value is Record<string, string> {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(([key, item]) => Boolean(key.trim()) && typeof item === 'string')
    )
  }

  private isNestedStringRecord(value: unknown): value is Record<string, Record<string, string>> {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(([key, item]) => Boolean(key.trim()) && this.isStringRecord(item))
    )
  }

  /** 测试清理用。 */
  dispose(): void {
    this.oauthPrompts.dispose()
    try {
      rmSync(this.agentDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors in tests
    }
  }
}

function normalizeOAuthExternalUrl(uri: string, cwd: string): string {
  const accessMode = readDesktopRuntimeConfig(
    join(cwd, 'desktop-runtime.json')
  ).externalProtocolAccess
  const normalized = normalizeAllowedExternalUrl(uri, accessMode)
  const protocol = new URL(normalized).protocol
  if (accessMode !== 'full' && protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`OAuth URL protocol is not allowed: ${protocol}`)
  }
  return normalized
}
