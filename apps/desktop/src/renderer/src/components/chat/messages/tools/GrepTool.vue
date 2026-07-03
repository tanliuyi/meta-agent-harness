<script setup lang="ts">
import { computed } from 'vue'
import BaseTool from './BaseTool.vue'
import {
  getBooleanArgLabel,
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
    getStringArg(args.value, 'pattern'),
    getStringArg(args.value, 'path'),
    getStringArg(args.value, 'glob'),
    getBooleanArgLabel(args.value, 'ignoreCase'),
    getBooleanArgLabel(args.value, 'literal'),
    getNumberArg(args.value, 'context')
      ? `context=${getNumberArg(args.value, 'context')}`
      : undefined,
    getNumberArg(args.value, 'limit') ? `limit=${getNumberArg(args.value, 'limit')}` : undefined
  ])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
</script>

<template>
  <BaseTool name="Grep" :summary="summary" :result="result" :status="status" :is-error="isError" />
</template>
