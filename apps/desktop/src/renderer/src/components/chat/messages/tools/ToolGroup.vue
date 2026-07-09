<script setup lang="ts">
import { computed, type Component } from 'vue'
import { FilePenLine, FileText, FolderOpen, Search } from 'lucide-vue-next'
import TerminalIcon from '@renderer/components/icons/TerminalIcon.vue'
import ToolGroupIcon from '@renderer/components/icons/ToolGroupIcon.vue'
import ToolIcon from '@renderer/components/icons/ToolIcon.vue'
import ToolMessage from '../ToolMessage.vue'
import BaseToolGroup from './BaseToolGroup.vue'
import { summarizeToolGroupParts, type ToolCall, type ToolGroupStatus } from './support/tool-group'

const props = defineProps<{
  toolCallIds: string[]
  toolCalls: ToolCall[]
  summary: string
  status?: ToolGroupStatus
  defaultOpen?: boolean
  open?: boolean
  toolOpenByKey?: Record<string, boolean>
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  updateToolOpen: [toolCallId: string, open: boolean]
}>()

const visibleIconCount = 4
const uniqueToolIcons = computed(() => {
  const seenToolNames = new Set<string>()
  return props.toolCalls.filter((toolCall) => {
    const toolName = toolCall.toolName ?? 'tool'
    if (seenToolNames.has(toolName)) {
      return false
    }
    seenToolNames.add(toolName)
    return true
  })
})
const stackedToolIcons = computed(() => uniqueToolIcons.value.slice(0, visibleIconCount))
const hiddenToolIconCount = computed(() =>
  Math.max(0, uniqueToolIcons.value.length - visibleIconCount)
)
const summaryParts = computed(() => summarizeToolGroupParts(props.toolCalls))
const summaryHasActivePart = computed(() =>
  summaryParts.value.some((part) => part.status === 'queued' || part.status === 'running')
)

function getToolOpen(toolCall: ToolCall): boolean {
  return props.toolOpenByKey?.[toolCall.toolCallId] ?? props.defaultOpen ?? false
}

function getToolIconComponent(toolName: string | undefined): Component {
  switch (toolName) {
    case 'bash':
      return TerminalIcon
    case 'edit':
    case 'write':
      return FilePenLine
    case 'read':
      return FileText
    case 'grep':
    case 'find':
      return Search
    case 'ls':
      return FolderOpen
    default:
      return ToolIcon
  }
}
</script>

<template>
  <BaseToolGroup
    :open="props.open"
    :summary="props.summary"
    :status="props.status"
    :is-error="props.status === 'failed'"
    :default-open="props.defaultOpen"
    :class="{ 'tool-group--summary-active': summaryHasActivePart }"
    @update:open="emit('update:open', $event)"
  >
    <template #summary>
      <template v-if="summaryParts.length">
        <template v-for="(part, index) in summaryParts" :key="`${part.key}:${index}`">
          <span :class="{ 'tool-group-summary-part--failed': part.status === 'failed' }">
            {{ part.text }}
          </span>
          <span v-if="index < summaryParts.length - 1">，</span>
        </template>
      </template>
      <template v-else>{{ props.summary }}</template>
    </template>
    <template #icon>
      <span v-if="stackedToolIcons.length" class="tool-group-stack" aria-hidden="true">
        <span
          v-for="(toolCall, index) in stackedToolIcons"
          :key="toolCall.toolCallId"
          class="tool-group-stack__item"
          :data-tool-name="toolCall.toolName ?? 'tool'"
          :style="{ zIndex: stackedToolIcons.length - index }"
        >
          <component :is="getToolIconComponent(toolCall.toolName)" :size="12" />
        </span>
        <span v-if="hiddenToolIconCount" class="tool-group-stack__item tool-group-stack__more">
          +{{ hiddenToolIconCount }}
        </span>
      </span>
      <ToolGroupIcon v-else :size="14" />
    </template>
    <template #default="{ open: groupOpen }">
      <template v-if="groupOpen">
        <ToolMessage
          v-for="toolCall in props.toolCalls"
          :key="toolCall.toolCallId"
          :tool-call="toolCall"
          :default-open="props.defaultOpen"
          :open="getToolOpen(toolCall)"
          @update:open="emit('updateToolOpen', toolCall.toolCallId, $event)"
        />
      </template>
    </template>
  </BaseToolGroup>
</template>

<style lang="scss" scoped>
.tool-group-summary-part--failed {
  color: var(--color-danger);
}

.tool-group-stack {
  display: inline-flex;
  align-items: center;
  min-width: 18px;
  height: 18px;
}

.tool-group-stack__item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid var(--color-canvas);
  border-radius: 999px;
  color: var(--tool-group-stack-fg, var(--color-text-muted));
  background: var(--tool-group-stack-bg, var(--color-bg-elevated, var(--color-canvas)));
  box-shadow: 0 0 0 1px var(--color-border-subtle, var(--color-border));

  & + & {
    margin-inline-start: -7px;
  }
}

.tool-group-stack__item[data-tool-name='bash'] {
  --tool-group-stack-bg: color-mix(in srgb, #6b8f7a 13%, var(--color-canvas));
  --tool-group-stack-fg: #4d6f5d;
}

.tool-group-stack__item[data-tool-name='edit'],
.tool-group-stack__item[data-tool-name='write'] {
  --tool-group-stack-bg: color-mix(in srgb, #8b8170 14%, var(--color-canvas));
  --tool-group-stack-fg: #6f6658;
}

.tool-group-stack__item[data-tool-name='read'] {
  --tool-group-stack-bg: color-mix(in srgb, #6f8398 13%, var(--color-canvas));
  --tool-group-stack-fg: #52677d;
}

.tool-group-stack__item[data-tool-name='grep'],
.tool-group-stack__item[data-tool-name='find'] {
  --tool-group-stack-bg: color-mix(in srgb, #7c778f 13%, var(--color-canvas));
  --tool-group-stack-fg: #635f75;
}

.tool-group-stack__item[data-tool-name='ls'] {
  --tool-group-stack-bg: color-mix(in srgb, #73777d 12%, var(--color-canvas));
  --tool-group-stack-fg: #5f6368;
}

.tool-group-stack__more {
  z-index: 0;
  color: var(--color-text-subtle);
  background: var(--color-canvas);
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
}
</style>
