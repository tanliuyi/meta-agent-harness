<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  BrainCircuit,
  ChevronRight,
  FilePenLine,
  FileText,
  FolderOpen,
  Search,
  Terminal,
  Wrench
} from 'lucide-vue-next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ChatDisplayToolCall, ChatToolGroupDisplayItem } from '../chat-display'
import BashToolPart from './bash-tool-part.vue'
import ToolPart from './tool-part.vue'

const props = defineProps<{
  item: ChatToolGroupDisplayItem
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const modelOpen = computed({
  get: () => props.open,
  set: (open: boolean) => emit('update:open', open)
})

const visibleTools = computed(() => {
  const seen = new Set<string>()
  return props.item.toolCalls.filter((toolCall) => {
    if (seen.has(toolCall.name)) return false
    seen.add(toolCall.name)
    return true
  })
})
const hiddenToolCount = computed(() => Math.max(0, visibleTools.value.length - 4))

function getToolIcon(name: string): Component {
  switch (name) {
    case 'bash':
      return Terminal
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
    case 'memory':
    case 'memory_search':
      return BrainCircuit
    default:
      return Wrench
  }
}

function getToolOutputState(toolCall: ChatDisplayToolCall): string {
  if (toolCall.status === 'failed') return 'error'
  if (toolCall.status === 'succeeded') return 'complete'
  return toolCall.state
}
</script>

<template>
  <Collapsible v-model:open="modelOpen" class="chat-tool-group" :data-status="item.status">
    <CollapsibleTrigger class="chat-tool-group__trigger" :aria-label="item.summary">
      <span class="chat-tool-group__icons" aria-hidden="true">
        <span
          v-for="(toolCall, index) in visibleTools.slice(0, 4)"
          :key="toolCall.name"
          class="chat-tool-group__icon-item"
          :data-tool-name="toolCall.name"
          :style="{ zIndex: 4 - index }"
        >
          <component :is="getToolIcon(toolCall.name)" :size="12" />
        </span>
        <span v-if="hiddenToolCount" class="chat-tool-group__icon-item is-more">
          +{{ hiddenToolCount }}
        </span>
      </span>
      <span class="chat-tool-group__summary">
        <template v-for="(part, index) in item.summaryParts" :key="part.key">
          <span :class="{ 'is-failed': part.status === 'failed' }">{{ part.text }}</span>
          <span v-if="index < item.summaryParts.length - 1">，</span>
        </template>
      </span>
      <ChevronRight :size="15" class="chat-tool-group__chevron" aria-hidden="true" />
    </CollapsibleTrigger>

    <CollapsibleContent class="chat-tool-group__content">
      <div v-if="open" class="chat-tool-group__list">
        <div v-for="toolCall in item.toolCalls" :key="toolCall.id" class="chat-tool-group__item">
          <div v-if="toolCall.argumentError" class="chat-tool-group__argument-error">
            <div class="chat-tool-group__argument-error-title">
              <CircleAlert :size="13" />
              <span>工具参数不是有效 JSON</span>
            </div>
            <code>{{ toolCall.rawArguments }}</code>
          </div>
          <BashToolPart
            v-else-if="toolCall.name === 'bash'"
            :args="toolCall.args"
            :output="toolCall.output"
            :state="getToolOutputState(toolCall)"
          />
          <ToolPart
            v-else
            :name="toolCall.name"
            :args="toolCall.args"
            :output="toolCall.output"
            :state="getToolOutputState(toolCall)"
          />
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<style lang="scss" scoped>
.chat-tool-group {
  flex: 1;
  width: 100%;
  max-width: 720px;
  min-width: 0;
  border-radius: var(--radius-sm);
}

.chat-tool-group__trigger {
  display: flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  min-height: 24px;
  gap: var(--space-2);
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
  border-radius: inherit;
  transition: color var(--duration-fast) var(--ease-standard);
}

.chat-tool-group__trigger:hover,
.chat-tool-group__trigger:focus-visible {
  color: var(--color-hover);
}

.chat-tool-group__icons {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-width: 18px;
  height: 18px;
}

.chat-tool-group__icon-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--tool-group-stack-fg, var(--color-text-muted));
  background: var(--tool-group-stack-bg, var(--color-bg-elevated, var(--color-canvas)));
  border: 1px solid var(--color-canvas);
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--color-border-subtle, var(--color-border));
}

.chat-tool-group__icon-item + .chat-tool-group__icon-item {
  margin-inline-start: -7px;
}

.chat-tool-group__icon-item[data-tool-name='bash'] {
  --tool-group-stack-bg: color-mix(in srgb, #6b8f7a 13%, var(--color-canvas));
  --tool-group-stack-fg: #4d6f5d;
}

.chat-tool-group__icon-item[data-tool-name='edit'],
.chat-tool-group__icon-item[data-tool-name='write'] {
  --tool-group-stack-bg: color-mix(in srgb, #8b8170 14%, var(--color-canvas));
  --tool-group-stack-fg: #6f6658;
}

.chat-tool-group__icon-item[data-tool-name='read'] {
  --tool-group-stack-bg: color-mix(in srgb, #6f8398 13%, var(--color-canvas));
  --tool-group-stack-fg: #52677d;
}

.chat-tool-group__icon-item[data-tool-name='grep'],
.chat-tool-group__icon-item[data-tool-name='find'] {
  --tool-group-stack-bg: color-mix(in srgb, #7c778f 13%, var(--color-canvas));
  --tool-group-stack-fg: #635f75;
}

.chat-tool-group__icon-item[data-tool-name='memory'],
.chat-tool-group__icon-item[data-tool-name='memory_search'] {
  --tool-group-stack-bg: color-mix(in srgb, #9a7b55 13%, var(--color-canvas));
  --tool-group-stack-fg: #765d3f;
}

.chat-tool-group__icon-item[data-tool-name='ls'] {
  --tool-group-stack-bg: color-mix(in srgb, #73777d 12%, var(--color-canvas));
  --tool-group-stack-fg: #5f6368;
}

.chat-tool-group__icon-item[data-tool-name='skill_manage'] {
  --tool-group-stack-bg: color-mix(in srgb, #668577 13%, var(--color-canvas));
  --tool-group-stack-fg: #4d6c5f;
}

.chat-tool-group__icon-item.is-more {
  z-index: 0;
  color: var(--color-text-subtle);
  background: var(--color-canvas);
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
}

.chat-tool-group__summary {
  overflow: hidden;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  color: var(--color-text-subtle);
  font-size: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-tool-group__trigger:hover .chat-tool-group__summary,
.chat-tool-group__trigger:focus-visible .chat-tool-group__summary {
  color: var(--color-text);
}

.chat-tool-group__summary .is-failed {
  color: var(--color-danger);
}

.chat-tool-group__chevron {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
  opacity: 0;
  transition: transform var(--duration-fast) var(--ease-standard);
}

.chat-tool-group__trigger:hover .chat-tool-group__chevron,
.chat-tool-group__trigger:focus-visible .chat-tool-group__chevron {
  opacity: 1;
}

.chat-tool-group[data-state='open'] .chat-tool-group__chevron {
  opacity: 1;
  transform: rotate(90deg);
}

.chat-tool-group__content {
  overflow: hidden;
}

.chat-tool-group__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  margin-top: var(--space-1);
  padding: var(--space-1) 0;
}

.chat-tool-group__item :deep(.base-tool-part) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  width: 100%;
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
}

.chat-tool-group__item :deep(.base-tool-part__header),
.chat-tool-group__item :deep(.bash-tool-part__header) {
  background: transparent;
}

.chat-tool-group__item :deep(.base-tool-part__header:hover),
.chat-tool-group__item :deep(.base-tool-part__header:focus-within),
.chat-tool-group__item :deep(.bash-tool-part__header:hover),
.chat-tool-group__item :deep(.bash-tool-part__header:focus-within) {
  background: transparent;
}

.chat-tool-group__item :deep(.base-tool-part__summary),
.chat-tool-group__item :deep(.bash-tool-part__summary) {
  flex: 0 1 auto;
  width: fit-content;
  max-width: 100%;
  min-height: 24px;
  padding: 0;
  gap: var(--space-2);
}

.chat-tool-group__item :deep(.base-tool-part__icon),
.chat-tool-group__item :deep(.bash-tool-part__icon),
.chat-tool-group__item :deep(.base-tool-part__chevron),
.chat-tool-group__item :deep(.bash-tool-part__chevron),
.chat-tool-group__item :deep(.base-tool-part__actions),
.chat-tool-group__item :deep(.bash-tool-part__actions) {
  display: none;
}

.chat-tool-group__item :deep(.base-tool-part__label),
.chat-tool-group__item :deep(.bash-tool-part__title) {
  color: var(--color-text-muted);
  font-size: var(--font-size-ui);
  font-weight: 400;
}

.chat-tool-group__item :deep(.base-tool-part__summary-text),
.chat-tool-group__item :deep(.bash-tool-part__command) {
  flex: 0 1 auto;
  color: var(--color-info);
  font-family: var(--font-sans);
  font-size: var(--font-size-ui);
  font-weight: 400;
}

.chat-tool-group__item :deep(.base-tool-part__body),
.chat-tool-group__item :deep(.bash-tool-part__body) {
  margin-left: 0;
  border: 0;
}

.chat-tool-group__item :deep(.base-tool-part__scroll),
.chat-tool-group__item :deep(.bash-tool-part__scroll) {
  margin-top: var(--space-1);
  padding: var(--space-2);
  background: var(--color-code-bg);
  border-radius: var(--radius-sm);
}

.chat-tool-group__item :deep(.base-tool-part__output),
.chat-tool-group__item :deep(.bash-tool-part__output),
.chat-tool-group__item :deep(.base-tool-part__details pre) {
  padding: 0;
  background: transparent;
}

.chat-tool-group__argument-error {
  padding: var(--space-2);
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 4%, transparent);
  font-size: var(--font-size-ui-xs);
}

.chat-tool-group__argument-error-title {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-1);
}

.chat-tool-group__argument-error code {
  display: block;
  overflow-wrap: anywhere;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

@media (prefers-reduced-motion: reduce) {
  .chat-tool-group__chevron {
    transition: none;
  }
}
</style>
