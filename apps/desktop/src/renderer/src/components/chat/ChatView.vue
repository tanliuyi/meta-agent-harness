<script setup lang="ts">
/**
 * ChatView.vue - 当前活跃会话的消息流与输入区组件。
 */

import type { JSONContent } from '@tiptap/vue-3'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Composer from './Composer.vue'
import AssistantMessage from './messages/AssistantMessage.vue'
import SystemMessage from './messages/SystemMessage.vue'
import ToolMessage from './messages/ToolMessage.vue'
import UserMessage from './messages/UserMessage.vue'
import { getMessageRawRecord } from './messages/message-format'
import { toRenderableMessage, type RenderableThreadMessage } from './messages/renderable-message'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { DesktopToolCall } from '../../../../../../../packages/coding-agent/src/desktop/protocol/tool.ts'
import ScrollArea from '../ui/scroll-area/ScrollArea.vue'

const workspaceSession = useWorkspaceSessionStore()

/** 空白 Tiptap 文档。 */
const emptyComposerContent: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph'
    }
  ]
}

/** Composer 的结构化草稿。 */
const composerContent = ref<JSONContent>(emptyComposerContent)

type TimelineScrollBehavior = 'auto' | 'smooth'
type ScrollAreaInstance = InstanceType<typeof ScrollArea>

/** 当前会话的渲染消息列表。 */
const messages = computed<RenderableThreadMessage[]>(() => {
  const snapshotMessages = workspaceSession.activeSnapshot?.messages ?? []
  const threadId = workspaceSession.activeSnapshot?.threadId
  return snapshotMessages.map((message) => {
    const state = threadId
      ? workspaceSession.getMessageRenderState(threadId, message.id)
      : { revision: 1, renderState: 'complete' as const }
    return toRenderableMessage(message, state)
  })
})

/** 当前会话的工具调用列表。 */
const toolCalls = computed(() => workspaceSession.activeSnapshot?.toolCalls ?? [])

/** 消息滚动容器。 */
const timelineRef = ref<ScrollAreaInstance | null>(null)

/** 是否接近消息底部。 */
const isNearBottom = ref(true)

/** 当前会话是否正在执行。 */
const isRunning = computed(() =>
  ['queued', 'starting', 'running', 'stopping'].includes(
    workspaceSession.activeSession?.status ?? ''
  )
)

/** 是否允许发送消息。 */
const canSend = computed(() =>
  Boolean(
    workspaceSession.activeSessionId && workspaceSession.draftMessage.trim() && !isRunning.value
  )
)

/**
 * 获取消息 role 对应组件。
 * @param role - 消息角色。
 * @returns Vue component。
 */
function getMessageComponent(
  role: RenderableThreadMessage['role']
): typeof UserMessage | typeof AssistantMessage | typeof SystemMessage | typeof ToolMessage {
  switch (role) {
    case 'user':
      return UserMessage
    case 'assistant':
      return AssistantMessage
    case 'tool':
      return ToolMessage
    case 'system':
      return SystemMessage
  }
}

/**
 * 获取消息关联的工具调用投影。
 * @param message - Thread message。
 * @returns 工具调用投影。
 */
function getMessageToolCall(message: RenderableThreadMessage): DesktopToolCall | undefined {
  const raw = getMessageRawRecord(message)
  if (typeof raw.toolCallId !== 'string') {
    return undefined
  }
  return toolCalls.value.find((toolCall) => toolCall.toolCallId === raw.toolCallId)
}

/**
 * 更新底部距离状态。
 */
function updateScrollState(): void {
  const metrics = timelineRef.value?.getScrollMetrics()
  if (!metrics) {
    isNearBottom.value = true
    return
  }

  const distanceToBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
  isNearBottom.value = distanceToBottom < 96
}

/**
 * 滚动到最新消息。
 * @param behavior - 滚动行为。
 */
function scrollToLatest(behavior: TimelineScrollBehavior = 'smooth'): void {
  timelineRef.value?.scrollBottom(behavior)
}

/** 滚动更新 rAF 句柄。 */
let scrollRafId: number | null = null
let pendingScrollBehavior: TimelineScrollBehavior = 'smooth'

/**
 * 合并滚动更新到下一帧，每帧最多执行一次。
 * @param behavior - 滚动行为。
 */
function scheduleScrollToLatest(behavior: TimelineScrollBehavior = 'smooth'): void {
  pendingScrollBehavior = behavior
  if (scrollRafId !== null) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null
    scrollToLatest(pendingScrollBehavior)
  })
}

/**
 * 同步 Composer 纯文本到当前发送草稿。
 * @param value - 编辑器纯文本。
 */
function syncDraftText(value: string): void {
  workspaceSession.draftMessage = value
}

/**
 * 发送当前 Composer 草稿。
 */
async function sendComposerPrompt(): Promise<void> {
  await workspaceSession.sendPrompt()

  if (!workspaceSession.draftMessage.trim()) {
    composerContent.value = emptyComposerContent
  }
}

watch(
  () => [
    workspaceSession.activeSessionId,
    messages.value.length,
    messages.value.at(-1)?.id,
    messages.value.at(-1)?.revision,
    isRunning.value
  ],
  async ([sessionId], [previousSessionId]) => {
    const isSessionChanged = sessionId !== previousSessionId
    const shouldFollow = isSessionChanged || isNearBottom.value || isRunning.value
    await nextTick()

    if (shouldFollow) {
      scheduleScrollToLatest(isSessionChanged ? 'auto' : 'smooth')
    } else {
      updateScrollState()
    }
  },
  { flush: 'post' }
)

onMounted(async () => {
  await nextTick()
  scheduleScrollToLatest('auto')
  updateScrollState()
})
</script>

<template>
  <div class="chat-view">
    <ScrollArea
      ref="timelineRef"
      class="chat-view__timeline"
      :class="{ 'chat-view__timeline--empty': !messages.length }"
      @scroll="updateScrollState"
    >
      <div class="chat-view__timeline-inner">
        <div v-if="!workspaceSession.activeSession" class="chat-view__empty">
          <strong>选择一个 Thread</strong>
          <span>打开或创建会话后，消息、工具调用和执行状态会在这里连续呈现。</span>
        </div>

        <div
          v-for="message in messages"
          :key="message.id"
          class="chat-view__message"
          :class="`chat-view__message--${message.role}`"
        >
          <component
            :is="getMessageComponent(message.role)"
            v-memo="[message.id, message.revision]"
            :message="message"
            :tool-call="message.role === 'tool' ? getMessageToolCall(message) : undefined"
          />
        </div>

        <div
          v-if="workspaceSession.activeSession && messages.length === 0"
          class="chat-view__empty"
        >
          <strong>还没有消息</strong>
          <span>输入一个任务，Agent 会把思路、文件变更和工具结果沉淀成可回看的上下文。</span>
        </div>

        <div v-if="isRunning" class="chat-view__activity" aria-live="polite">
          <span />
          <span>Agent 正在工作</span>
        </div>
      </div>
    </ScrollArea>

    <button
      v-if="workspaceSession.activeSession && messages.length > 0 && !isNearBottom"
      type="button"
      class="chat-view__jump"
      @click="scrollToLatest()"
    >
      回到最新
    </button>

    <Composer
      v-model="composerContent"
      :disabled="!workspaceSession.activeSessionId || isRunning"
      :is-running="isRunning"
      :can-send="canSend"
      class="chat-view__composer"
      placeholder="描述你想让 Agent 完成的事"
      @text-change="syncDraftText"
      @submit="sendComposerPrompt"
      @abort="workspaceSession.abortActive"
    />
  </div>
</template>

<style lang="scss" scoped>
.chat-view {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.chat-view__timeline {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  scroll-behavior: smooth;
  scroll-padding: var(--space-8);
}

.chat-view__timeline-inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 768px;
  min-height: 100%;
  margin: 0 auto;
  padding: var(--space-6) 0 var(--space-8);
}

.chat-view__timeline--empty {
  &::before,
  &::after {
    display: none;
  }

  .chat-view__timeline-inner {
    padding: var(--space-8) var(--space-3);
  }
}

.chat-view__message {
  display: flex;
  min-width: 0;
  animation: message-in var(--duration-base) var(--ease-standard);
}

.chat-view__message--user {
  justify-content: flex-end;
}

.chat-view__message--assistant,
.chat-view__message--system,
.chat-view__message--tool {
  justify-content: flex-start;
}

.chat-view__empty {
  display: grid;
  place-content: center;
  gap: var(--space-2);
  align-self: center;
  width: min(420px, 100%);
  min-height: 100%;
  color: var(--color-text-muted);
  text-align: center;

  strong {
    color: var(--color-text);
    font-size: 15px;
    font-weight: 680;
  }

  span {
    font-size: 12px;
    line-height: 1.6;
  }
}

.chat-view__activity {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  margin-top: var(--space-1);
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-size: 12px;
  background: color-mix(in srgb, var(--color-control-track) 86%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 24%, var(--color-border));
  border-radius: 999px;
  box-shadow: var(--shadow-sm);

  span:first-child {
    width: 6px;
    height: 6px;
    background: var(--color-primary);
    border-radius: 50%;
    animation: pulse 1.1s var(--ease-standard) infinite;
  }
}

.chat-view__jump {
  position: absolute;
  left: 50%;
  bottom: calc(128px + var(--space-8));
  z-index: 4;
  padding: 6px var(--space-3);
  color: var(--color-primary-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  background: var(--color-primary);
  border: 1px solid var(--color-primary);
  border-radius: 999px;
  box-shadow: var(--shadow-md);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-primary-strong);
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus), var(--shadow-md);
  }
}

.chat-view__composer {
  width: 100%;
  max-width: 768px;
  margin: 0 auto 24px;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (width <= 720px) {
  .chat-view {
    padding: 0 var(--space-3) var(--space-3);
  }

  .chat-view__timeline {
    padding-inline: 0;
  }

  .chat-view__jump {
    right: var(--space-5);
  }
}
</style>
