<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsTextField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const advancedSummary = computed(() => {
  const advanced = agentSettings.draft?.advanced
  if (!advanced) {
    return []
  }
  const budgets = advanced.thinkingBudgets
  const entries = [
    ['minimal', budgets.minimal],
    ['low', budgets.low],
    ['medium', budgets.medium],
    ['high', budgets.high]
  ] as const
  const configured = entries.filter(([, value]) => typeof value === 'number')
  const largest = configured.reduce<(typeof configured)[number] | undefined>(
    (current, entry) => (current && (current[1] ?? 0) >= (entry[1] ?? 0) ? current : entry),
    undefined
  )
  return [
    {
      label: 'Budgets',
      value: configured.length > 0 ? `${configured.length}/4 custom` : 'Core defaults',
      detail: largest
        ? `${largest[0]} 最大 ${formatTokenCount(largest[1])} tokens`
        : '使用 Pi core 默认 thinking budgets',
      tone: configured.length > 0 ? 'info' : 'neutral',
      badgeLabel: configured.length > 0 ? 'Custom' : 'Default'
    },
    {
      label: 'Minimal',
      value: formatBudget(budgets.minimal),
      detail: 'minimal thinking level token budget',
      tone: typeof budgets.minimal === 'number' ? 'info' : 'neutral',
      badgeLabel: typeof budgets.minimal === 'number' ? 'Set' : 'Default'
    },
    {
      label: 'High',
      value: formatBudget(budgets.high),
      detail: 'high thinking level token budget',
      tone: typeof budgets.high === 'number' ? 'info' : 'neutral',
      badgeLabel: typeof budgets.high === 'number' ? 'Set' : 'Default'
    }
  ] as Array<{
    label: string
    value: string
    detail: string
    tone: 'neutral' | 'success' | 'warning' | 'info'
    badgeLabel: string
  }>
})

function formatBudget(value: number | undefined): string {
  return typeof value === 'number' ? `${formatTokenCount(value)} tokens` : 'Default'
}

function formatTokenCount(value: number | undefined): string {
  if (typeof value !== 'number') {
    return 'default'
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
  }
  return String(value)
}
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Advanced</p>
        <h1 class="agent-page__title">高级</h1>
        <p class="agent-page__subtitle">只保存 thinking token budgets。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!agentSettings.canSave"
        @click="agentSettings.saveAdvanced"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存高级设置
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="高级" eyebrow="Advanced">
      <div class="advanced-summary" aria-label="Advanced settings summary">
        <div v-for="item in advancedSummary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <small>{{ item.detail }}</small>
          <BaseBadge :tone="item.tone">{{ item.badgeLabel }}</BaseBadge>
        </div>
      </div>

      <div class="advanced-field-groups">
        <section>
          <header>
            <strong>Reasoning Budgets</strong>
            <span>按 thinking level 覆盖 Pi core token budget</span>
          </header>
          <div class="form-grid compact-grid">
            <SettingsTextField
              v-model="agentSettings.draft.advanced.thinkingBudgets.minimal"
              label="Thinking 极简预算 Thinking minimal"
              type="number"
              :min="0"
            />
            <SettingsTextField
              v-model="agentSettings.draft.advanced.thinkingBudgets.low"
              label="Thinking 低预算 Thinking low"
              type="number"
              :min="0"
            />
            <SettingsTextField
              v-model="agentSettings.draft.advanced.thinkingBudgets.medium"
              label="Thinking 中预算 Thinking medium"
              type="number"
              :min="0"
            />
            <SettingsTextField
              v-model="agentSettings.draft.advanced.thinkingBudgets.high"
              label="Thinking 高预算 Thinking high"
              type="number"
              :min="0"
            />
          </div>
        </section>
      </div>
    </BasePanel>
  </div>
</template>
