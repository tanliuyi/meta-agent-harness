<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsTextField } from '@renderer/views/settings/components/form'
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
      <BaseButton size="sm" variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveAdvanced">
        <template #icon><Save :size="14" /></template>
        保存高级设置
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="高级" eyebrow="Advanced">
      <div class="form-grid compact-grid">
        <SettingsTextField v-model="agentSettings.draft.advanced.thinkingBudgets.minimal" label="Thinking 极简预算 Thinking minimal" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.advanced.thinkingBudgets.low" label="Thinking 低预算 Thinking low" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.advanced.thinkingBudgets.medium" label="Thinking 中预算 Thinking medium" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.advanced.thinkingBudgets.high" label="Thinking 高预算 Thinking high" type="number" :min="0" />
      </div>
      <SettingsTextField
        v-model="agentSettings.draft.advanced.codeBlockIndent"
        label="Markdown 代码块缩进 Markdown code block indent"
        placeholder="两个空格"
      />
    </BasePanel>
  </div>
</template>
