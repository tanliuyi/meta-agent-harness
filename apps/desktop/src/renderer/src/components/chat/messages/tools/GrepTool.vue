<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import {
  getBooleanArgLabel,
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
const target = computed(
  () =>
    getFileName(getStringArg(args.value, 'path')) ?? getStringArg(args.value, 'glob') ?? undefined
)
const ignoreCase = computed(() => getBooleanArgLabel(args.value, 'ignoreCase'))
const literal = computed(() => getBooleanArgLabel(args.value, 'literal'))
const context = computed(() => getNumberArg(args.value, 'context'))
const limit = computed(() => getNumberArg(args.value, 'limit'))
const summary = computed(() =>
  joinSummary([
    pattern.value,
    target.value,
    ignoreCase.value,
    literal.value,
    context.value ? `context=${context.value}` : undefined,
    limit.value ? `limit=${limit.value}` : undefined
  ])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
const name = computed(() =>
  getToolStatusLabel(status.value, {
    queued: '正在搜索',
    running: '正在搜索',
    succeeded: '已搜索',
    failed: '搜索失败',
    cancelled: '取消搜索'
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
      <span v-if="pattern" class="grep-tool__pattern">{{ pattern }}</span>
      <span v-if="target" class="grep-tool__target">{{ target }}</span>
      <span v-if="ignoreCase" class="grep-tool__meta">ignoreCase</span>
      <span v-if="literal" class="grep-tool__meta">literal</span>
      <span v-if="context" class="grep-tool__meta">context={{ context }}</span>
      <span v-if="limit" class="grep-tool__meta">limit={{ limit }}</span>
      <span v-if="!pattern && summary">{{ summary }}</span>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.grep-tool__pattern {
  color: var(--color-info);
}

.grep-tool__target,
.grep-tool__meta {
  color: var(--color-text-subtle);
}
</style>
