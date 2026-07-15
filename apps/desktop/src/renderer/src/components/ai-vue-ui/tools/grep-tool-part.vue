<script setup lang="ts">
import { computed } from 'vue'
import { Search } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, pushNumberMeta, readString } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const meta = computed(() => {
  const items: string[] = []
  if (args.value.path) items.push(String(args.value.path))
  if (args.value.glob) items.push(`glob ${String(args.value.glob)}`)
  pushNumberMeta(items, 'context', args.value.context)
  pushNumberMeta(items, 'limit', args.value.limit)
  return items
})
</script>

<template>
  <BaseToolPart
    label="搜索文本"
    :summary="readString(args.pattern)"
    :meta="meta"
    :output="output"
    :state="state"
  >
    <template #icon><Search :size="15" /></template>
  </BaseToolPart>
</template>
