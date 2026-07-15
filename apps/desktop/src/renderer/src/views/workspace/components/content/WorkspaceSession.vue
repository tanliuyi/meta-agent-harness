<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { createElectronSubscribeConnectionAdapter } from '@/lib/electron-agent-connection'
import { Chat, ChatInput, ChatMessage, ChatMessages, TextPart } from '@/components/ai-vue-ui'
import { codingAgentApi } from '@/api/coding-agent'
import type { ModelInfo, ThinkingLevel, ThreadSnapshot } from '@shared/coding-agent/types'

const props = defineProps<{
  sessionId: string
}>()

const connection = createElectronSubscribeConnectionAdapter({ threadId: props.sessionId })
const snapshot = ref<ThreadSnapshot>()
const modelOptions = ref<ModelInfo[]>([])
const controlsLoading = ref(true)
const controlsError = ref<string>()
const selectedModel = computed(() =>
  snapshot.value?.model
    ? { provider: snapshot.value.model.provider, id: snapshot.value.model.id }
    : undefined
)
const thinkingLevel = computed<ThinkingLevel>(() => snapshot.value?.thinkingLevel ?? 'medium')

onMounted(() => void loadSessionControls())

async function loadSessionControls(): Promise<void> {
  controlsLoading.value = true
  controlsError.value = undefined
  try {
    const [nextSnapshot, nextModelOptions] = await Promise.all([
      codingAgentApi.getSnapshot(props.sessionId),
      codingAgentApi.listModels(props.sessionId)
    ])
    snapshot.value = nextSnapshot
    modelOptions.value = nextModelOptions
  } catch (error) {
    controlsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    controlsLoading.value = false
  }
}

async function handleSelectModel(provider: string, modelId: string): Promise<void> {
  controlsLoading.value = true
  controlsError.value = undefined
  try {
    await codingAgentApi.setModel({ threadId: props.sessionId, provider, modelId })
    snapshot.value = await codingAgentApi.getSnapshot(props.sessionId)
  } catch (error) {
    controlsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    controlsLoading.value = false
  }
}

async function handleSelectThinkingLevel(level: ThinkingLevel): Promise<void> {
  controlsLoading.value = true
  controlsError.value = undefined
  try {
    await codingAgentApi.setThinkingLevel({ threadId: props.sessionId, level })
    snapshot.value = await codingAgentApi.getSnapshot(props.sessionId)
  } catch (error) {
    controlsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    controlsLoading.value = false
  }
}
</script>

<template>
  <Chat class="workspace-session" :connection="connection" :thread-id="sessionId" live>
    <ChatMessages class="workspace-session__messages" :state-key="sessionId">
      <template #default="{ message }">
        <ChatMessage
          class="workspace-session__message"
          user-class="workspace-session__message--user"
          assistant-class="workspace-session__message--assistant"
          :message="message"
        >
          <template #text="{ content }">
            <div v-if="message.role === 'user'" class="workspace-session__user-text">
              {{ content }}
            </div>
            <TextPart v-else :content="content" :role="message.role" />
          </template>
        </ChatMessage>
      </template>
    </ChatMessages>
    <div class="workspace-session__composer">
      <p v-if="controlsError" class="workspace-session__control-error" role="alert">
        {{ controlsError }}
      </p>
      <ChatInput
        :model-options="modelOptions"
        :selected-model="selectedModel"
        :loading-model-options="controlsLoading"
        :thinking-level="thinkingLevel"
        :controls-disabled="controlsLoading"
        @select-model="handleSelectModel"
        @select-thinking-level="handleSelectThinkingLevel"
      />
    </div>
  </Chat>
</template>

<style lang="scss" scoped>
@use './workspace-session-layout' as workspace-session-layout;

.workspace-session {
  @include workspace-session-layout.root;

  :deep(.workspace-session__messages) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    width: 100%;
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
    inline-size: max-content;
    max-inline-size: min(640px, 88%);
    min-inline-size: 0;
    margin-left: auto;
    padding: var(--space-1) var(--space-2);
    color: var(--color-text);
    background: var(--user-message-bg);
    border: 1px solid var(--user-message-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    line-height: 1.6;
    overflow-wrap: break-word;
  }

  &__message--assistant {
    align-self: flex-start;
  }

  &__text {
    min-width: 0;
  }

  &__user-text {
    max-width: 100%;
    min-width: 0;
    white-space: pre-wrap;
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
}

.workspace-session__composer {
  @include workspace-session-layout.composer;
}

.workspace-session__control-error {
  margin: 0 0 var(--space-2);
  color: var(--color-danger);
  font-size: var(--font-size-ui-xs);
  line-height: 1.5;
}

@media (max-width: 720px) {
  .workspace-session__composer {
    @include workspace-session-layout.composer-narrow;
  }
}
</style>
