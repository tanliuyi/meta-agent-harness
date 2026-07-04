<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsArrayField } from '@renderer/views/settings/components/form'
import useModelSettingsStore, {
  type ModelScope,
  type ScopedModelConfig
} from '@renderer/stores/model-settings'
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

const scopeOrder = Object.keys(scopeLabels) as ModelScope[]

type ScopedModelListItem = {
  scope: ScopedModelConfig
  scopeLabel: string
  badgeTone: 'neutral' | 'info'
  badgeLabel: string
  routeLabel: string
  routeHint: string
}

const defaultModelLabel = computed(() => {
  if (modelSettings.selectedModel?.displayName) {
    return modelSettings.selectedModel.displayName
  }
  const { provider, modelId } = modelSettings.draft.defaultModel
  if (!provider || !modelId) {
    return '未设置默认模型'
  }
  return `${provider}/${modelId}`
})

const routedScopes = computed<ScopedModelConfig[]>(() => {
  const scopedById = new Map(modelSettings.scopedModels.map((scope) => [scope.scope, scope]))
  return scopeOrder.map(
    (scope) =>
      scopedById.get(scope) ?? {
        scope,
        inheritsDefault: true
      }
  )
})

const scopedModelItems = computed<ScopedModelListItem[]>(() =>
  routedScopes.value.map((scope) => {
    const routeLabel = scope.inheritsDefault
      ? defaultModelLabel.value
      : (scope.modelId ?? '未命名 pattern')
    return {
      scope,
      scopeLabel: scopeLabels[scope.scope],
      badgeTone: scope.inheritsDefault ? 'neutral' : 'info',
      badgeLabel: scope.inheritsDefault ? '继承 Inherit' : '覆盖 Override',
      routeLabel,
      routeHint: scope.inheritsDefault ? '跟随默认模型' : '来自 enabledModels pattern'
    }
  })
)

const overrideCount = computed(
  () => scopedModelItems.value.filter((item) => !item.scope.inheritsDefault).length
)
const inheritCount = computed(() => scopedModelItems.value.length - overrideCount.value)
const patternCount = computed(() => modelSettings.draft.enabledModels.length)
const routingSummaryLabel = computed(() =>
  overrideCount.value === 0
    ? '所有任务继承默认模型'
    : `${overrideCount.value} 个任务使用 pattern 覆盖`
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
      <div class="routing-summary" aria-label="Scoped model routing summary">
        <div>
          <span>Routing</span>
          <strong>{{ routingSummaryLabel }}</strong>
        </div>
        <div>
          <span>Default</span>
          <strong>{{ defaultModelLabel }}</strong>
        </div>
        <div>
          <span>Patterns</span>
          <strong>{{ patternCount }}</strong>
        </div>
        <div>
          <span>Scopes</span>
          <strong>{{ overrideCount }} 覆盖 · {{ inheritCount }} 继承</strong>
        </div>
      </div>

      <SettingsArrayField
        v-model="modelSettings.draft.enabledModels"
        label="模型匹配 Patterns"
        description="每个 pattern 单独一项，保存时仍写入 Pi 兼容的 string[]。"
        placeholder="例如 claude-* 或 openai/gpt-*"
        add-label="添加 pattern"
      />

      <ul class="plain-list scoped-route-list">
        <li v-for="item in scopedModelItems" :key="item.scope.scope">
          <div>
            <strong>{{ item.scopeLabel }}</strong>
            <span>{{ item.routeHint }}</span>
            <em>{{ item.routeLabel }}</em>
          </div>
          <BaseBadge :tone="item.badgeTone">
            {{ item.badgeLabel }}
          </BaseBadge>
        </li>
      </ul>
    </BasePanel>
  </div>
</template>
