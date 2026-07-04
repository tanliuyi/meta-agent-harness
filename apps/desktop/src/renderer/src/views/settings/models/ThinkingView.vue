<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel, BaseSegmentedControl } from '@renderer/components/base'
import useModelSettingsStore from '@renderer/stores/model-settings'
import type { ThinkingLevel } from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const modelSettings = useModelSettingsStore()

const thinkingLevelMeta: Array<{ label: string; value: ThinkingLevel; hint: string }> = [
  { label: '关闭 Off', value: 'off', hint: '不请求 reasoning token' },
  { label: '极简 Minimal', value: 'minimal', hint: '保留最小推理预算' },
  { label: '低 Low', value: 'low', hint: '轻量分析与常规修复' },
  { label: '中 Medium', value: 'medium', hint: '默认平衡档位' },
  { label: '高 High', value: 'high', hint: '复杂修改和审查' },
  { label: '超高 XHigh', value: 'xhigh', hint: '仅支持该档位的模型会生效' }
]

const thinkingOptions = thinkingLevelMeta.map(({ label, value }) => ({ label, value }))

const selectedModelLabel = computed(() => {
  const model = modelSettings.selectedModel
  if (model?.displayName) {
    return model.displayName
  }
  const { provider, modelId } = modelSettings.draft.defaultModel
  if (!provider || !modelId) {
    return '未设置默认模型'
  }
  return `${provider}/${modelId}`
})

const supportedThinkingLevels = computed<ThinkingLevel[]>(
  () => modelSettings.selectedModel?.thinkingLevels ?? []
)

const selectedLevel = computed(() => modelSettings.draft.thinkingLevel)
const selectedLevelSupported = computed(() =>
  supportedThinkingLevels.value.includes(selectedLevel.value)
)
const supportsReasoning = computed(() => Boolean(modelSettings.selectedModel?.supportsReasoning))
const supportedThinkingLabel = computed(() =>
  supportedThinkingLevels.value.length > 0 ? supportedThinkingLevels.value.join(', ') : '等待模型能力'
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
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Reasoning</p>
        <h1 class="models-page__title">思考强度 Thinking</h1>
        <p class="models-page__subtitle">只保存全局默认 thinking level。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="modelSettings.saving"
        @click="modelSettings.saveThinkingLevel"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存 Thinking
      </BaseButton>
    </header>

    <div v-if="modelSettings.error" class="state-strip is-error">{{ modelSettings.error }}</div>

    <BasePanel title="思考强度 Thinking Level" eyebrow="Global">
      <div class="thinking-summary" aria-label="Thinking level summary">
        <div>
          <span>Default model</span>
          <strong>{{ selectedModelLabel }}</strong>
        </div>
        <div>
          <span>Status</span>
          <BaseBadge :tone="thinkingStatusTone">{{ thinkingStatusLabel }}</BaseBadge>
        </div>
        <div>
          <span>Supported levels</span>
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
            'is-unsupported': supportedThinkingLevels.length > 0 && !supportedThinkingLevels.includes(level.value)
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
