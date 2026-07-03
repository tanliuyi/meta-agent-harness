<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsSelectField, SettingsSwitchField, SettingsTextField } from '@renderer/views/settings/components/form'
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
      <BaseButton size="sm" variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveSafety">
        <template #icon><Save :size="14" /></template>
        保存安全与遥测
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="安全与遥测" eyebrow="Safety">
      <SettingsSelectField
        v-model="agentSettings.draft.safety.defaultProjectTrust"
        label="项目信任默认策略 Project trust"
        :options="trustOptions"
      />

      <div class="switch-list">
        <SettingsSwitchField v-model="agentSettings.draft.safety.enableSkillCommands" title="Skill 斜杠命令 Skill slash commands" description="允许 skills 注册 /skill 命令。" />
        <SettingsSwitchField v-model="agentSettings.draft.safety.enableInstallTelemetry" title="安装/更新 telemetry" description="匿名安装与版本更新 ping。" />
        <SettingsSwitchField v-model="agentSettings.draft.safety.enableAnalytics" title="分析 Analytics" description="显式选择后启用分析数据共享。" />
        <SettingsSwitchField v-model="agentSettings.draft.safety.warnAnthropicExtraUsage" title="Anthropic 额外用量提示 Anthropic extra usage" description="使用 Claude Pro/Max 订阅凭据时显示额外用量提示。" />
      </div>

      <SettingsTextField
        v-model="agentSettings.draft.safety.httpProxy"
        label="HTTP 代理 HTTP proxy"
        placeholder="http://127.0.0.1:7890"
      />
    </BasePanel>
  </div>
</template>
