<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import {
  getNumberArg,
  getStringArg,
  getToolArgs,
  getToolResultText,
  isToolError,
  joinSummary,
  type ToolComponentProps
} from './tool-message'

const props = defineProps<ToolComponentProps>()

const args = computed(() => getToolArgs(props.toolCall))
const summary = computed(() =>
  joinSummary([
    getStringArg(args.value, 'path'),
    getNumberArg(args.value, 'offset') ? `offset=${getNumberArg(args.value, 'offset')}` : undefined,
    getNumberArg(args.value, 'limit') ? `limit=${getNumberArg(args.value, 'limit')}` : undefined
  ])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
</script>

<template>
  <BaseTool name="Read" :summary="summary" :result="result" :status="status" :is-error="isError" />
</template>
