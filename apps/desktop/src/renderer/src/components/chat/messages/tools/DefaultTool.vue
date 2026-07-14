<script setup lang="ts">
import { computed } from 'vue'
import { formatUnknown } from '../support/message-format'
import BaseTool from './BaseTool.vue'
import {
  countObjectKeys,
  getToolResultText,
  isToolError,
  truncateSummary,
  type ToolComponentProps
} from './support/tool-message'

const props = defineProps<ToolComponentProps>()
const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const toolName = computed(() => props.toolCall?.toolName ?? 'tool')
const argCount = computed(() => countObjectKeys(props.toolCall?.args))
const summary = computed(() => truncateSummary(formatUnknown(props.toolCall?.args), 80))
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
</script>

<template>
  <BaseTool
    :name="toolName"
    :summary="summary"
    :result="result"
    :status="status"
    :is-error="isError"
    :default-open="props.defaultOpen"
    :open="props.open"
    @update:open="emit('update:open', $event)"
  >
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
