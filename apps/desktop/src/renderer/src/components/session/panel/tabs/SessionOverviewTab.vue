<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  BaseButton,
  BaseDropdownMenu,
  BaseIconButton,
  BaseSegmentedControl
} from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import { getFileName } from '../shared/utils'
import { onOffOptions, type OnOffValue } from '../model/types'
import { createSessionActionMenuSections, formatRetryDelay } from './display/sessionOverviewDisplay'
import type { BaseDropdownMenuSection } from '@renderer/components/base/BaseDropdownMenu.vue'

const workspaceProject = useWorkspaceProjectStore()
const workspaceSession = useWorkspaceSessionStore()

const sessionPathDraft = ref('')
const isSessionPathDialogOpen = ref(false)
const isNewSessionDialogOpen = ref(false)
const isSessionPathCopied = ref(false)
let sessionPathCopyTimeout: ReturnType<typeof setTimeout> | undefined

const hasActiveThread = computed(() => Boolean(workspaceSession.activeSessionId))
const currentEntryId = computed(() => workspaceSession.activeSnapshot?.currentEntryId)
const sessionProject = computed(() => {
  const projectId = workspaceSession.activeSession?.projectId ?? workspaceSession.activeProjectId
  return projectId ? workspaceProject.projects[projectId] : undefined
})
const sessionTreeEntryCount = computed(
  () => workspaceSession.activeSnapshot?.sessionTree?.length ?? 0
)
const activeLineage = computed(
  () => workspaceSession.activeSnapshot?.lineage ?? workspaceSession.activeSession?.lineage
)
const activeSessionFile = computed(() => workspaceSession.activeSnapshot?.sessionFile)
const activeSessionFileName = computed(() =>
  activeSessionFile.value ? getFileName(activeSessionFile.value) : '-'
)
const autoCompactionValue = computed<OnOffValue | undefined>(() => {
  const enabled = workspaceSession.activeSnapshot?.autoCompactionEnabled
  return enabled === undefined ? undefined : enabled ? 'on' : 'off'
})
const autoRetryValue = computed<OnOffValue>(() =>
  workspaceSession.activeSnapshot?.autoRetryEnabled === false ? 'off' : 'on'
)
const sessionActionMenuSections = computed<BaseDropdownMenuSection[]>(() =>
  createSessionActionMenuSections({
    hasActiveThread: hasActiveThread.value,
    hasCurrentEntry: Boolean(currentEntryId.value),
    hasPreviousSession: Boolean(workspaceSession.activePreviousSessionFile),
    hasPreviousLeaf: Boolean(workspaceSession.activePreviousLeafEntryId),
    canOpenParentSession: Boolean(
      activeLineage.value &&
      !activeLineage.value.parentSessionMissing &&
      !activeLineage.value.unavailable
    )
  })
)

onBeforeUnmount(() => {
  if (sessionPathCopyTimeout) {
    clearTimeout(sessionPathCopyTimeout)
  }
})

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

async function copyActiveSessionPath(): Promise<void> {
  if (!activeSessionFile.value) {
    return
  }
  await navigator.clipboard.writeText(activeSessionFile.value)
  isSessionPathCopied.value = true
  if (sessionPathCopyTimeout) {
    clearTimeout(sessionPathCopyTimeout)
  }
  sessionPathCopyTimeout = setTimeout(() => {
    isSessionPathCopied.value = false
  }, 1200)
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
    case 'reload':
      await workspaceSession.reloadSessionResources()
      break
    case 'compact':
      await workspaceSession.compactActive()
      break
    case 'previous-session':
      await workspaceSession.switchActivePreviousSession()
      break
    case 'open-parent':
      await workspaceSession.openParentSession()
      break
    case 'previous-leaf':
      await workspaceSession.navigateBackToPreviousLeaf()
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
  <section class="session-section session-section--scrollable" role="tabpanel">
    <header class="session-section__header">
      <h3>Session</h3>
      <BaseDropdownMenu
        :sections="sessionActionMenuSections"
        @select="(item) => runSessionAction(item.id)"
      >
        <BaseIconButton
          class="session-section__menu"
          label="会话操作"
          size="small"
          :disabled="!hasActiveThread"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 6.5 7.5 10 4 13.5" />
            <path d="M9 14h6" />
          </svg>
        </BaseIconButton>
      </BaseDropdownMenu>
    </header>
    <ScrollArea class="session-section__content-scroll" :vertical-size="7">
      <div class="session-section__content">
        <div class="session-overview">
          <div class="session-overview__topline">
            <div class="session-overview__project">
              <span>Project</span>
              <strong>{{ sessionProject?.name ?? '-' }}</strong>
            </div>
          </div>

          <div class="session-overview__path">
            <div>
              <span>Session</span>
              <strong :title="activeSessionFile ?? undefined">{{ activeSessionFileName }}</strong>
            </div>
            <BaseIconButton
              class="session-overview__copy"
              :class="{ 'is-copied': isSessionPathCopied }"
              label="复制会话路径"
              size="small"
              :disabled="!activeSessionFile"
              @click="copyActiveSessionPath"
            >
              <svg
                v-if="isSessionPathCopied"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m4.5 10.5 3.3 3.2 7.7-8.2" />
              </svg>
              <svg
                v-else
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="7" y="4" width="8" height="10" rx="1.5" />
                <path d="M5 7v7.5A1.5 1.5 0 0 0 6.5 16H12" />
              </svg>
            </BaseIconButton>
          </div>

          <div class="session-overview__metrics">
            <div>
              <span>Entries</span>
              <strong>{{ sessionTreeEntryCount }}</strong>
            </div>
            <div>
              <span>Leaf</span>
              <strong>{{ currentEntryId ?? '-' }}</strong>
            </div>
          </div>
        </div>

        <div v-if="workspaceSession.activeSessionActionDetails" class="session-command-details">
          <strong>{{ workspaceSession.activeSessionActionDetails.title }}</strong>
          <pre>{{ workspaceSession.activeSessionActionDetails.body }}</pre>
        </div>
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

        <Collapsible v-slot="{ open }" class="runtime-advanced">
          <CollapsibleTrigger class="runtime-advanced__trigger">
            <span>高级</span>
            <svg
              class="runtime-advanced__chevron"
              :class="{ 'is-open': open }"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m7.5 5 5 5-5 5" />
            </svg>
          </CollapsibleTrigger>

          <CollapsibleContent class="runtime-advanced__content">
            <div class="runtime-control-list">
              <div
                class="runtime-toggle-row"
                :class="{ 'is-disabled': !hasActiveThread || autoCompactionValue === undefined }"
              >
                <div>
                  <span>Auto compact</span>
                  <small>上下文接近上限时自动压缩</small>
                </div>
                <BaseSegmentedControl
                  v-if="autoCompactionValue !== undefined"
                  label="Auto compact"
                  size="small"
                  :model-value="autoCompactionValue"
                  :options="onOffOptions"
                  @update:model-value="setAutoCompactionValue"
                />
                <span v-else>{{ hasActiveThread ? 'Unknown' : '-' }}</span>
              </div>
              <div class="runtime-toggle-row" :class="{ 'is-disabled': !hasActiveThread }">
                <div>
                  <span>Auto retry</span>
                  <small>Provider 短暂失败时自动重试</small>
                </div>
                <BaseSegmentedControl
                  label="Auto retry"
                  size="small"
                  :model-value="autoRetryValue"
                  :options="onOffOptions"
                  @update:model-value="setAutoRetryValue"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

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
      </div>
    </ScrollArea>

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
  </section>
</template>
