<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import PencilIcon from '@renderer/components/icons/PencilIcon.vue'
import DiffViewer from './DiffViewer.vue'
import {
  getFileName,
  getStringArg,
  getToolArgs,
  getToolDetails,
  getToolResultText,
  isToolError,
  joinSummary,
  type ToolComponentProps
} from './tool-message'

const props = defineProps<ToolComponentProps>()

const args = computed(() => getToolArgs(props.toolCall))
const details = computed(() => getToolDetails(props.toolCall))
const filePath = computed(() => getStringArg(args.value, 'path'))
const fileName = computed(() => getFileName(filePath.value))
const editCount = computed(() => {
  const edits = args.value.edits
  return Array.isArray(edits) ? edits.length : undefined
})
const summary = computed(() =>
  joinSummary([fileName.value, editCount.value ? `${editCount.value} edits` : undefined])
)
const diffStats = computed(() => countDisplayDiffStats(details.value.diff))
const result = computed(() => {
  const diff = details.value.diff
  return typeof diff === 'string' ? diff : getToolResultText(props.message, props.toolCall)
})
const diff = computed(() => {
  const value = details.value.diff
  return typeof value === 'string' ? value : undefined
})
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)

function countDisplayDiffStats(value: unknown): { additions: number; deletions: number } {
  if (typeof value !== 'string') {
    return { additions: 0, deletions: 0 }
  }
  let additions = 0
  let deletions = 0
  for (const line of value.split('\n')) {
    if (/^\+\s*\d+\s/.test(line)) additions++
    if (/^-\s*\d+\s/.test(line)) deletions++
  }
  return { additions, deletions }
}
</script>

<template>
  <BaseTool
    name="已编辑"
    :summary="summary"
    :result="result"
    :status="status"
    :is-error="isError"
    :scroll-content="false"
    max-content-height="360px"
    content-class="edit-tool__diff-content"
    result-class="edit-tool__diff-result"
  >
    <template #icon>
      <PencilIcon :size="14" />
    </template>

    <template #summary>
      <span v-if="fileName" class="edit-tool__path">{{ fileName }}</span>
      <span v-if="diffStats.additions > 0" class="edit-tool__additions"
        >+{{ diffStats.additions }}</span
      >
      <span v-if="diffStats.deletions > 0" class="edit-tool__deletions"
        >-{{ diffStats.deletions }}</span
      >
      <span v-if="!fileName && summary">{{ summary }}</span>
    </template>

    <template v-if="diff" #result>
      <DiffViewer :diff="diff" />
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.edit-tool__path {
  color: var(--color-info);
}

.edit-tool__additions {
  margin-inline-start: var(--space-1);
  color: var(--color-primary);
}

.edit-tool__deletions {
  margin-inline-start: var(--space-1);
  color: var(--color-danger);
}

:deep(.edit-tool__diff-result) {
  padding: 0 !important;
}

:deep(.edit-tool__diff-content .tool-message__content-inner) {
  max-height: inherit;
  padding: 0 !important;
}
</style>
