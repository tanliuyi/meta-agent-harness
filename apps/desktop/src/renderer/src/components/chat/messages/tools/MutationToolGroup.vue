<script setup lang="ts">
import { computed } from 'vue'
import PencilIcon from '@renderer/components/icons/PencilIcon.vue'
import ToolMessage from '../ToolMessage.vue'
import BaseToolGroup from './BaseToolGroup.vue'
import type { ToolCall, ToolGroupStatus } from './support/tool-group'
import { getToolStatusLabel } from './support/tool-message'

const props = defineProps<{
  toolCallIds: string[]
  toolCalls: ToolCall[]
  summary: string
  status?: ToolGroupStatus
  defaultOpen?: boolean
}>()

const name = computed(() =>
  getToolStatusLabel(props.status, {
    queued: '准备变更文件',
    running: '正在变更文件',
    succeeded: '文件变更',
    failed: '文件变更失败',
    cancelled: '已取消文件变更'
  })
)
</script>

<template>
  <BaseToolGroup
    :name="name"
    :summary="props.summary"
    :status="props.status"
    :is-error="props.status === 'failed'"
    :default-open="props.defaultOpen"
  >
    <template #icon>
      <PencilIcon :size="14" />
    </template>
    <ToolMessage
      v-for="toolCall in props.toolCalls"
      :key="toolCall.toolCallId"
      :tool-call="toolCall"
      :default-open="props.defaultOpen"
    />
  </BaseToolGroup>
</template>
