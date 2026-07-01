<script setup lang="ts">
/**
 * ChatView.vue - 当前活跃会话的消息流与输入区组件。
 */

import { computed } from 'vue'
import { BaseButton } from '@renderer/components/base'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'

const workspaceSession = useWorkspaceSessionStore()

/** 当前会话的消息列表。 */
const messages = computed(() => workspaceSession.activeSnapshot?.messages ?? [])

/** 是否允许发送消息。 */
const canSend = computed(() =>
  Boolean(workspaceSession.activeSessionId && workspaceSession.draftMessage.trim())
)
</script>

<template>
  <section class="chat-view">
    <div class="chat-view__timeline">
      <div v-if="!workspaceSession.activeSession" class="chat-view__empty">
        <strong>选择工作目录</strong>
        <span>创建 thread 后开始。</span>
      </div>

      <article
        v-for="message in messages"
        :key="message.id"
        class="message"
        :data-role="message.role"
      >
        <header>
          <span>{{ message.role }}</span>
          <time v-if="message.createdAt">{{ message.createdAt }}</time>
        </header>
        <p>{{ message.text }}</p>
      </article>

      <article
        v-for="event in workspaceSession.events.slice(0, 12)"
        :key="JSON.stringify(event)"
        class="event-row"
      >
        <span>{{ event.type }}</span>
        <code>{{ event.threadId }}</code>
      </article>
    </div>

    <form class="composer" @submit.prevent="workspaceSession.sendPrompt">
      <textarea
        v-model="workspaceSession.draftMessage"
        :disabled="!workspaceSession.activeSessionId"
        placeholder="Ask the agent"
        rows="3"
        @keydown.ctrl.enter.prevent="workspaceSession.sendPrompt"
      />
      <div class="composer__actions">
        <BaseButton
          type="button"
          variant="ghost"
          :disabled="!workspaceSession.activeSessionId"
          @click="workspaceSession.abortActive"
        >
          Abort
        </BaseButton>
        <BaseButton type="submit" :disabled="!canSend">Send</BaseButton>
      </div>
    </form>
  </section>
</template>

<style lang="scss" scoped>
.chat-view {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding: 0 var(--space-3) var(--space-3);
}

.chat-view__timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  min-height: 0;
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
    font-size: 13px;
  }
}

.message,
.event-row {
  width: min(760px, 100%);
  padding: var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.message {
  &[data-role='user'] {
    align-self: flex-end;
  }

  header {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
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
  }
}

.event-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.composer {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);

  textarea {
    width: 100%;
    min-width: 0;
    resize: vertical;
    color: var(--color-text);
    font: inherit;
    background: transparent;
    border: 0;
    outline: none;
  }
}

.composer__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
