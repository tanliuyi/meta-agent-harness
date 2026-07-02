<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'

const agentSettings = useAgentSettingsStore()
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Advanced</p>
        <h1 class="agent-page__title">高级</h1>
        <p class="agent-page__subtitle">只保存 thinking token budgets 和 markdown code block indent。</p>
      </div>
      <BaseButton variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveAdvanced">
        <template #icon><Save :size="14" /></template>
        保存高级设置
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="高级" eyebrow="Advanced">
      <div class="form-grid compact-grid">
        <label class="number-field">
          <span>Thinking minimal</span>
          <input v-model.number="agentSettings.draft.advanced.thinkingBudgets.minimal" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Thinking low</span>
          <input v-model.number="agentSettings.draft.advanced.thinkingBudgets.low" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Thinking medium</span>
          <input v-model.number="agentSettings.draft.advanced.thinkingBudgets.medium" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Thinking high</span>
          <input v-model.number="agentSettings.draft.advanced.thinkingBudgets.high" min="0" type="number" />
        </label>
      </div>
      <label class="text-field" style="margin-top: var(--space-3)">
        <span>Markdown code block indent</span>
        <input v-model="agentSettings.draft.advanced.codeBlockIndent" placeholder="两个空格" />
      </label>
    </BasePanel>
  </div>
</template>
