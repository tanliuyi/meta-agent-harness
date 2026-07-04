<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import type { AgentQueueMode, AgentTransportMode } from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const queueModeOptions: Array<{ label: string; value: AgentQueueMode }> = [
  { label: '全部投递 All', value: 'all' },
  { label: '逐条投递 One at a time', value: 'one-at-a-time' }
]

const transportOptions: Array<{ label: string; value: AgentTransportMode }> = [
  { label: '自动 Auto', value: 'auto' },
  { label: '服务端事件 SSE', value: 'sse' },
  { label: 'WebSocket', value: 'websocket' },
  { label: '缓存 WebSocket Cached WS', value: 'websocket-cached' }
]

const deliverySummary = computed(() => {
  const delivery = agentSettings.draft?.delivery
  if (!delivery) {
    return []
  }
  return [
    {
      label: 'Steering',
      value: getQueueModeTitle(delivery.steeringMode),
      detail: getQueueModeDescription(delivery.steeringMode, '正在运行时追加引导消息'),
      tone: delivery.steeringMode === 'one-at-a-time' ? 'success' : 'info',
      badgeLabel: delivery.steeringMode === 'one-at-a-time' ? 'Queued' : 'Parallel'
    },
    {
      label: 'Follow-up',
      value: getQueueModeTitle(delivery.followUpMode),
      detail: getQueueModeDescription(delivery.followUpMode, '任务完成后的跟进消息'),
      tone: delivery.followUpMode === 'one-at-a-time' ? 'success' : 'info',
      badgeLabel: delivery.followUpMode === 'one-at-a-time' ? 'Queued' : 'Parallel'
    },
    {
      label: 'Transport',
      value: getTransportTitle(delivery.transport),
      detail: getTransportDescription(delivery.transport),
      tone: delivery.transport === 'auto' ? 'success' : 'neutral',
      badgeLabel: delivery.transport === 'auto' ? 'Auto' : 'Pinned'
    }
  ] as Array<{
    label: string
    value: string
    detail: string
    tone: 'neutral' | 'success' | 'warning' | 'info'
    badgeLabel: string
  }>
})

function getQueueModeTitle(mode: AgentQueueMode): string {
  return mode === 'one-at-a-time' ? '逐条投递' : '全部投递'
}

function getQueueModeDescription(mode: AgentQueueMode, subject: string): string {
  if (mode === 'one-at-a-time') {
    return `${subject}会排队，上一条处理完再进入 agent。`
  }
  return `${subject}会尽快进入 agent 队列。`
}

function getTransportTitle(transport: AgentTransportMode): string {
  switch (transport) {
    case 'auto':
      return '自动选择'
    case 'sse':
      return 'SSE'
    case 'websocket':
      return 'WebSocket'
    case 'websocket-cached':
      return 'Cached WS'
  }
}

function getTransportDescription(transport: AgentTransportMode): string {
  switch (transport) {
    case 'auto':
      return '由 Pi core/provider 按能力选择连接方式。'
    case 'sse':
      return '强制使用 server-sent events。'
    case 'websocket':
      return '强制使用 WebSocket。'
    case 'websocket-cached':
      return '使用缓存型 WebSocket transport。'
  }
}
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Delivery</p>
        <h1 class="agent-page__title">消息投递</h1>
        <p class="agent-page__subtitle">只保存 steering、follow-up 和 provider transport。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!agentSettings.canSave"
        @click="agentSettings.saveDelivery"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存消息投递
      </BaseButton>
    </header>

    <div v-if="agentSettings.loading" class="state-strip">正在加载 Agent 设置...</div>
    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="消息投递" eyebrow="Delivery">
      <div class="delivery-summary" aria-label="Delivery strategy summary">
        <div v-for="item in deliverySummary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <small>{{ item.detail }}</small>
          <BaseBadge :tone="item.tone">{{ item.badgeLabel }}</BaseBadge>
        </div>
      </div>

      <div class="field-stack">
        <SettingsSelectField
          v-model="agentSettings.draft.delivery.steeringMode"
          label="引导消息 Steering"
          :options="queueModeOptions"
        />
        <SettingsSelectField
          v-model="agentSettings.draft.delivery.followUpMode"
          label="跟进消息 Follow-up"
          :options="queueModeOptions"
        />
        <SettingsSelectField
          v-model="agentSettings.draft.delivery.transport"
          label="传输方式 Transport"
          :options="transportOptions"
        />
      </div>
    </BasePanel>
  </div>
</template>
