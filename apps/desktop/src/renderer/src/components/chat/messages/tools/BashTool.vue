<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import TerminalIcon from '@renderer/components/icons/TerminalIcon.vue'
import {
  getNumberArg,
  getStringArg,
  getToolArgs,
  getToolResultText,
  isToolError,
  joinSummary,
  truncateSummary,
  type ToolComponentProps
} from './tool-message'

const props = defineProps<ToolComponentProps>()

const args = computed(() => getToolArgs(props.toolCall))
const command = computed(() => truncateSummary(getStringArg(args.value, 'command'), 96))
const timeout = computed(() => getNumberArg(args.value, 'timeout'))
const summary = computed(() =>
  joinSummary([command.value, timeout.value ? `timeout=${timeout.value}s` : undefined])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
</script>

<template>
  <BaseTool name="已执行" :summary="summary" :result="result" :status="status" :is-error="isError">
    <template #icon>
      <TerminalIcon :size="14" />
    </template>
    <template #summary>
      <span v-if="command" class="bash-tool__command">{{ command }}</span>
      <span v-if="timeout" class="bash-tool__meta">timeout={{ timeout }}s</span>
      <span v-if="summary && !command">{{ summary }}</span>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.bash-tool__command {
  color: var(--color-info);
}

.bash-tool__meta {
  color: var(--color-text-subtle);
}

.bash-tool__command + .bash-tool__meta {
  margin-left: var(--space-1);
}
</style>
