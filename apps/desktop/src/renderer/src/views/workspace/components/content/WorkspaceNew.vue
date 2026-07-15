<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { FolderKanban, Sparkles } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { Chat, ChatInput } from '@/components/ai-vue-ui'
import { createElectronNewThreadConnectionAdapter } from '@/lib/electron-agent-connection'
import useModelSettingsStore from '@/stores/model-settings'
import useWorkspaceProjectStore from '@/stores/workspace-project'
import useWorkspaceSessionStore from '@/stores/workspace-session'
import type { ThinkingLevel } from '@shared/coding-agent/types'

const route = useRoute()
const router = useRouter()
const workspaceSession = useWorkspaceSessionStore()
const workspaceProject = useWorkspaceProjectStore()
const modelSettings = useModelSettingsStore()
const errorMessage = ref<string>()

const projectId = computed(() => {
  const value = route.query.projectId
  return typeof value === 'string' && value.trim() ? value : undefined
})

const projectOptions = computed(() =>
  workspaceProject.projectList.map((project) => ({
    projectId: project.projectId,
    name: project.name,
    disabled: project.status !== 'available'
  }))
)

const modelOptions = computed(() =>
  modelSettings.models
    .filter((model) => model.status === 'available')
    .map((model) => ({
      provider: model.provider,
      id: model.id,
      displayName: model.displayName
    }))
)
const selectedModel = computed(() => {
  const selected = workspaceSession.orphanModel
  if (selected) return { provider: selected.provider, id: selected.modelId }
  const settings = modelSettings.snapshot?.settings
  if (settings?.defaultProvider && settings.defaultModel) {
    return { provider: settings.defaultProvider, id: settings.defaultModel }
  }
  return undefined
})
const selectedThinkingLevel = computed<ThinkingLevel>(
  () =>
    workspaceSession.orphanThinkingLevel ??
    modelSettings.snapshot?.settings.defaultThinkingLevel ??
    'medium'
)

const connection = computed(() => {
  const targetProjectId = projectId.value

  return createElectronNewThreadConnectionAdapter({
    createThread: async () => {
      if (!targetProjectId) throw new Error('请先选择 Project')
      const model = selectedModel.value
      const thread = await workspaceSession.createThread(
        targetProjectId,
        workspaceSession.defaultSessionContextId,
        {
          ...(model ? { initialModel: { provider: model.provider, modelId: model.id } } : {}),
          thinkingLevel: selectedThinkingLevel.value
        }
      )
      if (!thread) {
        throw new Error(workspaceSession.errorMessage ?? '创建新会话失败')
      }
      return thread
    },
    onThreadCreated: (threadId) => {
      void router.replace({ name: 'WorkspaceSession', params: { sessionId: threadId } })
    }
  })
})

onMounted(() => {
  if (workspaceProject.projectList.length === 0 && !workspaceProject.loading) {
    void workspaceProject.loadProjects()
  }
  if (!modelSettings.snapshot && !modelSettings.loading) void modelSettings.load()
})

watch(
  projectId,
  (value) => {
    errorMessage.value = undefined
    if (value) workspaceSession.startNewSession(value)
  },
  { immediate: true }
)

function handleError(error: Error): void {
  errorMessage.value = error.message
}

function handleSelectProject(nextProjectId: string): void {
  errorMessage.value = undefined
  void router.replace({ name: 'WorkspaceNew', query: { projectId: nextProjectId } })
}

function handleSelectModel(provider: string, modelId: string): void {
  void workspaceSession.setActiveModel(provider, modelId)
}

function handleSelectThinkingLevel(level: ThinkingLevel): void {
  void workspaceSession.setActiveThinkingLevel(level)
}
</script>

<template>
  <Chat
    :id="`workspace-new:${projectId ?? 'unselected'}`"
    :key="projectId ?? 'unselected'"
    class="workspace-session workspace-session--new"
    :connection="connection"
    :thread-id="`new:${projectId ?? 'unselected'}`"
    live
    @error="handleError"
  >
    <div class="workspace-session__new-body">
      <p v-if="errorMessage" class="workspace-session__error" role="alert">
        {{ errorMessage }}
      </p>
      <section
        v-else-if="!projectId"
        class="workspace-session__hint"
        aria-labelledby="new-session-title"
      >
        <div class="workspace-session__hint-mark" aria-hidden="true">
          <FolderKanban :size="30" :stroke-width="1.7" />
          <Sparkles class="workspace-session__hint-spark" :size="15" :stroke-width="1.8" />
        </div>
        <p class="workspace-session__hint-kicker">New session</p>
        <h1 id="new-session-title" class="workspace-session__hint-title">从一个 Project 开始</h1>
        <p class="workspace-session__hint-copy">选择工作上下文，开始新的协作会话</p>
      </section>
    </div>
    <div class="workspace-session__composer">
      <ChatInput
        show-project-select
        :project-options="projectOptions"
        :selected-project-id="projectId"
        :loading-projects="workspaceProject.loading"
        :model-options="modelOptions"
        :selected-model="selectedModel"
        :loading-model-options="modelSettings.loading"
        :thinking-level="selectedThinkingLevel"
        :disabled="!projectId"
        :controls-disabled="!projectId"
        @select-project="handleSelectProject"
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
}

.workspace-session__new-body {
  display: grid;
  flex: 1;
  min-height: 0;
  place-items: center;
  padding: var(--space-6);
}

.workspace-session__hint {
  position: relative;
  display: flex;
  width: min(100%, 440px);
  flex-direction: column;
  align-items: center;
  color: var(--color-text-muted);
  text-align: center;
}

.workspace-session__hint::before,
.workspace-session__hint::after {
  position: absolute;
  top: 31px;
  width: clamp(52px, 16vw, 112px);
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--color-border-strong));
  content: '';
}

.workspace-session__hint::before {
  right: calc(50% + 48px);
}

.workspace-session__hint::after {
  left: calc(50% + 48px);
  transform: rotate(180deg);
}

.workspace-session__hint-mark {
  position: relative;
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  color: var(--color-primary-strong);
  background: var(--color-surface);
  border: 1px solid color-mix(in srgb, var(--color-primary) 32%, var(--color-border));
  border-radius: 8px;
  box-shadow:
    5px 5px 0 var(--color-primary-soft),
    5px 5px 0 1px var(--color-primary-outline);
}

.workspace-session__hint-mark::before {
  position: absolute;
  inset: 5px;
  border: 1px solid var(--color-border-muted);
  border-radius: 4px;
  content: '';
}

.workspace-session__hint-spark {
  position: absolute;
  top: 8px;
  right: 7px;
  color: var(--color-accent);
}

.workspace-session__hint-kicker {
  margin: var(--space-5) 0 0;
  color: var(--color-primary-strong);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  text-transform: uppercase;
}

.workspace-session__hint-title {
  margin: var(--space-2) 0 0;
  color: var(--color-text);
  font-size: 22px;
  font-weight: 650;
  line-height: 1.3;
}

.workspace-session__hint-copy {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  line-height: 1.6;
}

.workspace-session__error {
  max-width: 560px;
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-ui-sm);
  line-height: 1.6;
  text-align: center;
}

.workspace-session__composer {
  @include workspace-session-layout.composer;
}

@media (max-width: 720px) {
  .workspace-session__composer {
    @include workspace-session-layout.composer-narrow;
  }
}
</style>
