<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import {
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
const editCount = computed(() => {
  const edits = args.value.edits
  return Array.isArray(edits) ? edits.length : undefined
})
const summary = computed(() =>
  joinSummary([
    getStringArg(args.value, 'path'),
    editCount.value ? `${editCount.value} edits` : undefined
  ])
)
const result = computed(() => {
  const diff = details.value.diff
  return typeof diff === 'string' ? diff : getToolResultText(props.message, props.toolCall)
})
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
</script>

<template>
  <BaseTool name="Edit" :summary="summary" :result="result" :status="status" :is-error="isError" />
</template>
