<script setup lang="ts">
import { computed, ref } from 'vue'
import { BaseButton, BaseDropdownMenu, BaseSegmentedControl } from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import { getFileName } from '../shared/utils'
import { onOffOptions, type OnOffValue } from '../model/types'
import {
  createSessionActionMenuSections,
  formatRetryDelay,
  getSessionLineageLabel,
  getSessionModelLabel
} from './display/sessionOverviewDisplay'
import type { BaseDropdownMenuSection } from '@renderer/components/base/BaseDropdownMenu.vue'

const workspaceProject = useWorkspaceProjectStore()
const workspaceSession = useWorkspaceSessionStore()

const sessionPathDraft = ref('')
const isSessionPathDialogOpen = ref(false)
const isNewSessionDialogOpen = ref(false)

const hasActiveThread = computed(() => Boolean(workspaceSession.activeSessionId))
const currentEntryId = computed(() => workspaceSession.activeSnapshot?.currentEntryId)
const sessionProject = computed(() => {
  const projectId = workspaceSession.activeSession?.projectId
  return projectId ? workspaceProject.projects[projectId] : undefined
})
const sessionTreeEntryCount = computed(
  () => workspaceSession.activeSnapshot?.sessionTree?.length ?? 0
)
const activeLineage = computed(
  () => workspaceSession.activeSnapshot?.lineage ?? workspaceSession.activeSession?.lineage
)
const activeLineageLabel = computed(() => getSessionLineageLabel(activeLineage.value))
const activeModelLabel = computed(() =>
  getSessionModelLabel(workspaceSession.activeSnapshot?.model)
)
const activeThinkingLabel = computed(() => workspaceSession.activeSnapshot?.thinkingLevel ?? '-')
const autoCompactionValue = computed<OnOffValue>(() =>
  workspaceSession.activeSnapshot?.autoCompactionEnabled === false ? 'off' : 'on'
)
const autoRetryValue = computed<OnOffValue>(() =>
  workspaceSession.activeSnapshot?.autoRetryEnabled === false ? 'off' : 'on'
)
const sessionActionMenuSections = computed<BaseDropdownMenuSection[]>((previous) =>
  createSessionActionMenuSections(hasActiveThread.value, Boolean(currentEntryId.value), previous)
)

async function switchSessionFromDraft(): Promise<void> {
  await workspaceSession.switchActiveSessionPath(sessionPathDraft.value)
  closeSessionPathDialog()
}

async function setAutoCompactionValue(value: OnOffValue): Promise<void> {
  await workspaceSession.setActiveAutoCompaction(value === 'on')
}

async function setAutoRetryValue(value: OnOffValue): Promise<void> {
  await workspaceSession.setActiveAutoRetry(value === 'on')
}

function openSessionPathDialog(): void {
  isSessionPathDialogOpen.value = true
}

function closeSessionPathDialog(): void {
  isSessionPathDialogOpen.value = false
}

function openNewSessionDialog(): void {
  isNewSessionDialogOpen.value = true
}

function closeNewSessionDialog(): void {
  isNewSessionDialogOpen.value = false
}

function handleNewSessionDialogOpenChange(open: boolean): void {
  isNewSessionDialogOpen.value = open
}

async function createNewSessionFromDialog(): Promise<void> {
  await workspaceSession.newActiveSession()
  closeNewSessionDialog()
}

function handleSessionPathDialogOpenChange(open: boolean): void {
  if (open) {
    isSessionPathDialogOpen.value = true
    return
  }
  closeSessionPathDialog()
}

async function runSessionAction(actionId: string): Promise<void> {
  switch (actionId) {
    case 'export':
      await workspaceSession.exportActiveSession()
      break
    case 'import':
      await workspaceSession.importActiveSessionFromPicker()
      break
    case 'switch':
      openSessionPathDialog()
      break
    case 'clone':
      await workspaceSession.cloneActiveSession()
      break
    case 'new':
      openNewSessionDialog()
      break
    case 'fork':
      if (currentEntryId.value) {
        await workspaceSession.forkActiveSession(currentEntryId.value)
      }
      break
  }
}
</script>

<template>
  <section class="session-section" role="tabpanel">
    <header class="session-section__header">
      <h3>Session</h3>
    </header>
    <dl>
      <div>
        <dt>Status</dt>
        <dd>{{ workspaceSession.activeSession?.status ?? 'new' }}</dd>
      </div>
      <div>
        <dt>Project</dt>
        <dd>{{ sessionProject?.name ?? '-' }}</dd>
      </div>
      <div>
        <dt>Session</dt>
        <dd>{{ workspaceSession.activeSnapshot?.sessionFile ?? '-' }}</dd>
      </div>
    </dl>
    <div class="session-browser-summary">
      <div>
        <span>Entries</span>
        <strong>{{ sessionTreeEntryCount }}</strong>
      </div>
      <div>
        <span>Leaf</span>
        <strong>{{ currentEntryId ?? '-' }}</strong>
      </div>
    </div>
    <div v-if="workspaceSession.activePreviousSessionFile" class="session-previous">
      <div>
        <span>Previous session</span>
        <strong>{{ getFileName(workspaceSession.activePreviousSessionFile) }}</strong>
      </div>
      <BaseButton size="sm" variant="ghost" @click="workspaceSession.switchActivePreviousSession()">
        Switch back
      </BaseButton>
    </div>
    <div v-if="activeLineageLabel" class="session-previous">
      <div>
        <span>Forked from</span>
        <strong>{{ activeLineageLabel }}</strong>
      </div>
      <BaseButton
        size="sm"
        variant="ghost"
        :disabled="activeLineage?.parentSessionMissing || activeLineage?.unavailable"
        @click="workspaceSession.openParentSession()"
      >
        打开来源对话
      </BaseButton>
    </div>
    <div v-if="workspaceSession.activePreviousLeafEntryId" class="session-previous">
      <div>
        <span>Previous leaf</span>
        <strong>{{ workspaceSession.activePreviousLeafEntryId }}</strong>
      </div>
      <BaseButton size="sm" variant="ghost" @click="workspaceSession.navigateBackToPreviousLeaf()">
        返回之前位置
      </BaseButton>
    </div>
    <div class="session-action-strip">
      <BaseButton
        size="sm"
        variant="secondary"
        :disabled="!hasActiveThread"
        @click="workspaceSession.compactActive()"
      >
        Compact
      </BaseButton>
      <BaseDropdownMenu
        :sections="sessionActionMenuSections"
        @select="(item) => runSessionAction(item.id)"
      >
        <BaseButton size="sm" variant="secondary" :disabled="!hasActiveThread">More</BaseButton>
      </BaseDropdownMenu>
    </div>
    <p v-if="workspaceSession.activeSessionActionMessage" class="session-action-message">
      {{ workspaceSession.activeSessionActionMessage }}
    </p>
    <div v-if="workspaceSession.activeExportResult" class="export-result">
      <div>
        <span>HTML export</span>
        <strong>{{ getFileName(workspaceSession.activeExportResult.path) }}</strong>
      </div>
      <div class="export-result__actions">
        <BaseButton size="sm" variant="primary" @click="workspaceSession.openActiveExport()">
          Open
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="workspaceSession.revealActiveExport()">
          Show
        </BaseButton>
      </div>
    </div>
  </section>

  <section class="session-section" role="tabpanel">
    <header class="session-section__header">
      <h3>Runtime</h3>
    </header>

    <div class="runtime-summary">
      <div>
        <span>Model</span>
        <strong>{{ activeModelLabel }}</strong>
      </div>
      <div>
        <span>Thinking</span>
        <strong>{{ activeThinkingLabel }}</strong>
      </div>
    </div>

    <div class="runtime-control-list">
      <BaseButton
        size="sm"
        variant="secondary"
        :disabled="!hasActiveThread"
        @click="workspaceSession.cycleActiveModel()"
      >
        Cycle model
      </BaseButton>
      <BaseButton
        size="sm"
        variant="secondary"
        :disabled="!hasActiveThread"
        @click="workspaceSession.cycleActiveThinkingLevel()"
      >
        Cycle thinking
      </BaseButton>
      <div class="runtime-toggle-row" :class="{ 'is-disabled': !hasActiveThread }">
        <div>
          <span>Auto compact</span>
          <small>上下文接近上限时自动压缩</small>
        </div>
        <BaseSegmentedControl
          label="Auto compact"
          :model-value="autoCompactionValue"
          :options="onOffOptions"
          @update:model-value="setAutoCompactionValue"
        />
      </div>
      <div class="runtime-toggle-row" :class="{ 'is-disabled': !hasActiveThread }">
        <div>
          <span>Auto retry</span>
          <small>Provider 短暂失败时自动重试</small>
        </div>
        <BaseSegmentedControl
          label="Auto retry"
          :model-value="autoRetryValue"
          :options="onOffOptions"
          @update:model-value="setAutoRetryValue"
        />
      </div>
    </div>

    <article v-if="workspaceSession.activeRetryState" class="retry-card">
      <div>
        <strong>
          Retry {{ workspaceSession.activeRetryState.attempt }} /
          {{ workspaceSession.activeRetryState.maxAttempts }}
        </strong>
        <span>
          {{ formatRetryDelay(workspaceSession.activeRetryState.delayMs) }} ·
          {{ workspaceSession.activeRetryState.errorMessage }}
        </span>
      </div>
      <BaseButton size="sm" variant="ghost" @click="workspaceSession.abortActiveRetry()">
        Abort retry
      </BaseButton>
    </article>
  </section>

  <Dialog :open="isSessionPathDialogOpen" @update:open="handleSessionPathDialogOpenChange">
    <DialogContent class="session-path-dialog">
      <form class="session-path-dialog__form" @submit.prevent="switchSessionFromDraft">
        <DialogHeader>
          <DialogTitle>切换 Session 文件</DialogTitle>
          <DialogDescription>切换到已有 Pi-compatible session JSONL 文件。</DialogDescription>
        </DialogHeader>

        <BaseField
          id="session-switch-path"
          v-model="sessionPathDraft"
          label="Session path"
          placeholder="/path/to/session.jsonl"
        />

        <DialogFooter>
          <BaseButton type="button" size="sm" variant="ghost" @click="closeSessionPathDialog">
            Cancel
          </BaseButton>
          <BaseButton
            type="submit"
            size="sm"
            variant="primary"
            :disabled="!hasActiveThread || !sessionPathDraft.trim()"
          >
            Switch
          </BaseButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <Dialog :open="isNewSessionDialogOpen" @update:open="handleNewSessionDialogOpenChange">
    <DialogContent class="session-confirm-dialog">
      <DialogHeader>
        <DialogTitle>创建新的 Session</DialogTitle>
        <DialogDescription>
          在当前 thread 内创建一个新的空 Pi session 文件，并切换当前对话视图。
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <BaseButton type="button" size="sm" variant="ghost" @click="closeNewSessionDialog">
          Cancel
        </BaseButton>
        <BaseButton
          type="button"
          size="sm"
          variant="primary"
          :disabled="!hasActiveThread"
          @click="createNewSessionFromDialog"
        >
          Create
        </BaseButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
