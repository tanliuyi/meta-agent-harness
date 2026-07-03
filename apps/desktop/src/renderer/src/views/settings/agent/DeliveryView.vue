<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import type { AgentQueueMode, AgentTransportMode } from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'

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
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Delivery</p>
        <h1 class="agent-page__title">消息投递</h1>
        <p class="agent-page__subtitle">只保存 steering、follow-up 和 provider transport。</p>
      </div>
      <BaseButton size="sm" variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveDelivery">
        <template #icon><Save :size="14" /></template>
        保存消息投递
      </BaseButton>
    </header>

    <div v-if="agentSettings.loading" class="state-strip">正在加载 Agent 设置...</div>
    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="消息投递" eyebrow="Delivery">
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
