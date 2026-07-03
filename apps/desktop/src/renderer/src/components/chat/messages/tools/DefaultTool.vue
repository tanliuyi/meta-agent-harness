<script setup lang="ts">
import { computed } from 'vue'
import { formatUnknown, getMessageRawRecord } from '../message-format'
import BaseTool from './BaseTool.vue'
import {
  getToolResultText,
  isToolError,
  type ToolComponentProps
} from './tool-message'

const props = defineProps<ToolComponentProps>()

const toolName = computed(() => {
  const rawToolName = props.message ? getMessageRawRecord(props.message).toolName : undefined
  return props.toolCall?.toolName ?? (typeof rawToolName === 'string' ? rawToolName : undefined) ?? 'tool'
})
const summary = computed(() => formatUnknown(props.toolCall?.args))
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
</script>

<template>
  <BaseTool :name="toolName" :summary="summary" :result="result" :status="status" :is-error="isError" />
</template>
