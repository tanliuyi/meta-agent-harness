<script setup lang="ts">
import SearchIcon from '@renderer/components/icons/SearchIcon.vue'
import BaseToolGroup from './BaseToolGroup.vue'
import ToolMessageById from './ToolMessageById.vue'
import type { ToolGroupStatus } from './tool-group'

const props = defineProps<{
  toolCallIds: string[]
  summary: string
  status?: ToolGroupStatus
}>()
</script>

<template>
  <BaseToolGroup
    name="探索"
    :summary="props.summary"
    :status="props.status"
    :is-error="props.status === 'failed'"
  >
    <template #icon>
      <SearchIcon :size="14" />
    </template>
    <ToolMessageById
      v-for="toolCallId in toolCallIds"
      :key="toolCallId"
      :tool-call-id="toolCallId"
    />
  </BaseToolGroup>
</template>
