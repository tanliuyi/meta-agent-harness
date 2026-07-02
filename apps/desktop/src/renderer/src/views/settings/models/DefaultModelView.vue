<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
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

      <div class="form-grid">
        <label class="select-field">
          <span>Provider</span>
          <select
            :value="modelSettings.draft.defaultModel.provider"
            :disabled="modelSettings.providers.length === 0"
            @change="modelSettings.updateDefaultProvider(($event.target as HTMLSelectElement).value)"
          >
            <option value="">选择 provider</option>
            <option v-for="provider in modelSettings.providers" :key="provider" :value="provider">
              {{ provider }}
            </option>
          </select>
        </label>

        <label class="select-field">
          <span>Model</span>
          <select
            :value="modelSettings.draft.defaultModel.modelId"
            :disabled="!modelSettings.draft.defaultModel.provider"
            @change="modelSettings.updateDefaultModel(($event.target as HTMLSelectElement).value)"
          >
            <option value="">选择 model</option>
            <option
              v-for="model in modelSettings.models.filter(
                (item) => item.provider === modelSettings.draft.defaultModel.provider
              )"
              :key="model.id"
              :value="model.id"
            >
              {{ model.displayName ?? model.id }}
            </option>
          </select>
        </label>
      </div>

      <p v-if="selectedModelMissing" class="warning-copy">当前配置的模型不在可用模型列表中。</p>
      <p v-else class="muted-copy">保存后影响新建 thread；运行中 thread 不会被强制切换。</p>
    </BasePanel>
  </div>
</template>
