<script setup lang="ts">
import { BaseButton, BasePanel, BaseSegmentedControl } from '@renderer/components/base'
import useModelSettingsStore from '@renderer/stores/model-settings'
import type { ThinkingLevel } from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'

const modelSettings = useModelSettingsStore()

const thinkingOptions: Array<{ label: string; value: ThinkingLevel }> = [
  { label: 'Off', value: 'off' },
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'XHigh', value: 'xhigh' }
]
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Reasoning</p>
        <h1 class="models-page__title">Thinking</h1>
        <p class="models-page__subtitle">只保存全局默认 thinking level。</p>
      </div>
      <BaseButton
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

    <BasePanel title="Thinking Level" eyebrow="Global">
      <BaseSegmentedControl
        label="Thinking level"
        :model-value="modelSettings.draft.thinkingLevel"
        :options="thinkingOptions"
        @update:model-value="modelSettings.updateThinkingLevel"
      />
      <p class="muted-copy">后端会按模型支持范围 clamp，例如将超出能力的 xhigh 调整到 high。</p>
    </BasePanel>
  </div>
</template>
