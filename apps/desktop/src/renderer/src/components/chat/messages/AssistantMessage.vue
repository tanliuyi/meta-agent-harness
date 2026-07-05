<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RenderableThreadMessage } from './renderable-message'
import { formatMessageTime, getMessageText } from './message-format'
import StreamingMarkdown from '../../markdown/StreamingMarkdown.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Check, Copy, CornerDownRight, GitFork, MapPin } from 'lucide-vue-next'

const props = defineProps<{
  message: RenderableThreadMessage
  text?: string
  /** 是否是最终回复（无工具调用的 assistant 消息）。 */
  isFinalReply?: boolean
  /** 消息更新是否已完成。 */
  isDone?: boolean
}>()

const emit = defineEmits<{
  forkFromMessage: [entryId: string]
  locateInTree: [entryId: string]
  navigateTree: [entryId: string]
}>()

const source = computed(() => props.text ?? getMessageText(props.message) ?? '')
const formattedTime = computed(() => formatMessageTime(props.message.createdAt))

const isCopied = ref(false)
let copyTimeout: ReturnType<typeof setTimeout> | null = null

async function copyMessageText(): Promise<void> {
  const text = props.text ?? getMessageText(props.message)
  if (!text) return

  try {
    await navigator.clipboard.writeText(text)
    isCopied.value = true
    if (copyTimeout) clearTimeout(copyTimeout)
    copyTimeout = setTimeout(() => {
      isCopied.value = false
    }, 1000)
  } catch (err) {
    console.error('Failed to copy message:', err)
  }
}

function forkFromMessage(): void {
  if (!props.message.sessionEntryId) return
  emit('forkFromMessage', props.message.sessionEntryId)
}

function locateInTree(): void {
  if (!props.message.sessionEntryId) return
  emit('locateInTree', props.message.sessionEntryId)
}

function navigateTree(): void {
  if (!props.message.sessionEntryId) return
  emit('navigateTree', props.message.sessionEntryId)
}
</script>

<template>
  <div class="message is-assistant">
    <div class="assistant-message">
      <StreamingMarkdown
        :source="source"
        :revision="message.revision"
        :is-streaming="message.renderState === 'streaming'"
        :message-id="message.id"
      />
    </div>
    <div v-if="isFinalReply && isDone" class="message__actions">
      <TooltipProvider>
        <Tooltip v-if="message.sessionEntryId">
          <TooltipTrigger as-child>
            <BaseIconButton label="从这里继续" size="small" @click="navigateTree">
              <CornerDownRight :size="14" />
            </BaseIconButton>
          </TooltipTrigger>
          <TooltipContent>从这里继续</TooltipContent>
        </Tooltip>
        <Tooltip v-if="message.sessionEntryId">
          <TooltipTrigger as-child>
            <BaseIconButton label="在 Tree 中定位" size="small" @click="locateInTree">
              <MapPin :size="14" />
            </BaseIconButton>
          </TooltipTrigger>
          <TooltipContent>在 Tree 中定位</TooltipContent>
        </Tooltip>
        <Tooltip v-if="message.sessionEntryId">
          <TooltipTrigger as-child>
            <BaseIconButton label="创建分支会话" size="small" @click="forkFromMessage">
              <GitFork :size="14" />
            </BaseIconButton>
          </TooltipTrigger>
          <TooltipContent>创建分支会话</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <BaseIconButton
              :label="isCopied ? '已复制' : '复制消息'"
              size="small"
              @click="copyMessageText"
            >
              <Check v-if="isCopied" :size="14" />
              <Copy v-else :size="14" />
            </BaseIconButton>
          </TooltipTrigger>
          <TooltipContent>{{ isCopied ? '已复制' : '复制消息' }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span class="message__time">{{ formattedTime }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.message {
  display: flex;
  flex-direction: column;
  width: 100%;

  &__actions {
    display: flex;
    flex-direction: row;
    gap: var(--space-2);
  }
}

.assistant-message {
  width: 100%;
  color: var(--color-text);
  font-size: var(--font-size-ui);
  line-height: 1.6;
}

.message__actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) 0;
  opacity: 0;
  margin-top: var(--space-1);
  transition: opacity var(--duration-fast) var(--ease-standard);

  .message:hover & {
    opacity: 1;
  }
}

.message__time {
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
}
</style>
