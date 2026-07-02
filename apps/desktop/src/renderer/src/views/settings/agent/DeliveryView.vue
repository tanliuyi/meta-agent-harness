<script setup lang="ts">
import { BaseButton, BasePanel, BaseSegmentedControl } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import type { AgentQueueMode, AgentTransportMode } from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'

const agentSettings = useAgentSettingsStore()

const queueModeOptions: Array<{ label: string; value: AgentQueueMode }> = [
  { label: '全部投递', value: 'all' },
  { label: '逐条投递', value: 'one-at-a-time' }
]

const transportOptions: Array<{ label: string; value: AgentTransportMode }> = [
  { label: 'Auto', value: 'auto' },
  { label: 'SSE', value: 'sse' },
  { label: 'WebSocket', value: 'websocket' },
  { label: 'Cached WS', value: 'websocket-cached' }
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
      <BaseButton variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveDelivery">
        <template #icon><Save :size="14" /></template>
        保存消息投递
      </BaseButton>
    </header>

    <div v-if="agentSettings.loading" class="state-strip">正在加载 Agent 设置...</div>
    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="消息投递" eyebrow="Delivery">
      <div class="field-stack">
        <label class="control-field">
          <span>Steering</span>
          <BaseSegmentedControl
            v-model="agentSettings.draft.delivery.steeringMode"
            label="Steering mode"
            :options="queueModeOptions"
          />
        </label>
        <label class="control-field">
          <span>Follow-up</span>
          <BaseSegmentedControl
            v-model="agentSettings.draft.delivery.followUpMode"
            label="Follow-up mode"
            :options="queueModeOptions"
          />
        </label>
        <label class="select-field">
          <span>Transport</span>
          <select v-model="agentSettings.draft.delivery.transport">
            <option v-for="option in transportOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>
    </BasePanel>
  </div>
</template>
