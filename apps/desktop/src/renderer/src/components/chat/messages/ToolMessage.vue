<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { Message } from '@ag-ui/core'
import type { ThreadSnapshot } from '@shared/coding-agent/types'
import BashTool from './tools/BashTool.vue'
import DefaultTool from './tools/DefaultTool.vue'
import EditTool from './tools/EditTool.vue'
import FindTool from './tools/FindTool.vue'
import GrepTool from './tools/GrepTool.vue'
import LsTool from './tools/LsTool.vue'
import MemorySearch from './tools/MemorySearch.vue'
import MemoryTool from './tools/MemoryTool.vue'
import ReadTool from './tools/ReadTool.vue'
import SkillManageTool from './tools/SkillManageTool.vue'
import WriteTool from './tools/WriteTool.vue'

const props = defineProps<{
  message?: Message
  toolCall?: ThreadSnapshot['toolCalls'][number]
  defaultOpen?: boolean
  open?: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const toolName = computed(() => props.toolCall?.toolName ?? 'tool')
const toolComponent = computed(() => getToolComponent(toolName.value))

/**
 * 获取工具名对应的独立展示组件。
 * @param name - 工具名。
 * @returns 组件。
 */
function getToolComponent(name: string): Component {
  switch (name) {
    case 'bash':
      return BashTool
    case 'read':
      return ReadTool
    case 'edit':
      return EditTool
    case 'write':
      return WriteTool
    case 'grep':
      return GrepTool
    case 'find':
      return FindTool
    case 'ls':
      return LsTool
    case 'memory':
      return MemoryTool
    case 'memory_search':
      return MemorySearch
    case 'skill_manage':
      return SkillManageTool
    default:
      return DefaultTool
  }
}
</script>

<template>
  <component
    :is="toolComponent"
    :message="message"
    :tool-call="toolCall"
    :default-open="defaultOpen"
    :open="open"
    @update:open="emit('update:open', $event)"
  />
</template>
