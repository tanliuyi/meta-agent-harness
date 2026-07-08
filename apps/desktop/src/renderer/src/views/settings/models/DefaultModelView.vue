<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel, BaseSegmentedControl } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import useModelSettingsStore from '@renderer/stores/model-settings'
import type { ThinkingLevel } from '@shared/coding-agent/types'
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
    default:
      return '不在 registry 中'
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

const thinkingLevelMeta: Array<{ label: string; value: ThinkingLevel; hint: string }> = [
  { label: '关闭 Off', value: 'off', hint: '不请求 reasoning token' },
  { label: '极简 Minimal', value: 'minimal', hint: '保留最小推理预算' },
  { label: '低 Low', value: 'low', hint: '轻量分析与常规修复' },
  { label: '中 Medium', value: 'medium', hint: '默认平衡档位' },
  { label: '高 High', value: 'high', hint: '复杂修改和审查' },
  { label: '超高 XHigh', value: 'xhigh', hint: '仅支持该档位的模型会生效' }
]

const thinkingOptions = computed(() =>
  thinkingLevelMeta.map(({ label, value }) => ({ label, value }))
)

const selectedLevel = computed(() => modelSettings.draft.thinkingLevel)
const supportedThinkingLevels = computed<ThinkingLevel[]>(
  () => modelSettings.selectedModel?.thinkingLevels ?? []
)
const selectedLevelSupported = computed(() =>
  supportedThinkingLevels.value.includes(selectedLevel.value)
)
const supportsReasoning = computed(() => Boolean(modelSettings.selectedModel?.supportsReasoning))
const supportedThinkingLabel = computed(() =>
  supportedThinkingLevels.value.length > 0
    ? supportedThinkingLevels.value.join(', ')
    : '等待模型能力'
)

const thinkingStatusLabel = computed(() => {
  if (!modelSettings.selectedModel) {
    return '等待默认模型'
  }
  if (!supportsReasoning.value && selectedLevel.value !== 'off') {
    return '默认模型不支持 reasoning'
  }
  if (!selectedLevelSupported.value) {
    return '运行时会按模型能力 clamp'
  }
  return '当前档位可直接使用'
})

const thinkingStatusTone = computed<'neutral' | 'success' | 'warning' | 'info'>(() => {
  if (!modelSettings.selectedModel) return 'neutral'
  if (!supportsReasoning.value && selectedLevel.value !== 'off') return 'warning'
  if (!selectedLevelSupported.value) return 'warning'
  return 'success'
})

const canSave = computed(() => !modelSettings.saving)
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Default & Reasoning</p>
        <h1 class="models-page__title">默认模型与思考</h1>
        <p class="models-page__subtitle">同时设置新建 thread 的默认模型和默认 thinking level。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!canSave"
        @click="modelSettings.saveDefaultModelAndThinking"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存
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

    <BasePanel title="思考强度" eyebrow="Global">
      <div class="thinking-summary" aria-label="Thinking level summary">
        <div>
          <span>默认模型</span>
          <strong>{{ defaultModelLabel }}</strong>
        </div>
        <div>
          <span>状态</span>
          <BaseBadge :tone="thinkingStatusTone">{{ thinkingStatusLabel }}</BaseBadge>
        </div>
        <div>
          <span>支持档位</span>
          <strong>{{ supportedThinkingLabel }}</strong>
        </div>
      </div>

      <BaseSegmentedControl
        label="思考强度 Thinking level"
        :model-value="modelSettings.draft.thinkingLevel"
        :options="thinkingOptions"
        @update:model-value="modelSettings.updateThinkingLevel"
      />
      <ul class="thinking-level-list">
        <li
          v-for="level in thinkingLevelMeta"
          :key="level.value"
          :class="{
            'is-selected': selectedLevel === level.value,
            'is-unsupported':
              supportedThinkingLevels.length > 0 && !supportedThinkingLevels.includes(level.value)
          }"
        >
          <div>
            <strong>{{ level.label }}</strong>
            <span>{{ level.hint }}</span>
          </div>
          <BaseBadge
            :tone="
              selectedLevel === level.value
                ? selectedLevelSupported
                  ? 'success'
                  : 'warning'
                : supportedThinkingLevels.includes(level.value)
                  ? 'info'
                  : 'neutral'
            "
          >
            <template v-if="selectedLevel === level.value">当前</template>
            <template v-else-if="supportedThinkingLevels.includes(level.value)">支持</template>
            <template v-else>可能 clamp</template>
          </BaseBadge>
        </li>
      </ul>
      <p class="muted-copy">
        保存的是全局默认值；thread 运行时仍由 Pi core 按当前模型能力写入有效 thinking level。
      </p>
    </BasePanel>
  </div>
</template>
