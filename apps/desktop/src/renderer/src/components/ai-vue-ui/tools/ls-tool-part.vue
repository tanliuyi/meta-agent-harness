<script setup lang="ts">
import { computed } from 'vue'
import { Folder } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, pushNumberMeta, readString } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const meta = computed(() => {
  const items: string[] = []
  pushNumberMeta(items, 'limit', args.value.limit)
  return items
})
</script>

<template>
  <BaseToolPart
    label="列出目录"
    :summary="readString(args.path) ?? '.'"
    :meta="meta"
    :output="output"
    :state="state"
  >
    <template #icon><Folder :size="15" /></template>
  </BaseToolPart>
</template>
