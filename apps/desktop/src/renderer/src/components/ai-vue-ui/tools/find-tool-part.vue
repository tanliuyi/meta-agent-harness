<script setup lang="ts">
import { computed } from 'vue'
import { FileSearch } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, pushNumberMeta, readString } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const meta = computed(() => {
  const items: string[] = []
  if (args.value.path) items.push(String(args.value.path))
  pushNumberMeta(items, 'limit', args.value.limit)
  return items
})
</script>

<template>
  <BaseToolPart
    label="查找文件"
    :summary="readString(args.pattern)"
    :meta="meta"
    :output="output"
    :state="state"
  >
    <template #icon><FileSearch :size="15" /></template>
  </BaseToolPart>
</template>
