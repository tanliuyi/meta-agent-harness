<script setup lang="ts">
import { computed } from 'vue'
import { Globe } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseToolArgs, readString } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const summary = computed(() => readString(args.value.action) ?? readString(args.value.url))
const meta = computed(() =>
  [readString(args.value.browserId)].filter((item): item is string => Boolean(item))
)
</script>

<template>
  <BaseToolPart
    label="浏览器标签页"
    :summary="summary"
    :meta="meta"
    :output="output"
    :state="state"
  >
    <template #icon><Globe :size="15" /></template>
  </BaseToolPart>
</template>
