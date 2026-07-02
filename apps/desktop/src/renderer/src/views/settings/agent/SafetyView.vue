<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import type { AgentDefaultProjectTrust } from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'

const agentSettings = useAgentSettingsStore()

const trustOptions: Array<{ label: string; value: AgentDefaultProjectTrust }> = [
  { label: '询问', value: 'ask' },
  { label: '始终信任', value: 'always' },
  { label: '永不信任', value: 'never' }
]
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Safety</p>
        <h1 class="agent-page__title">安全与遥测</h1>
        <p class="agent-page__subtitle">只保存 project trust、telemetry、analytics、warnings 和 proxy。</p>
      </div>
      <BaseButton variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveSafety">
        <template #icon><Save :size="14" /></template>
        保存安全与遥测
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="安全与遥测" eyebrow="Safety">
      <label class="select-field">
        <span>Project trust 默认策略</span>
        <select v-model="agentSettings.draft.safety.defaultProjectTrust">
          <option v-for="option in trustOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <div class="switch-list" style="margin-top: var(--space-3)">
        <label class="switch-row">
          <input v-model="agentSettings.draft.safety.enableSkillCommands" type="checkbox" />
          <span><strong>Skill slash commands</strong><small>允许 skills 注册 /skill 命令。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.safety.enableInstallTelemetry" type="checkbox" />
          <span><strong>安装/更新 telemetry</strong><small>匿名安装与版本更新 ping。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.safety.enableAnalytics" type="checkbox" />
          <span><strong>Analytics</strong><small>显式选择后启用分析数据共享。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.safety.warnAnthropicExtraUsage" type="checkbox" />
          <span><strong>Anthropic extra usage 提示</strong><small>使用 Claude Pro/Max 订阅凭据时显示额外用量提示。</small></span>
        </label>
      </div>

      <label class="text-field" style="margin-top: var(--space-3)">
        <span>HTTP proxy</span>
        <input v-model="agentSettings.draft.safety.httpProxy" placeholder="http://127.0.0.1:7890" />
      </label>
    </BasePanel>
  </div>
</template>
