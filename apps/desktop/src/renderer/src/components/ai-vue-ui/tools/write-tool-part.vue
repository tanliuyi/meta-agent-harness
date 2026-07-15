<script setup lang="ts">
import { computed } from 'vue'
import { Pencil } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { formatBytes, parseToolArgs, readString } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const summary = computed(() => readString(args.value.path) ?? readString(args.value.file_path))
const meta = computed(() =>
  [formatBytes(readString(args.value.content)?.length)].filter((item): item is string =>
    Boolean(item)
  )
)
</script>

<template>
  <BaseToolPart label="写入文件" :summary="summary" :meta="meta" :output="output" :state="state">
    <template #icon><Pencil :size="15" /></template>
  </BaseToolPart>
</template>
