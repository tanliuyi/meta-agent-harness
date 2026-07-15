<script setup lang="ts">
import { computed } from 'vue'
import { Wrench } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, readString, truncate } from './tool-part-support.ts'

const props = defineProps<{ name: string; args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const summary = computed(() => {
  for (const key of ['action', 'path', 'query', 'pattern', 'url', 'name', 'id']) {
    const value = readString(args.value[key])
    if (value) return value
  }
  const text = JSON.stringify(args.value)
  return text && text !== '{}' ? truncate(text, 120) : undefined
})
</script>

<template>
  <BaseToolPart :label="name || 'tool'" :summary="summary" :output="output" :state="state">
    <template #icon><Wrench :size="15" /></template>
  </BaseToolPart>
</template>
