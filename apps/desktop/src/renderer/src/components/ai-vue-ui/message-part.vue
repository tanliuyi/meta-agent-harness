<script setup lang="ts">
import { computed } from 'vue'
import ThinkingPart from './thinking-part.vue'
import type { ChatMessagePart, ChatSlotContent, ToolCallRenderProps } from './types'
import TextPart from './text-part.vue'
import ToolPart from './tools/tool-part.vue'
import BashToolPart from './tools/bash-tool-part.vue'

interface MessagePartProps {
  part: ChatMessagePart
  isThinkingComplete?: boolean
}

const props = defineProps<MessagePartProps>()

type MessagePartSlots = {
  text?: (props: { content: string }) => ChatSlotContent
  thinking?: (props: { content: string; isComplete?: boolean | undefined }) => ChatSlotContent
  'tool-default'?: (props: ToolCallRenderProps) => ChatSlotContent
  'tool-result'?: (props: {
    toolCallId: string
    content: unknown
    state: string
  }) => ChatSlotContent
} & Partial<Record<`tool-${string}`, (props: ToolCallRenderProps) => ChatSlotContent>>

defineSlots<MessagePartSlots>()

const toolProps = computed<ToolCallRenderProps | null>(() => {
  if (props.part.type === 'tool-call') {
    return {
      id: props.part.id,
      name: props.part.name,
      arguments: props.part.arguments,
      state: props.part.state,
      approval: props.part.approval,
      output: props.part.output
    }
  }
  return null
})
</script>

<template>
  <!-- Text part -->
  <div v-if="part.type === 'text'">
    <slot v-if="$slots['text']" name="text" :content="part.content" />
    <TextPart v-else :content="part.content" />
  </div>

  <!-- Thinking part -->
  <div v-else-if="part.type === 'thinking'">
    <slot
      v-if="$slots['thinking']"
      name="thinking"
      :content="part.content"
      :is-complete="isThinkingComplete"
    ></slot>
    <ThinkingPart v-else :content="part.content" :is-complete="isThinkingComplete" />
  </div>

  <!-- Tool call part -->
  <div
    v-else-if="part.type === 'tool-call' && toolProps"
    data-part-type="tool-call"
    :data-tool-name="part.name"
    :data-tool-state="part.state"
    :data-tool-id="part.id"
  >
    <!-- Check for named tool slot first -->
    <slot v-if="$slots[`tool-${part.name}`]" :name="`tool-${part.name}`" v-bind="toolProps" />
    <!-- Default tool slot -->
    <slot v-else-if="$slots['tool-default']" name="tool-default" v-bind="toolProps" />
    <!-- Fallback to built-in default renderer -->
    <template v-else>
      <template v-if="part.name === 'bash'">
        <BashToolPart :args="part.arguments" :output="part.output" :state="part.state" />
      </template>

      <ToolPart
        v-else
        :name="part.name"
        :args="part.arguments"
        :output="part.output"
        :state="part.state"
      />
    </template>
  </div>

  <!-- Tool result part -->
  <div
    v-else-if="part.type === 'tool-result' && $slots['tool-result']"
    data-part-type="tool-result"
    :data-tool-call-id="part.toolCallId"
    :data-tool-result-state="part.state"
  >
    <slot
      name="tool-result"
      :tool-call-id="part.toolCallId"
      :content="part.content"
      :state="part.state"
    />
  </div>
</template>
