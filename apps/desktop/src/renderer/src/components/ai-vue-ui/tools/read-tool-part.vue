<script setup lang="ts">
import { computed } from 'vue'
import { FileText } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, pushNumberMeta, readString } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const meta = computed(() => {
  const items: string[] = []
  pushNumberMeta(items, 'offset', args.value.offset)
  pushNumberMeta(items, 'limit', args.value.limit)
  return items
})
</script>

<template>
  <BaseToolPart
    label="读取文件"
    :summary="readString(args.path)"
    :meta="meta"
    :output="output"
    :state="state"
  >
    <template #icon><FileText :size="15" /></template>
  </BaseToolPart>
</template>
