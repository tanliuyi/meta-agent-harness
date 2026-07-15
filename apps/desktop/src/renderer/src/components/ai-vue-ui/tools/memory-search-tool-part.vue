<script setup lang="ts">
import { computed } from 'vue'
import { Search } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, pushNumberMeta, readString } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const meta = computed(() => {
  const items = [
    readString(args.value.project),
    readString(args.value.target),
    readString(args.value.category)
  ].filter((item): item is string => Boolean(item))
  pushNumberMeta(items, 'limit', args.value.limit)
  return items
})
</script>

<template>
  <BaseToolPart
    label="搜索记忆"
    :summary="readString(args.query)"
    :meta="meta"
    :output="output"
    :state="state"
  >
    <template #icon><Search :size="15" /></template>
  </BaseToolPart>
</template>
