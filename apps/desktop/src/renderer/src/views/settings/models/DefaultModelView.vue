<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import useModelSettingsStore from '@renderer/stores/model-settings'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const modelSettings = useModelSettingsStore()

const defaultModelLabel = computed(() => {
  const { provider, modelId } = modelSettings.draft.defaultModel
  if (!provider || !modelId) return '尚未配置'
  return `${provider}/${modelId}`
})

const selectedModelMissing = computed(() => {
  const { provider, modelId } = modelSettings.draft.defaultModel
  return Boolean(provider && modelId && !modelSettings.selectedModel)
})

const selectedModelStatusLabel = computed(() => {
  const model = modelSettings.selectedModel
  if (!model) return selectedModelMissing.value ? '不在 registry 中' : '等待选择'
  switch (model.status) {
    case 'available':
      return '可用'
    case 'missingAuth':
      return '缺少凭据'
    case 'invalid':
      return '无效'
    case 'disabled':
      return '已禁用'
  }
})

const selectedModelStatusTone = computed<'neutral' | 'success' | 'warning' | 'info'>(() => {
  const status = modelSettings.selectedModel?.status
  if (status === 'available') return 'success'
  if (status === 'missingAuth' || status === 'invalid') return 'warning'
  return 'neutral'
})

const selectedModelCapabilities = computed(() => {
  const model = modelSettings.selectedModel
  return [
    { label: 'Tools', enabled: Boolean(model?.supportsTools) },
    { label: 'Images', enabled: Boolean(model?.supportsImages) },
    { label: 'Reasoning', enabled: Boolean(model?.supportsReasoning) }
  ]
})

const selectedModelContextLabel = computed(() => {
  const contextWindow = modelSettings.selectedModel?.contextWindow
  return contextWindow ? `${contextWindow.toLocaleString()} tokens` : '未知上下文'
})

const providerModel = computed({
  get: () => modelSettings.draft.defaultModel.provider,
  set: (provider: string) => modelSettings.updateDefaultProvider(provider)
})

const modelIdModel = computed({
  get: () => modelSettings.draft.defaultModel.modelId,
  set: (modelId: string) => modelSettings.updateDefaultModel(modelId)
})

const providerOptions = computed(() =>
  modelSettings.providers.map((provider) => ({ label: provider, value: provider }))
)

const modelOptions = computed(() =>
  modelSettings.models
    .filter((item) => item.provider === modelSettings.draft.defaultModel.provider)
    .map((model) => ({ label: model.displayName ?? model.id, value: model.id }))
)
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Default</p>
        <h1 class="models-page__title">默认模型</h1>
        <p class="models-page__subtitle">只保存新建 thread 默认使用的 provider 和 model。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!modelSettings.canSaveDefaultModel"
        @click="modelSettings.saveDefaultModel"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存默认模型
      </BaseButton>
    </header>

    <div v-if="modelSettings.loading" class="state-strip">正在加载模型配置...</div>
    <div v-if="modelSettings.error" class="state-strip is-error">{{ modelSettings.error }}</div>

    <BasePanel title="默认模型" eyebrow="Global">
      <div class="summary-line">
        <span>当前默认</span>
        <strong class="summary-line__value">{{ defaultModelLabel }}</strong>
      </div>

      <div class="model-health">
        <div>
          <span>状态</span>
          <BaseBadge :tone="selectedModelStatusTone">
            {{ selectedModelStatusLabel }}
          </BaseBadge>
        </div>
        <div>
          <span>上下文</span>
          <strong>{{ selectedModelContextLabel }}</strong>
        </div>
        <div>
          <span>能力</span>
          <div class="model-health__badges">
            <BaseBadge
              v-for="capability in selectedModelCapabilities"
              :key="capability.label"
              :tone="capability.enabled ? 'info' : 'neutral'"
            >
              {{ capability.label }}
            </BaseBadge>
          </div>
        </div>
      </div>

      <div class="form-grid">
        <SettingsSelectField
          v-model="providerModel"
          label="Provider"
          placeholder="选择 provider"
          :disabled="modelSettings.providers.length === 0"
          :options="providerOptions"
        />
        <SettingsSelectField
          v-model="modelIdModel"
          label="模型 Model"
          placeholder="选择 model"
          :disabled="!modelSettings.draft.defaultModel.provider"
          :options="modelOptions"
        />
      </div>

      <p v-if="selectedModelMissing" class="warning-copy">当前配置的模型不在可用模型列表中。</p>
      <p v-else class="muted-copy">保存后影响新建 thread；运行中 thread 不会被强制切换。</p>
    </BasePanel>
  </div>
</template>
