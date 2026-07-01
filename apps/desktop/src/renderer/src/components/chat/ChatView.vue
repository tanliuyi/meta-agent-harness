<script setup lang="ts">
/**
 * ChatView.vue - 当前活跃会话的消息流与输入区组件。
 */

import { computed } from 'vue'
import { BaseButton } from '@renderer/components/base'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { ThreadMessage } from '../../../../shared/coding-agent/types'

const workspaceSession = useWorkspaceSessionStore()

/** 当前会话的消息列表。 */
const messages = computed(() => workspaceSession.activeSnapshot?.messages ?? [])

/** 当前会话是否正在执行。 */
const isRunning = computed(() =>
  ['queued', 'starting', 'running', 'stopping'].includes(workspaceSession.activeSession?.status ?? '')
)

/** 是否允许发送消息。 */
const canSend = computed(() =>
  Boolean(workspaceSession.activeSessionId && workspaceSession.draftMessage.trim() && !isRunning.value)
)

/** 当前输入框状态提示。 */
const composerHint = computed(() => {
  if (!workspaceSession.activeSessionId) {
    return '先选择或创建一个 thread'
  }
  if (isRunning.value) {
    return 'Agent 正在处理，必要时可以中止'
  }
  return 'Ctrl + Enter 发送'
})

/**
 * 获取消息角色展示名。
 * @param role - 消息角色。
 * @returns 展示名。
 */
function getRoleLabel(role: ThreadMessage['role']): string {
  switch (role) {
    case 'user':
      return '你'
    case 'assistant':
      return 'Agent'
    case 'tool':
      return '工具'
    case 'system':
      return '系统'
  }
}

/**
 * 格式化消息时间。
 * @param value - ISO 时间。
 * @returns 本地时间。
 */
function formatMessageTime(value: string | undefined): string {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
</script>

<template>
  <section class="chat-view">
    <header v-if="workspaceSession.activeSession" class="chat-view__header">
      <div>
        <span class="chat-view__eyebrow">当前对话</span>
        <strong>{{ workspaceSession.activeSession.title || '未命名 Thread' }}</strong>
      </div>
      <span class="chat-view__status" :data-running="isRunning">
        {{ workspaceSession.activeSession.status }}
      </span>
    </header>

    <div class="chat-view__timeline">
      <div v-if="!workspaceSession.activeSession" class="chat-view__empty">
        <strong>选择一个 Project</strong>
        <span>创建或打开 thread 后，消息会在这里连续呈现。</span>
      </div>

      <article
        v-for="message in messages"
        :key="message.id"
        class="message"
        :data-role="message.role"
      >
        <header>
          <span>{{ getRoleLabel(message.role) }}</span>
          <time v-if="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time>
        </header>
        <p v-if="message.text">{{ message.text }}</p>
        <p v-else class="message__placeholder">正在生成回复...</p>
      </article>

      <div v-if="workspaceSession.activeSession && messages.length === 0" class="chat-view__empty">
        <strong>还没有消息</strong>
        <span>输入一个任务，Agent 会把上下文和执行过程收敛到对话里。</span>
      </div>

      <div v-if="isRunning" class="chat-view__activity" aria-live="polite">
        <span />
        <span>Agent 正在工作</span>
      </div>
    </div>

    <form class="composer" @submit.prevent="workspaceSession.sendPrompt">
      <textarea
        v-model="workspaceSession.draftMessage"
        :disabled="!workspaceSession.activeSessionId || isRunning"
        placeholder="描述你想让 Agent 完成的事"
        rows="3"
        @keydown.ctrl.enter.prevent="workspaceSession.sendPrompt"
      />
      <div class="composer__actions">
        <span>{{ composerHint }}</span>
        <BaseButton
          type="button"
          variant="ghost"
          :disabled="!workspaceSession.activeSessionId || !isRunning"
          @click="workspaceSession.abortActive"
        >
          中止
        </BaseButton>
        <BaseButton type="submit" :disabled="!canSend">发送</BaseButton>
      </div>
    </form>
  </section>
</template>

<style lang="scss" scoped>
.chat-view {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding: 0 var(--space-3) var(--space-3);
}

.chat-view__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3) var(--space-1) 0;

  div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  strong {
    overflow: hidden;
    color: var(--color-text);
    font-size: 14px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.chat-view__eyebrow,
.chat-view__status {
  color: var(--color-text-subtle);
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
}

.chat-view__status {
  flex: 0 0 auto;
  padding: 3px var(--space-2);
  color: var(--color-text-muted);
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: 999px;

  &[data-running='true'] {
    color: var(--color-primary-strong);
    border-color: color-mix(in srgb, var(--color-primary) 52%, transparent);
  }
}

.chat-view__timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  min-height: 0;
  padding: var(--space-3) var(--space-1);
  overflow-y: auto;
}

.chat-view__empty {
  display: grid;
  place-content: center;
  gap: var(--space-1);
  min-height: 100%;
  color: var(--color-text-muted);
  text-align: center;

  strong {
    color: var(--color-text);
    font-size: 14px;
  }
}

.message {
  display: grid;
  gap: var(--space-1);
  width: min(760px, 100%);
  padding: var(--space-4);
  background: color-mix(in srgb, var(--color-surface-raised) 86%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-border) 74%, transparent);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);

  &[data-role='user'] {
    align-self: flex-end;
    width: min(640px, 88%);
    background: color-mix(in srgb, var(--color-primary) 18%, var(--color-surface-raised));
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
  }

  &[data-role='tool'],
  &[data-role='system'] {
    width: min(680px, 100%);
    background: var(--color-control-track);
    box-shadow: none;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  p {
    margin: 0;
    color: var(--color-text);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.message__placeholder {
  color: var(--color-text-muted);
}

.chat-view__activity {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted);
  font-size: 12px;
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: 999px;

  span:first-child {
    width: 6px;
    height: 6px;
    background: var(--color-primary);
    border-radius: 50%;
    animation: pulse 1.1s var(--ease-standard) infinite;
  }
}

.composer {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);

  textarea {
    width: 100%;
    min-width: 0;
    min-height: 76px;
    resize: vertical;
    color: var(--color-text);
    font: inherit;
    background: transparent;
    border: 0;
    outline: none;
  }

  textarea::placeholder {
    color: var(--color-text-subtle);
  }

  textarea:disabled {
    cursor: not-allowed;
    opacity: 0.72;
  }
}

.composer__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);

  span {
    margin-right: auto;
    color: var(--color-text-subtle);
    font-size: 12px;
  }
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
</style>
