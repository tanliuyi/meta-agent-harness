/**
 * model-settings.ts - 模型设置页状态。
 *
 * 该 store 通过 preload 调用 main 进程模型设置服务，renderer 不直接读写配置文件
 * 或凭据。
 */

import type {
  CustomProviderSummary,
  ModelSettingsDiagnostic,
  ModelSettingsDiagnosticSeverity,
  ModelSettingsModelItem,
  ModelSettingsModelStatus,
  ModelSettingsSnapshot,
  ModelOAuthLoginEvent,
  ModelOAuthPromptRequest,
  ProviderCredentialStatus,
  LoginProviderOAuthInput,
  SetProviderApiKeyInput,
  ThinkingLevel,
  UpsertCustomProviderInput
} from '@shared/coding-agent/types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useToast } from '@renderer/composables/useToast'

export type ModelStatus = ModelSettingsModelStatus
export type DiagnosticSeverity = ModelSettingsDiagnosticSeverity
export type ModelScope =
  'default' | 'chat' | 'apply' | 'summarize' | 'title' | 'compact' | 'branchSummary'

export interface DefaultModelConfig {
  provider: string
  modelId: string
}

export interface ScopedModelConfig {
  scope: ModelScope
  provider?: string
  modelId?: string
  inheritsDefault: boolean
}

export interface ModelSettingsDraft {
  defaultModel: DefaultModelConfig
  thinkingLevel: ThinkingLevel
  enabledModels: string[]
}

export interface ModelOAuthLoginState {
  provider: string
  providerName?: string
  running: boolean
  authUrl?: string
  instructions?: string
  userCode?: string
  verificationUri?: string
  progress: string[]
  error?: string
  pendingPrompt?: ModelOAuthPromptRequest
}

const DEFAULT_DRAFT: ModelSettingsDraft = {
  defaultModel: {
    provider: '',
    modelId: ''
  },
  thinkingLevel: 'medium',
  enabledModels: []
}

const DEFAULT_SCOPES: ScopedModelConfig[] = [
  { scope: 'chat', inheritsDefault: true },
  { scope: 'apply', inheritsDefault: true },
  { scope: 'summarize', inheritsDefault: true },
  { scope: 'title', inheritsDefault: true },
  { scope: 'compact', inheritsDefault: true },
  { scope: 'branchSummary', inheritsDefault: true }
]

const useModelSettingsStore = defineStore('model-settings', () => {
  const toast = useToast()
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const snapshot = ref<ModelSettingsSnapshot | null>(null)
  const draft = ref<ModelSettingsDraft>(cloneDefaultDraft())
  const oauthLogins = ref<Record<string, ModelOAuthLoginState>>({})

  const hasSettingsApi = computed(() => true)
  const models = computed<ModelSettingsModelItem[]>(() => snapshot.value?.registry.models ?? [])
  const scopedModels = computed<ScopedModelConfig[]>(() => {
    const enabled = draft.value.enabledModels
    if (enabled.length === 0) {
      return [...DEFAULT_SCOPES]
    }
    return enabled.map((pattern, index) => ({
      scope: DEFAULT_SCOPES[index]?.scope ?? 'default',
      provider: pattern.includes('/') ? pattern.split('/')[0] : undefined,
      modelId: pattern,
      inheritsDefault: false
    }))
  })
  const credentialStatuses = computed<ProviderCredentialStatus[]>(
    () => snapshot.value?.credentials ?? []
  )
  const diagnostics = computed<ModelSettingsDiagnostic[]>(() => snapshot.value?.diagnostics ?? [])
  const customProviders = computed<CustomProviderSummary[]>(
    () => snapshot.value?.customProviders ?? []
  )

  const providers = computed(() => {
    return [...new Set(models.value.map((model) => model.provider))].sort((a, b) =>
      a.localeCompare(b)
    )
  })

  const selectedModel = computed(() => {
    const { provider, modelId } = draft.value.defaultModel
    return models.value.find((model) => model.provider === provider && model.id === modelId)
  })

  const apiUnavailableMessage = computed(() => '')
  const canSaveDefaultAndThinking = computed(() => !saving.value)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      applySnapshot(await window.api.codingAgent.getModelSettings())
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '模型配置加载失败'
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.refreshModelRegistry())
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '模型 registry 刷新失败'
    } finally {
      loading.value = false
    }
  }

  function updateDefaultProvider(provider: string): void {
    draft.value.defaultModel = {
      provider,
      modelId: ''
    }
  }

  function updateDefaultModel(modelId: string): void {
    draft.value.defaultModel = {
      ...draft.value.defaultModel,
      modelId
    }
  }

  function updateThinkingLevel(level: ThinkingLevel): void {
    draft.value.thinkingLevel = level
  }

  function updateEnabledModels(patterns: string[]): void {
    draft.value.enabledModels = patterns
  }

  async function save(): Promise<void> {
    saving.value = true
    error.value = null

    try {
      const { provider, modelId } = draft.value.defaultModel
      applySnapshot(
        await window.api.codingAgent.updateModelSettings({
          defaultProvider: provider || undefined,
          defaultModel: modelId || undefined,
          defaultThinkingLevel: draft.value.thinkingLevel,
          enabledModels: cleanStringList(draft.value.enabledModels)
        })
      )
      toast.success('模型配置已保存')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '模型配置保存失败'
      toast.error('模型配置保存失败', error.value)
    } finally {
      saving.value = false
    }
  }

  async function saveDefaultModelAndThinking(): Promise<void> {
    saving.value = true
    error.value = null

    try {
      const input: Parameters<typeof window.api.codingAgent.updateModelSettings>[0] = {
        defaultThinkingLevel: draft.value.thinkingLevel
      }
      const { provider, modelId } = draft.value.defaultModel
      if (provider && modelId) {
        if (!selectedModel.value) {
          throw new Error('当前默认模型不在模型注册表中，请先选择一个可用模型')
        }
        input.defaultProvider = provider
        input.defaultModel = modelId
      }
      applySnapshot(await window.api.codingAgent.updateModelSettings(input))
      toast.success('默认模型与思考已保存')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '默认模型与思考保存失败'
      toast.error('默认模型与思考保存失败', error.value)
    } finally {
      saving.value = false
    }
  }

  async function saveEnabledModels(): Promise<void> {
    saving.value = true
    error.value = null

    try {
      applySnapshot(
        await window.api.codingAgent.updateModelSettings({
          enabledModels: cleanStringList(draft.value.enabledModels)
        })
      )
      toast.success('任务模型已保存')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '任务模型保存失败'
      toast.error('任务模型保存失败', error.value)
    } finally {
      saving.value = false
    }
  }

  async function upsertCustomProvider(input: UpsertCustomProviderInput): Promise<void> {
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.upsertCustomProvider(input))
      toast.success('自定义 provider 已保存')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '自定义 provider 保存失败'
      toast.error('自定义 provider 保存失败', error.value)
    } finally {
      saving.value = false
    }
  }

  async function deleteCustomProvider(provider: string): Promise<void> {
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.deleteCustomProvider(provider))
      toast.success('自定义 provider 已删除')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '自定义 provider 删除失败'
      toast.error('自定义 provider 删除失败', error.value)
    } finally {
      saving.value = false
    }
  }

  async function setProviderApiKey(input: SetProviderApiKeyInput): Promise<void> {
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.setProviderApiKey(input))
      toast.success('API key 已保存')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'API key 保存失败'
      toast.error('API key 保存失败', error.value)
    } finally {
      saving.value = false
    }
  }

  async function clearProviderCredential(provider: string): Promise<void> {
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.setProviderApiKey({ provider, mode: 'clear' }))
      toast.success('Provider 凭据已清除')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Provider 凭据清除失败'
      toast.error('Provider 凭据清除失败', error.value)
    } finally {
      saving.value = false
    }
  }

  async function loginProviderOAuth(input: LoginProviderOAuthInput): Promise<void> {
    saving.value = true
    error.value = null
    oauthLogins.value = {
      ...oauthLogins.value,
      [input.provider]: {
        provider: input.provider,
        running: true,
        progress: ['正在启动 OAuth 登录']
      }
    }
    try {
      applySnapshot(await window.api.codingAgent.loginProviderOAuth(input))
      toast.success('OAuth 登录已完成')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'OAuth 登录失败'
      applyOAuthEvent({
        type: 'failed',
        provider: input.provider,
        message: error.value
      })
      toast.error('OAuth 登录失败', error.value)
    } finally {
      saving.value = false
    }
  }

  function applyOAuthEvent(event: ModelOAuthLoginEvent): void {
    const current = oauthLogins.value[event.provider] ?? {
      provider: event.provider,
      running: false,
      progress: []
    }
    const next: ModelOAuthLoginState = { ...current, progress: [...current.progress] }
    switch (event.type) {
      case 'started':
        next.providerName = event.providerName
        next.running = true
        next.error = undefined
        next.progress.push(`正在登录 ${event.providerName ?? event.provider}`)
        break
      case 'authUrl':
        next.authUrl = event.url
        next.instructions = event.instructions
        next.progress.push('已打开浏览器授权页面')
        break
      case 'deviceCode':
        next.userCode = event.userCode
        next.verificationUri = event.verificationUri
        next.progress.push('请在浏览器输入设备授权码')
        break
      case 'progress':
        next.progress.push(event.message)
        break
      case 'selection':
        next.progress.push(`已选择 ${event.selectedOptionId ?? '默认登录方式'}`)
        break
      case 'promptRequested':
        next.pendingPrompt = event
        next.progress.push(event.manualCode ? '等待手动授权码输入' : '等待输入')
        break
      case 'promptResolved':
        if (next.pendingPrompt?.requestId === event.requestId) {
          next.pendingPrompt = undefined
        }
        next.progress.push('已提交输入')
        break
      case 'succeeded':
        next.running = false
        next.error = undefined
        next.pendingPrompt = undefined
        next.progress.push('OAuth 登录完成')
        break
      case 'failed':
        next.running = false
        next.error = event.message
        next.pendingPrompt = undefined
        next.progress.push(event.message)
        break
    }
    oauthLogins.value = {
      ...oauthLogins.value,
      [event.provider]: next
    }
  }

  async function respondOAuthPrompt(
    provider: string,
    value: string,
    cancelled = false
  ): Promise<void> {
    const current = oauthLogins.value[provider]
    const pendingPrompt = current?.pendingPrompt
    if (!pendingPrompt) {
      return
    }
    try {
      await window.api.codingAgent.respondModelOAuthPrompt({
        provider,
        requestId: pendingPrompt.requestId,
        value,
        cancelled
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'OAuth 输入提交失败'
      applyOAuthEvent({
        type: 'failed',
        provider,
        message
      })
      toast.error('OAuth 输入提交失败', message)
    }
  }

  window.api.codingAgent.onEvent((event) => {
    if (event.type === 'modelOAuth') {
      applyOAuthEvent(event.event)
    }
  })

  function applySnapshot(nextSnapshot: ModelSettingsSnapshot): void {
    snapshot.value = nextSnapshot
    draft.value = {
      defaultModel: {
        provider: nextSnapshot.settings.defaultProvider ?? '',
        modelId: nextSnapshot.settings.defaultModel ?? ''
      },
      thinkingLevel: nextSnapshot.settings.defaultThinkingLevel ?? 'medium',
      enabledModels: nextSnapshot.settings.enabledModels ?? []
    }
  }

  return {
    loading,
    saving,
    error,
    snapshot,
    hasSettingsApi,
    draft,
    models,
    scopedModels,
    credentialStatuses,
    diagnostics,
    customProviders,
    oauthLogins,
    providers,
    selectedModel,
    apiUnavailableMessage,
    canSaveDefaultAndThinking,
    load,
    refresh,
    save,
    saveDefaultModelAndThinking,
    saveEnabledModels,
    upsertCustomProvider,
    deleteCustomProvider,
    setProviderApiKey,
    clearProviderCredential,
    loginProviderOAuth,
    respondOAuthPrompt,
    updateDefaultProvider,
    updateDefaultModel,
    updateThinkingLevel,
    updateEnabledModels
  }
})

function cloneDefaultDraft(): ModelSettingsDraft {
  return {
    defaultModel: { ...DEFAULT_DRAFT.defaultModel },
    thinkingLevel: DEFAULT_DRAFT.thinkingLevel,
    enabledModels: [...DEFAULT_DRAFT.enabledModels]
  }
}

function cleanStringList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

export default useModelSettingsStore
