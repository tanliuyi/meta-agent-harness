<script setup lang="ts">
import { computed, inject } from 'vue'
import ToolMessage from '../ToolMessage.vue'
import { toolCallsByIdKey } from './tool-call-context'
import type { ToolCall } from './tool-group'

const props = defineProps<{
  toolCallId: string
}>()

const toolCallsById = inject(toolCallsByIdKey)
const toolCall = computed(() => toolCallsById?.value[props.toolCallId])

function getToolCallRevision(value: ToolCall | undefined): unknown[] {
  if (!value) {
    return [props.toolCallId, 'missing']
  }
  return [value.toolName, value.status, value.args, value.partialResult, value.result]
}
</script>

<template>
  <ToolMessage v-if="toolCall" v-memo="getToolCallRevision(toolCall)" :tool-call="toolCall" />
</template>
