<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import useModelSettingsStore, { type ModelScope } from '@renderer/stores/model-settings'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const modelSettings = useModelSettingsStore()

const scopeLabels: Record<ModelScope, string> = {
  default: '默认',
  chat: '对话',
  apply: '代码任务',
  summarize: '摘要',
  title: '标题生成',
  compact: '上下文压缩',
  branchSummary: '分支摘要'
}

const enabledModelsText = computed({
  get: () => modelSettings.draft.enabledModels.join('\n'),
  set: (value: string) => {
    modelSettings.updateEnabledModels(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  }
})
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Scoped</p>
        <h1 class="models-page__title">任务模型</h1>
        <p class="models-page__subtitle">只保存 Pi-compatible enabledModels patterns。</p>
      </div>
      <BaseButton
        variant="primary"
        :disabled="modelSettings.saving"
        @click="modelSettings.saveEnabledModels"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存任务模型
      </BaseButton>
    </header>

    <div v-if="modelSettings.error" class="state-strip is-error">{{ modelSettings.error }}</div>

    <BasePanel title="模型循环 Patterns" eyebrow="enabledModels">
      <label class="textarea-field">
        <span>每行一个 pattern</span>
        <textarea
          v-model="enabledModelsText"
          rows="8"
          placeholder="claude-*&#10;openai/gpt-*&#10;gemini-2*"
        />
      </label>

      <ul class="plain-list">
        <li v-for="scope in modelSettings.scopedModels" :key="scope.scope">
          <div>
            <strong>{{ scopeLabels[scope.scope] }}</strong>
            <span v-if="scope.inheritsDefault">继承默认模型</span>
            <span v-else>{{ scope.provider }}/{{ scope.modelId }}</span>
          </div>
          <BaseBadge :tone="scope.inheritsDefault ? 'neutral' : 'info'">
            {{ scope.inheritsDefault ? '继承' : 'Pattern' }}
          </BaseBadge>
        </li>
      </ul>
    </BasePanel>
  </div>
</template>
