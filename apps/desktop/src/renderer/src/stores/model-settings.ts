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
  ProviderCredentialStatus,
  SetProviderApiKeyInput,
  ThinkingLevel,
  UpsertCustomProviderInput
} from '@shared/coding-agent/types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const snapshot = ref<ModelSettingsSnapshot | null>(null)
  const draft = ref<ModelSettingsDraft>(cloneDefaultDraft())

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
  const canSave = computed(() => !saving.value)
  const canSaveDefaultModel = computed(() => {
    const { provider, modelId } = draft.value.defaultModel
    return Boolean(provider && modelId && selectedModel.value && !saving.value)
  })

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
          enabledModels: draft.value.enabledModels
        })
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '模型配置保存失败'
    } finally {
      saving.value = false
    }
  }

  async function saveDefaultModel(): Promise<void> {
    saving.value = true
    error.value = null

    try {
      const { provider, modelId } = draft.value.defaultModel
      if (!provider || !modelId) {
        throw new Error('请选择 provider 和 model 后再保存默认模型')
      }
      if (!selectedModel.value) {
        throw new Error('当前默认模型不在模型注册表中，请先选择一个可用模型')
      }
      applySnapshot(
        await window.api.codingAgent.updateModelSettings({
          defaultProvider: provider,
          defaultModel: modelId
        })
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '默认模型保存失败'
    } finally {
      saving.value = false
    }
  }

  async function saveThinkingLevel(): Promise<void> {
    saving.value = true
    error.value = null

    try {
      applySnapshot(
        await window.api.codingAgent.updateModelSettings({
          defaultThinkingLevel: draft.value.thinkingLevel
        })
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Thinking 保存失败'
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
          enabledModels: draft.value.enabledModels
        })
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '任务模型保存失败'
    } finally {
      saving.value = false
    }
  }

  async function upsertCustomProvider(input: UpsertCustomProviderInput): Promise<void> {
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.upsertCustomProvider(input))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '自定义 provider 保存失败'
    } finally {
      saving.value = false
    }
  }

  async function deleteCustomProvider(provider: string): Promise<void> {
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.deleteCustomProvider(provider))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '自定义 provider 删除失败'
    } finally {
      saving.value = false
    }
  }

  async function setProviderApiKey(input: SetProviderApiKeyInput): Promise<void> {
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.setProviderApiKey(input))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'API key 保存失败'
    } finally {
      saving.value = false
    }
  }

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
    providers,
    selectedModel,
    apiUnavailableMessage,
    canSave,
    canSaveDefaultModel,
    load,
    refresh,
    save,
    saveDefaultModel,
    saveThinkingLevel,
    saveEnabledModels,
    upsertCustomProvider,
    deleteCustomProvider,
    setProviderApiKey,
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

export default useModelSettingsStore
