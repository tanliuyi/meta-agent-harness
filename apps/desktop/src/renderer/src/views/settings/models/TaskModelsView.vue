<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsArrayField } from '@renderer/views/settings/components/form'
import useModelSettingsStore, { type ModelScope } from '@renderer/stores/model-settings'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const modelSettings = useModelSettingsStore()

const scopeLabels: Record<ModelScope, string> = {
  default: '默认 Default',
  chat: '对话 Chat',
  apply: '代码任务 Apply',
  summarize: '摘要 Summarize',
  title: '标题生成 Title',
  compact: '上下文压缩 Compact',
  branchSummary: '分支摘要 Branch summary'
}

type ScopedModelListItem = {
  scope: (typeof modelSettings.scopedModels)[number]
  scopeLabel: string
  badgeTone: 'neutral' | 'info'
  badgeLabel: string
}

const scopedModelItems = computed<ScopedModelListItem[]>(() =>
  modelSettings.scopedModels.map((scope) => ({
    scope,
    scopeLabel: scopeLabels[scope.scope],
    badgeTone: scope.inheritsDefault ? 'neutral' : 'info',
    badgeLabel: scope.inheritsDefault ? '继承 Inherit' : '匹配 Pattern'
  }))
)
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Scoped</p>
        <h1 class="models-page__title">任务模型 Scoped models</h1>
        <p class="models-page__subtitle">只保存 Pi-compatible enabledModels patterns。</p>
      </div>
      <BaseButton
        size="sm"
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
      <SettingsArrayField
        v-model="modelSettings.draft.enabledModels"
        label="模型匹配 Patterns"
        description="每个 pattern 单独一项，保存时仍写入 Pi 兼容的 string[]。"
        placeholder="例如 claude-* 或 openai/gpt-*"
        add-label="添加 pattern"
      />

      <ul class="plain-list">
        <li v-for="item in scopedModelItems" :key="item.scope.scope">
          <div>
            <strong>{{ item.scopeLabel }}</strong>
            <span v-if="item.scope.inheritsDefault">继承默认模型 Inherit default</span>
            <span v-else>{{ item.scope.provider }}/{{ item.scope.modelId }}</span>
          </div>
          <BaseBadge :tone="item.badgeTone">
            {{ item.badgeLabel }}
          </BaseBadge>
        </li>
      </ul>
    </BasePanel>
  </div>
</template>
