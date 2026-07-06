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
const fileName = computed(() => getFileName(getStringArg(args.value, 'path')))
const offset = computed(() => getNumberArg(args.value, 'offset'))
const limit = computed(() => getNumberArg(args.value, 'limit'))
const summary = computed(() =>
  joinSummary([
    fileName.value,
    offset.value ? `offset=${offset.value}` : undefined,
    limit.value ? `limit=${limit.value}` : undefined
  ])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
const name = computed(() =>
  getToolStatusLabel(status.value, {
    queued: '准备读取',
    running: '正在读取',
    succeeded: '已读取',
    failed: '读取失败',
    cancelled: '已取消读取'
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
      <span v-if="fileName" class="read-tool__path">{{ fileName }}</span>
      <span v-if="offset" class="read-tool__meta">offset={{ offset }}</span>
      <span v-if="limit" class="read-tool__meta">limit={{ limit }}</span>
      <span v-if="!fileName && summary">{{ summary }}</span>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.read-tool__path {
  color: var(--color-info);
}

.read-tool__meta {
  color: var(--color-text-subtle);
}

.read-tool__path + .read-tool__meta,
.read-tool__meta + .read-tool__meta {
  margin-left: var(--space-1);
}
</style>
