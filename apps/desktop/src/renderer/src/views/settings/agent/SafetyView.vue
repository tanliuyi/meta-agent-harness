<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import {
  SettingsSelectField,
  SettingsSwitchField,
  SettingsTextField
} from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { confirm } from '@renderer/composables/useConfirmDialog'
import {
  dangerousCapabilityLabels,
  saveSafetyWithCapabilityConfirmation
} from './safetyCapabilityConfirmation'
import type {
  AgentDefaultProjectTrust,
  BrowserCdpAccessMode,
  BrowserWebPermissionMode,
  DesktopCapabilityAccessMode
} from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const trustOptions: Array<{ label: string; value: AgentDefaultProjectTrust }> = [
  { label: '询问', value: 'ask' },
  { label: '始终信任', value: 'always' },
  { label: '永不信任', value: 'never' }
]

const browserCdpAccessOptions: Array<{ label: string; value: BrowserCdpAccessMode }> = [
  { label: '安全模式', value: 'safe' },
  { label: '完整能力', value: 'full' },
  { label: '禁用', value: 'disabled' }
]

const browserWebPermissionOptions: Array<{
  label: string
  value: BrowserWebPermissionMode
}> = [
  { label: '按站点询问', value: 'prompt' },
  { label: '始终允许', value: 'full' },
  { label: '全部拒绝', value: 'disabled' }
]

const capabilityAccessOptions: Array<{
  label: string
  value: DesktopCapabilityAccessMode
}> = [
  { label: '受控模式', value: 'safe' },
  { label: '完整能力', value: 'full' }
]

const fullCapabilityCount = computed(() => {
  const safety = agentSettings.draft?.safety
  if (!safety) return 0
  return Object.keys(dangerousCapabilityLabels).filter((field) => {
    const key = field as keyof typeof dangerousCapabilityLabels
    return safety[key] === 'full'
  }).length
})

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
    },
    {
      label: 'Browser CDP',
      value:
        safety.browserCdpAccess === 'full'
          ? 'Full protocol'
          : safety.browserCdpAccess === 'safe'
            ? 'Safe diagnostics'
            : 'Disabled',
      detail:
        safety.browserCdpAccess === 'full'
          ? '可访问共享 Browser Profile 的 Cookie、Storage、Network 与 Target'
          : '敏感协议域默认不可用',
      tone: safety.browserCdpAccess === 'full' ? 'warning' : 'success',
      badgeLabel: safety.browserCdpAccess === 'full' ? 'Sensitive' : 'Guarded'
    },
    {
      label: 'Desktop Capabilities',
      value: `${fullCapabilityCount.value} / 5 full`,
      detail:
        fullCapabilityCount.value > 0
          ? '完整能力可访问敏感系统、网页或扩展边界'
          : '所有危险能力均处于受控模式',
      tone: fullCapabilityCount.value > 0 ? 'warning' : 'success',
      badgeLabel: fullCapabilityCount.value > 0 ? 'Elevated' : 'Guarded'
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

async function saveSafetyWithConfirmation(): Promise<void> {
  const current = agentSettings.snapshot?.safety
  const next = agentSettings.draft?.safety
  if (!current || !next) return
  await saveSafetyWithCapabilityConfirmation({
    current,
    next,
    confirmEscalations: async (escalations) => {
      const result = await confirm({
        id: 'enable-full-desktop-capabilities',
        title: '开启完整桌面能力',
        description: `将开启：${escalations.join('、')}。这些能力可能读取敏感数据、启动外部应用、访问任意路径或加载不受限远程内容。仅在信任当前 Agent、扩展和项目时开启。`,
        confirmText: '了解风险并开启',
        cancelText: '保持受控模式',
        tone: 'destructive'
      })
      return result.confirmed
    },
    save: () => agentSettings.saveSafety()
  })
}
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Safety</p>
        <h1 class="agent-page__title">安全与遥测</h1>
        <p class="agent-page__subtitle">管理 project trust、遥测、网络和 Desktop 专业能力边界。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!agentSettings.canSave"
        @click="saveSafetyWithConfirmation"
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
            <strong>Professional Capabilities</strong>
            <span>受控模式保留常用能力；完整模式恢复原始边界并承担对应风险</span>
          </header>
          <SettingsSelectField
            v-model="agentSettings.draft.safety.browserCdpAccess"
            label="Browser CDP 访问级别"
            description="完整能力会把共享 Browser Profile 的 Cookie、Storage、Network、Target、下载与调试接口开放给 Agent 和扩展。"
            :options="browserCdpAccessOptions"
            :virtual="false"
          />
          <SettingsSelectField
            v-model="agentSettings.draft.safety.browserWebPermissions"
            label="Browser 网页权限"
            description="始终允许会让任意站点直接获得相机、麦克风、定位、通知、剪贴板等 Electron 网页权限；按站点询问会在工作台内逐项确认。"
            :options="browserWebPermissionOptions"
            :virtual="false"
          />
          <SettingsSelectField
            v-model="agentSettings.draft.safety.filesystemAccess"
            label="文件系统访问"
            description="完整能力允许 renderer 与扩展打开任意文件或目录、显示 UNC 路径，并让 /export 写入指定路径。"
            :options="capabilityAccessOptions"
            :virtual="false"
          />
          <SettingsSelectField
            v-model="agentSettings.draft.safety.extensionUrlAccess"
            label="扩展 URL Panel"
            description="完整能力允许远程 extension panel 跨源导航并向宿主转发任意 origin 的消息。"
            :options="capabilityAccessOptions"
            :virtual="false"
          />
          <SettingsSelectField
            v-model="agentSettings.draft.safety.externalProtocolAccess"
            label="外部 URI 协议"
            description="完整能力允许 OAuth、扩展和链接调用系统注册的任意 URI scheme，可能启动其他应用或命令。"
            :options="capabilityAccessOptions"
            :virtual="false"
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
