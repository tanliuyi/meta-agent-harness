<script setup lang="ts">
import { computed } from 'vue'
import { formatUnknown, getMessageRawRecord } from '../message-format'
import BaseTool from './BaseTool.vue'
import {
  countObjectKeys,
  getToolResultText,
  isToolError,
  truncateSummary,
  type ToolComponentProps
} from './tool-message'

const props = defineProps<ToolComponentProps>()

const toolName = computed(() => {
  const rawToolName = props.message ? getMessageRawRecord(props.message).toolName : undefined
  return props.toolCall?.toolName ?? (typeof rawToolName === 'string' ? rawToolName : undefined) ?? 'tool'
})
const argCount = computed(() => countObjectKeys(props.toolCall?.args))
const summary = computed(() => truncateSummary(formatUnknown(props.toolCall?.args), 80))
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
</script>

<template>
  <BaseTool :name="toolName" :summary="summary" :result="result" :status="status" :is-error="isError">
    <template #summary>
      <span v-if="summary" class="default-tool__summary">{{ summary }}</span>
      <span v-if="argCount !== undefined" class="default-tool__meta">{{ argCount }} args</span>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.default-tool__summary {
  color: var(--color-info);
}

.default-tool__meta {
  color: var(--color-text-subtle);
}
</style>
