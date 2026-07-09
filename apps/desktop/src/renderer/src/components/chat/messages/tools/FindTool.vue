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
  truncateSummary,
  type ToolComponentProps
} from './support/tool-message'

const props = defineProps<ToolComponentProps>()
const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const args = computed(() => getToolArgs(props.toolCall))
const pattern = computed(() => truncateSummary(getStringArg(args.value, 'pattern'), 64))
const target = computed(() => getFileName(getStringArg(args.value, 'path')))
const limit = computed(() => getNumberArg(args.value, 'limit'))
const summary = computed(() =>
  joinSummary([pattern.value, target.value, limit.value ? `limit=${limit.value}` : undefined])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
const name = computed(() =>
  getToolStatusLabel(status.value, {
    queued: '正在查找',
    running: '正在查找',
    succeeded: '已查找',
    failed: '查找失败',
    cancelled: '取消查找'
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
    :open="props.open"
    @update:open="emit('update:open', $event)"
  >
    <template #summary>
      <span v-if="pattern" class="find-tool__pattern">{{ pattern }}</span>
      <span v-if="target" class="find-tool__target">{{ target }}</span>
      <span v-if="limit" class="find-tool__meta">limit={{ limit }}</span>
      <span v-if="!pattern && summary">{{ summary }}</span>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.find-tool__pattern {
  color: var(--color-info);
}

.find-tool__target,
.find-tool__meta {
  color: var(--color-text-subtle);
}
</style>
