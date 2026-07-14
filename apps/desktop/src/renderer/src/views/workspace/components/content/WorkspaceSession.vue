<script setup lang="ts">
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { createElectronSubscribeConnectionAdapter } from '@/lib/electron-agent-connection'
import { Chat, ChatInput, ChatMessage, ChatMessages, TextPart } from '@tanstack/ai-vue-ui'

const props = defineProps<{
  sessionId: string
}>()

const connection = createElectronSubscribeConnectionAdapter({ threadId: props.sessionId })
</script>

<template>
  <Chat class="workspace-session" :connection="connection" :thread-id="sessionId" live>
    <ScrollArea style="flex: 1; min-height: 0">
      <ChatMessages class="workspace-session__messages">
        <template #default="{ message }">
          <ChatMessage
            class="workspace-session__message"
            user-class="workspace-session__message--user"
            assistant-class="workspace-session__message--assistant"
            :message="message"
          >
            <template #text="{ content }">
              <TextPart class="workspace-session__text" :content="content" :role="message.role" />
            </template>
          </ChatMessage>
        </template>
      </ChatMessages>
    </ScrollArea>
    <ChatInput />
  </Chat>
</template>

<style lang="scss" scoped>
.workspace-session {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-canvas);

  :deep(.workspace-session__messages) {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-4);
    min-height: 0;
    width: 100%;
    max-width: 768px;
    margin: 0 auto;
  }

  &__message {
    width: min(100%, 840px);
    min-width: 0;
    color: var(--color-text);
    font-size: var(--font-size-ui);
    line-height: var(--markdown-line-height);
  }

  &__message--user {
    align-self: flex-end;
    max-width: min(76%, 720px);
    padding: var(--space-3) var(--space-4);
    background: var(--user-message-bg);
    border: 1px solid var(--user-message-border);
    border-radius: var(--radius-lg);
  }

  &__message--assistant {
    align-self: flex-start;
  }

  &__text {
    min-width: 0;
  }

  :deep([data-message-role='system']) {
    align-self: center;
    max-width: min(100%, 720px);
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-sm);
    line-height: 1.6;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
  }

  :deep([data-message-role='tool']),
  :deep([data-part-type='tool-call']),
  :deep([data-part-type='tool-result']) {
    max-width: min(100%, 840px);
    padding: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-sm);
    line-height: 1.6;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
  }

  :deep([data-tool-header]) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--color-text);
  }

  :deep([data-tool-state-badge]) {
    padding: 2px var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-2xs);
    line-height: 1.4;
    background: var(--color-control-track);
    border-radius: var(--radius-sm);
  }

  :deep(pre) {
    max-width: 100%;
    margin: var(--space-2) 0 0;
    padding: var(--space-3);
    overflow-x: auto;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-code);
    line-height: var(--markdown-code-line-height);
    background: var(--color-code-bg);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
  }
}
</style>
