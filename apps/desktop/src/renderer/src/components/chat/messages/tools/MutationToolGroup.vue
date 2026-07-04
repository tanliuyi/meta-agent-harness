<script setup lang="ts">
import PencilIcon from '@renderer/components/icons/PencilIcon.vue'
import ToolMessage from '../ToolMessage.vue'
import BaseToolGroup from './BaseToolGroup.vue'
import type { ToolCall, ToolGroupStatus } from './tool-group'

const props = defineProps<{
  toolCallIds: string[]
  toolCalls: ToolCall[]
  summary: string
  status?: ToolGroupStatus
}>()
</script>

<template>
  <BaseToolGroup
    name="文件变更"
    :summary="props.summary"
    :status="props.status"
    :is-error="props.status === 'failed'"
  >
    <template #icon>
      <PencilIcon :size="14" />
    </template>
    <ToolMessage
      v-for="toolCall in props.toolCalls"
      :key="toolCall.toolCallId"
      :tool-call="toolCall"
    />
  </BaseToolGroup>
</template>
