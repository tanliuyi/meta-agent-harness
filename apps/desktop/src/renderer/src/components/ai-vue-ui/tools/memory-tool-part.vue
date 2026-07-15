<script setup lang="ts">
import { computed } from 'vue'
import { BrainCircuit } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, readString, truncate } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const summary = computed(() => {
  const content = truncate(
    readString(args.value.content) ?? readString(args.value.oldText) ?? '',
    80
  )
  return (
    [readString(args.value.action), readString(args.value.target), content]
      .filter(Boolean)
      .join(' ') || undefined
  )
})
const meta = computed(() =>
  [readString(args.value.category)].filter((item): item is string => Boolean(item))
)
</script>

<template>
  <BaseToolPart label="记忆" :summary="summary" :meta="meta" :output="output" :state="state">
    <template #icon><BrainCircuit :size="15" /></template>
  </BaseToolPart>
</template>
