<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import {
  SettingsSelectField,
  SettingsSwitchField,
  SettingsTextField
} from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import type { AgentDefaultProjectTrust } from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const trustOptions: Array<{ label: string; value: AgentDefaultProjectTrust }> = [
  { label: '询问', value: 'ask' },
  { label: '始终信任', value: 'always' },
  { label: '永不信任', value: 'never' }
]

const safetySummary = computed(() => {
  const safety = agentSettings.draft?.safety
  if (!safety) {
    return []
  }
  return [
    {
      label: 'Project Trust',
      value: getTrustTitle(safety.defaultProjectTrust),
      detail: getTrustDescription(safety.defaultProjectTrust),
      tone: getTrustTone(safety.defaultProjectTrust),
      badgeLabel: safety.defaultProjectTrust === 'ask' ? 'Prompt' : 'Default'
    },
    {
      label: 'Commands',
      value: safety.enableSkillCommands ? 'Skill commands on' : 'Skill commands off',
      detail: safety.enableSkillCommands
        ? 'skills 可以注册 slash commands'
        : 'skills 不注册 slash commands',
      tone: safety.enableSkillCommands ? 'info' : 'neutral',
      badgeLabel: safety.enableSkillCommands ? 'Enabled' : 'Off'
    },
    {
      label: 'Telemetry',
      value: safety.enableAnalytics ? 'Analytics on' : 'Analytics off',
      detail: safety.enableInstallTelemetry ? '安装/更新 ping 开启' : '安装/更新 ping 关闭',
      tone: safety.enableAnalytics ? 'warning' : 'success',
      badgeLabel: safety.enableAnalytics ? 'Sharing' : 'Private'
    },
    {
      label: 'Network',
      value: safety.httpProxy?.trim() ? 'Proxy configured' : 'Direct',
      detail: safety.warnAnthropicExtraUsage ? 'Anthropic 用量提示开启' : 'Anthropic 用量提示关闭',
      tone: safety.httpProxy?.trim() ? 'info' : 'neutral',
      badgeLabel: safety.httpProxy?.trim() ? 'Proxy' : 'Direct'
    }
  ] as Array<{
    label: string
    value: string
    detail: string
    tone: 'neutral' | 'success' | 'warning' | 'info'
    badgeLabel: string
  }>
})

function getTrustTitle(value: AgentDefaultProjectTrust): string {
  switch (value) {
    case 'ask':
      return '每次询问'
    case 'always':
      return '默认信任'
    case 'never':
      return '默认不信任'
  }
}

function getTrustDescription(value: AgentDefaultProjectTrust): string {
  switch (value) {
    case 'ask':
      return '遇到本地 agent 资源时由 Project 层决定。'
    case 'always':
      return '新 Project 默认允许加载本地 agent 资源。'
    case 'never':
      return '新 Project 默认禁用本地 agent 资源。'
  }
}

function getTrustTone(value: AgentDefaultProjectTrust): 'neutral' | 'success' | 'warning' | 'info' {
  if (value === 'always') return 'warning'
  if (value === 'never') return 'success'
  return 'info'
}
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Safety</p>
        <h1 class="agent-page__title">安全与遥测</h1>
        <p class="agent-page__subtitle">
          只保存 project trust、telemetry、analytics、warnings 和 proxy。
        </p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!agentSettings.canSave"
        @click="agentSettings.saveSafety"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存安全与遥测
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="安全与遥测" eyebrow="Safety">
      <div class="safety-summary" aria-label="Safety settings summary">
        <div v-for="item in safetySummary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <small>{{ item.detail }}</small>
          <BaseBadge :tone="item.tone">{{ item.badgeLabel }}</BaseBadge>
        </div>
      </div>

      <div class="safety-field-groups">
        <section>
          <header>
            <strong>Trust & Commands</strong>
            <span>Project 本地资源和 skill slash commands</span>
          </header>
          <SettingsSelectField
            v-model="agentSettings.draft.safety.defaultProjectTrust"
            label="项目信任默认策略 Project trust"
            :options="trustOptions"
          />
          <SettingsSwitchField
            v-model="agentSettings.draft.safety.enableSkillCommands"
            title="Skill 斜杠命令 Skill slash commands"
            description="允许 skills 注册 /skill 命令。"
          />
        </section>

        <section>
          <header>
            <strong>Telemetry</strong>
            <span>安装更新 ping、analytics 和 provider 用量提示</span>
          </header>
          <div class="switch-list">
            <SettingsSwitchField
              v-model="agentSettings.draft.safety.enableInstallTelemetry"
              title="安装/更新 telemetry"
              description="匿名安装与版本更新 ping。"
            />
            <SettingsSwitchField
              v-model="agentSettings.draft.safety.enableAnalytics"
              title="分析 Analytics"
              description="显式选择后启用分析数据共享。"
            />
            <SettingsSwitchField
              v-model="agentSettings.draft.safety.warnAnthropicExtraUsage"
              title="Anthropic 额外用量提示 Anthropic extra usage"
              description="使用 Claude Pro/Max 订阅凭据时显示额外用量提示。"
            />
          </div>
        </section>

        <section>
          <header>
            <strong>Network</strong>
            <span>Pi-managed HTTP clients 使用的代理</span>
          </header>
          <SettingsTextField
            v-model="agentSettings.draft.safety.httpProxy"
            label="HTTP 代理 HTTP proxy"
            placeholder="http://127.0.0.1:7890"
          />
        </section>
      </div>
    </BasePanel>
  </div>
</template>
