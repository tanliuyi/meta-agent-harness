<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import {
  getFileName,
  getNumberArg,
  getStringArg,
  getToolArgs,
  getToolResultText,
  getToolStatusLabel,
  isToolError,
  joinSummary,
  type ToolComponentProps
} from './support/tool-message'

const props = defineProps<ToolComponentProps>()

const args = computed(() => getToolArgs(props.toolCall))
const target = computed(() => getFileName(getStringArg(args.value, 'path')) ?? '.')
const limit = computed(() => getNumberArg(args.value, 'limit'))
const summary = computed(() =>
  joinSummary([target.value, limit.value ? `limit=${limit.value}` : undefined])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
const name = computed(() =>
  getToolStatusLabel(status.value, {
    queued: '列出',
    running: '列出',
    succeeded: '已列出',
    failed: '列出失败',
    cancelled: '取消列出'
  })
)
</script>

<template>
  <BaseTool
    :name="name"
    :summary="summary"
    :result="result"
    :status="status"
    :is-error="isError"
    :default-open="props.defaultOpen"
  >
    <template #summary>
      <span class="ls-tool__target">{{ target }}</span>
      <span v-if="limit" class="ls-tool__meta">limit={{ limit }}</span>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.ls-tool__target {
  color: var(--color-info);
}

.ls-tool__meta {
  color: var(--color-text-subtle);
}
</style>
