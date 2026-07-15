<script setup lang="ts">
import { computed } from 'vue'
import { Globe } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, readString } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const summary = computed(() => {
  const action = readString(args.value.action)
  if (args.value.url) return `${action ?? 'navigate'} ${String(args.value.url)}`
  if (args.value.target) return `${action ?? 'target'} ${String(args.value.target)}`
  if (args.value.method) return `${action ?? 'cdp'} ${String(args.value.method)}`
  return action
})
const meta = computed(() =>
  [readString(args.value.browserId)].filter((item): item is string => Boolean(item))
)
</script>

<template>
  <BaseToolPart label="浏览器页面" :summary="summary" :meta="meta" :output="output" :state="state">
    <template #icon><Globe :size="15" /></template>
  </BaseToolPart>
</template>
