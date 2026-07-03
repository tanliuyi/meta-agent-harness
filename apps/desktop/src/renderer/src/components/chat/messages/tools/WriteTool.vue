<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import {
  getStringArg,
  getToolArgs,
  getToolResultText,
  isToolError,
  joinSummary,
  type ToolComponentProps
} from './tool-message'

const props = defineProps<ToolComponentProps>()

const args = computed(() => getToolArgs(props.toolCall))
const contentSize = computed(() => {
  const content = getStringArg(args.value, 'content')
  return content ? `${content.length} chars` : undefined
})
const summary = computed(() => joinSummary([getStringArg(args.value, 'path'), contentSize.value]))
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
</script>

<template>
  <BaseTool name="Write" :summary="summary" :result="result" :status="status" :is-error="isError" />
</template>
