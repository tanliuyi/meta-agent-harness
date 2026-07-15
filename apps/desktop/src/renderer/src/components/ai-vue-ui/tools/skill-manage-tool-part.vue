<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen } from 'lucide-vue-next'
import BaseToolPart from './base-tool-part.vue'
import { parseMaybeJson, parseToolArgs, readString, toRecord } from './tool-part-support.ts'

const props = defineProps<{ args: unknown; output: unknown; state?: string }>()
const args = computed(() => parseToolArgs(props.args))
const details = computed(() => toRecord(toRecord(parseMaybeJson(props.output))?.details))
const summary = computed(() => {
  const id =
    readString(args.value.skill_id) ??
    readString(args.value.name) ??
    readString(details.value?.skillId)
  return [readString(args.value.action), id].filter(Boolean).join(' ') || undefined
})
const meta = computed(() =>
  [readString(args.value.scope), readString(args.value.section)].filter((item): item is string =>
    Boolean(item)
  )
)
</script>

<template>
  <BaseToolPart label="管理技能" :summary="summary" :meta="meta" :output="output" :state="state">
    <template #icon><BookOpen :size="15" /></template>
  </BaseToolPart>
</template>
