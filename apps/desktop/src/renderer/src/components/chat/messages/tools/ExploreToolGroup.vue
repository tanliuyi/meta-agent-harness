<script setup lang="ts">
import { computed } from 'vue'
import SearchIcon from '@renderer/components/icons/SearchIcon.vue'
import ToolMessage from '../ToolMessage.vue'
import BaseToolGroup from './BaseToolGroup.vue'
import type { ToolCall, ToolGroupStatus } from './support/tool-group'
import { getToolStatusLabel } from './support/tool-message'

const props = defineProps<{
  toolCallIds: string[]
  toolCalls: ToolCall[]
  summary: string
  status?: ToolGroupStatus
}>()

const name = computed(() =>
  getToolStatusLabel(props.status, {
    queued: '准备探索',
    running: '正在探索',
    succeeded: '探索',
    failed: '探索失败',
    cancelled: '已取消探索'
  })
)
</script>

<template>
  <BaseToolGroup
    :name="name"
    :summary="props.summary"
    :status="props.status"
    :is-error="props.status === 'failed'"
  >
    <template #icon>
      <SearchIcon :size="14" />
    </template>
    <ToolMessage
      v-for="toolCall in props.toolCalls"
      :key="toolCall.toolCallId"
      :tool-call="toolCall"
    />
  </BaseToolGroup>
</template>
