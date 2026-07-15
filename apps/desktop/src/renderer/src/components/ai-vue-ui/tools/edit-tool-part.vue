<script setup lang="ts">
import { computed } from 'vue'
import { FileEdit } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, readString } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const meta = computed(() => {
  const count = Array.isArray(args.value.edits) ? args.value.edits.length : undefined
  return count ? [`${count} 处替换`] : []
})
</script>

<template>
  <BaseToolPart
    label="编辑文件"
    :summary="readString(args.path)"
    :meta="meta"
    :output="output"
    :state="state"
  >
    <template #icon><FileEdit :size="15" /></template>
  </BaseToolPart>
</template>
