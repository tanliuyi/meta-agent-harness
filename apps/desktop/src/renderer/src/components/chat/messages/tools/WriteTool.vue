<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import PencilIcon from '@renderer/components/icons/PencilIcon.vue'
import {
  countTextLines,
  getFileName,
  getStringArg,
  getToolArgs,
  getToolStatusLabel,
  isToolError,
  joinSummary,
  type ToolComponentProps
} from './tool-message'

const props = defineProps<ToolComponentProps>()

const args = computed(() => getToolArgs(props.toolCall))
const fileName = computed(() => getFileName(getStringArg(args.value, 'path')))
const contentSize = computed(() => {
  const content = getStringArg(args.value, 'content')
  const lineCount = countTextLines(content)
  if (lineCount === undefined) {
    return undefined
  }
  return lineCount === 1 ? `${content?.length ?? 0} chars` : `${lineCount} lines`
})
const summary = computed(() => joinSummary([fileName.value, contentSize.value]))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
const name = computed(() =>
  getToolStatusLabel(status.value, {
    queued: '准备写入',
    running: '正在写入',
    succeeded: '已写入',
    failed: '写入失败',
    cancelled: '已取消写入'
  })
)
</script>

<template>
  <BaseTool :name="name" :summary="summary" :status="status" :is-error="isError">
    <template #icon>
      <PencilIcon :size="14" />
    </template>
    <template #summary>
      <span v-if="fileName" class="write-tool__path">{{ fileName }}</span>
      <span v-if="contentSize" class="write-tool__meta">{{ contentSize }}</span>
      <span v-if="!fileName && summary">{{ summary }}</span>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.write-tool__path {
  color: var(--color-info);
}

.write-tool__meta {
  color: var(--color-text-subtle);
}

.write-tool__path + .write-tool__meta {
  margin-left: var(--space-1);
}
</style>
