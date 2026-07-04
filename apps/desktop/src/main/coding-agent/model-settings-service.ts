/**
 * model-settings-service.ts - Desktop 全局模型设置服务。
 *
 * 该服务运行在 Electron main 中，负责受控读写 Pi-compatible settings/models
 * 配置，并向 renderer 返回不包含密钥明文的 UI projection。
 */

import { app, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AuthStorage } from '../../../../../packages/coding-agent/src/core/auth-storage'
import { ModelRegistry } from '../../../../../packages/coding-agent/src/core/model-registry'
import { SettingsManager } from '../../../../../packages/coding-agent/src/core/settings-manager'
import { getAgentDir } from '../../../../../packages/coding-agent/src/config'
import type {
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
  ThinkingLevel,
  LoginProviderOAuthInput,
  SetProviderApiKeyInput,
  UpdateModelSettingsInput,
  UpsertCustomProviderInput
} from '@shared/coding-agent/types'

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
  models?: UpsertCustomProviderInput['models']
  modelOverrides?: UpsertCustomProviderInput['modelOverrides']
}

export interface ModelSettingsServiceOptions {
  agentDir?: string
  cwd?: string
}

export type ModelOAuthEventHandler = (event: ModelOAuthLoginEvent) => void

interface PendingOAuthPrompt {
  provider: string
  resolve: (value: string) => void
  reject: (error: Error) => void
}

/** Desktop 全局模型设置服务。 */
export class ModelSettingsService {
  private readonly agentDir: string
  private readonly cwd: string
  private readonly settingsPath: string
  private readonly modelsPath: string
  private readonly authPath: string
  private readonly authStorage: AuthStorage
  private readonly settingsManager: SettingsManager
  private readonly modelRegistry: ModelRegistry
  private modelsJsonLoadError: Error | undefined
  private readonly pendingOAuthPrompts = new Map<string, PendingOAuthPrompt>()

  constructor(options: ModelSettingsServiceOptions = {}) {
    this.agentDir = options.agentDir ?? getAgentDir()
    this.cwd = options.cwd ?? app.getPath('userData')
    this.settingsPath = join(this.agentDir, 'settings.json')
    this.modelsPath = join(this.agentDir, 'models.json')
    this.authPath = join(this.agentDir, 'auth.json')
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
    this.validateCustomProviderInput(input)
    const config = this.readModelsJsonForWrite()
    const providers = { ...(config.providers ?? {}) }
    const previous = providers[input.provider]
    providers[input.provider] = {
      ...this.toStoredProviderConfig(input),
      apiKey: input.apiKey ?? previous?.apiKey
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

  /** 保存 provider API key 到 Pi-compatible auth.json。 */
  async setProviderApiKey(input: SetProviderApiKeyInput): Promise<ModelSettingsSnapshot> {
    if (!input.provider.trim()) {
      throw new Error('provider is required')
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
    onEvent?: ModelOAuthEventHandler
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

    onEvent?.({ type: 'started', provider: providerId, providerName: provider.name })
    try {
      await this.authStorage.login(providerId, {
        onAuth: (info) => {
          onEvent?.({
            type: 'authUrl',
            provider: providerId,
            url: info.url,
            instructions: info.instructions
          })
          void shell.openExternal(info.url).catch((error) => {
            onEvent?.({
              type: 'progress',
              provider: providerId,
              message: `浏览器打开失败：${error instanceof Error ? error.message : String(error)}`
            })
          })
        },
        onDeviceCode: (info) => {
          onEvent?.({
            type: 'deviceCode',
            provider: providerId,
            userCode: info.userCode,
            verificationUri: info.verificationUri,
            intervalSeconds: info.intervalSeconds,
            expiresInSeconds: info.expiresInSeconds
          })
          void shell.openExternal(info.verificationUri).catch((error) => {
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
          return this.requestOAuthPrompt(providerId, prompt, onEvent)
        },
        onManualCodeInput: async () => {
          return this.requestOAuthPrompt(
            providerId,
            {
              message: '粘贴授权回调 URL 或授权码',
              placeholder: 'http://127.0.0.1:.../?code=... 或 code',
              allowEmpty: false,
              manualCode: true
            },
            onEvent
          )
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
      this.rejectPendingOAuthPrompts(providerId)
    }
  }

  /** 响应 OAuth 登录过程中的 renderer 输入请求。 */
  respondOAuthPrompt(input: ModelOAuthPromptResponseInput): void {
    const pending = this.pendingOAuthPrompts.get(input.requestId)
    if (!pending || pending.provider !== input.provider) {
      throw new Error(`OAuth prompt request not found: ${input.requestId}`)
    }
    this.pendingOAuthPrompts.delete(input.requestId)
    if (input.cancelled) {
      pending.reject(new Error('OAuth 输入已取消'))
      return
    }
    pending.resolve(input.value ?? '')
  }

  /** 强制刷新模型 registry。 */
  async refreshModelRegistry(): Promise<ModelSettingsSnapshot> {
    this.modelRegistry.refresh()
    return this.getModelSettings()
  }

  private requestOAuthPrompt(
    provider: string,
    prompt: {
      message: string
      placeholder?: string
      allowEmpty?: boolean
      manualCode?: boolean
    },
    onEvent?: ModelOAuthEventHandler
  ): Promise<string> {
    const requestId = randomUUID()
    return new Promise<string>((resolve, reject) => {
      this.pendingOAuthPrompts.set(requestId, { provider, resolve, reject })
      onEvent?.({
        type: 'promptRequested',
        provider,
        requestId,
        message: prompt.message,
        placeholder: prompt.placeholder,
        allowEmpty: prompt.allowEmpty,
        manualCode: prompt.manualCode
      })
    }).then((value) => {
      this.pendingOAuthPrompts.delete(requestId)
      if (prompt.allowEmpty === false && !value.trim()) {
        throw new Error(`${prompt.message} 不能为空`)
      }
      onEvent?.({ type: 'promptResolved', provider, requestId })
      return value
    })
  }

  private rejectPendingOAuthPrompts(provider?: string): void {
    for (const [requestId, pending] of this.pendingOAuthPrompts) {
      if (provider && pending.provider !== provider) {
        continue
      }
      this.pendingOAuthPrompts.delete(requestId)
      pending.reject(new Error('OAuth 登录已结束'))
    }
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
    const oauthProviders = new Set(this.authStorage.getOAuthProviders().map((provider) => provider.id))
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
        headers: value.headers,
        compat: value.compat,
        authHeader: value.authHeader,
        modelCount: value.models?.length ?? 0,
        models: value.models,
        modelOverrides: value.modelOverrides,
        overridesBuiltIn: this.modelRegistry.getAll().some((model) => model.provider === provider),
        hasApiKeyConfig: Boolean(value.apiKey)
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider))
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
    if (input.models?.length) {
      if (!input.baseUrl && input.models.some((model) => !model.baseUrl)) {
        throw new Error('baseUrl is required when defining custom models')
      }
      const seen = new Set<string>()
      for (const model of input.models) {
        if (!model.id.trim()) {
          throw new Error('model id is required')
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
      }
    }
  }

  private toStoredProviderConfig(input: UpsertCustomProviderInput): StoredCustomProviderConfig {
    return {
      name: input.name,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      api: input.api,
      headers: input.headers,
      compat: input.compat,
      authHeader: input.authHeader,
      models: input.models,
      modelOverrides: input.modelOverrides
    }
  }

  /** 测试清理用。 */
  dispose(): void {
    this.rejectPendingOAuthPrompts()
    try {
      rmSync(this.agentDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors in tests
    }
  }
}
