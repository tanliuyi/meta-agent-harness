<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import PencilIcon from '@renderer/components/icons/PencilIcon.vue'
import DiffViewer from './DiffViewer.vue'
import { countDisplayDiffStats } from './display/diffDisplay'
import {
  getFileName,
  getStringArg,
  getToolArgs,
  getToolDetails,
  getToolResultText,
  getToolStatusLabel,
  isToolError,
  joinSummary,
  type ToolComponentProps
} from './support/tool-message'

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
const name = computed(() =>
  getToolStatusLabel(status.value, {
    queued: '准备编辑',
    running: '正在编辑',
    succeeded: '已编辑',
    failed: '编辑失败',
    cancelled: '已取消编辑'
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
    :scroll-content="false"
    max-content-height="360px"
    content-class="edit-tool__diff-content"
    result-class="edit-tool__diff-result"
    :default-open="props.defaultOpen"
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
  --diff-added-fg: #1a7f37;

  margin-inline-start: var(--space-1);
  color: var(--diff-added-fg);
}

.edit-tool__deletions {
  --diff-removed-fg: #cf222e;

  margin-inline-start: var(--space-1);
  color: var(--diff-removed-fg);
}

:global(:root[data-theme='dark']) .edit-tool__additions {
  --diff-added-fg: #3fb950;
}

:global(:root[data-theme='dark']) .edit-tool__deletions {
  --diff-removed-fg: #f85149;
}

:deep(.edit-tool__diff-result) {
  display: flex;
  min-width: 0;
  min-height: 0;
  width: 100%;
  max-height: inherit;
  padding: 0 !important;
}

:deep(.edit-tool__diff-content .tool-message__content-inner) {
  display: flex;
  min-width: 0;
  min-height: 0;
  max-height: inherit;
  padding: 0 !important;
}
</style>
