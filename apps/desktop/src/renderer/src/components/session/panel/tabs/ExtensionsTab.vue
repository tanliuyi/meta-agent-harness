<script setup lang="ts">
import { computed, ref } from 'vue'
import { BaseButton } from '@renderer/components/base'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { ExtensionUiRequest } from '@shared/coding-agent/types'
import {
  getExtensionInitialDraft,
  getExtensionRequestDescription,
  getExtensionRequestTitle
} from './display/extensionDisplay'

const workspaceSession = useWorkspaceSessionStore()
const extensionDrafts = ref<Record<string, string>>({})
const activeExtensionRequestId = ref<string>()
const isExtensionRequestDialogOpen = ref(false)

const extensionUiRequests = computed(() =>
  Object.values(workspaceSession.activeExtensionUiRequests)
)
const hasExtensionUiRequests = computed(() => extensionUiRequests.value.length > 0)
const activeExtensionRequest = computed(() =>
  extensionUiRequests.value.find((request) => request.id === activeExtensionRequestId.value)
)
const extensionStatuses = computed(() =>
  Object.entries(workspaceSession.activeExtensionStatuses).filter(([, value]) => value)
)
const extensionWidgets = computed(() => Object.entries(workspaceSession.activeExtensionWidgets))

function getExtensionDraft(request: ExtensionUiRequest): string {
  return extensionDrafts.value[request.id] ?? getExtensionInitialDraft(request)
}

function setExtensionDraft(id: string, value: string): void {
  extensionDrafts.value = {
    ...extensionDrafts.value,
    [id]: value
  }
}

function openExtensionRequestDialog(request: ExtensionUiRequest): void {
  activeExtensionRequestId.value = request.id
  if (extensionDrafts.value[request.id] === undefined) {
    setExtensionDraft(request.id, getExtensionInitialDraft(request))
  }
  isExtensionRequestDialogOpen.value = true
}

function closeExtensionRequestDialog(): void {
  isExtensionRequestDialogOpen.value = false
  activeExtensionRequestId.value = undefined
}

function handleExtensionRequestDialogOpenChange(open: boolean): void {
  if (open) {
    isExtensionRequestDialogOpen.value = true
    return
  }
  closeExtensionRequestDialog()
}

function setActiveExtensionDraft(value: string): void {
  const request = activeExtensionRequest.value
  if (!request) {
    return
  }
  setExtensionDraft(request.id, value)
}

async function respondExtensionRequest(
  request: ExtensionUiRequest,
  value?: string | boolean
): Promise<void> {
  const threadId = workspaceSession.activeSessionId
  if (!threadId) {
    return
  }
  if (request.type === 'confirm') {
    await workspaceSession.respondExtensionUi(threadId, {
      id: request.id,
      confirmed: value === true
    })
    closeExtensionRequestDialog()
    return
  }
  await workspaceSession.respondExtensionUi(threadId, {
    id: request.id,
    value: typeof value === 'string' ? value : getExtensionDraft(request)
  })
  closeExtensionRequestDialog()
}

async function cancelExtensionRequest(request: ExtensionUiRequest): Promise<void> {
  const threadId = workspaceSession.activeSessionId
  if (!threadId) {
    return
  }
  await workspaceSession.respondExtensionUi(threadId, { id: request.id, cancelled: true })
  closeExtensionRequestDialog()
}
</script>

<template>
  <section class="session-section" role="tabpanel">
    <header class="session-section__header">
      <div class="session-section__title">
        <h3>Extensions</h3>
        <span v-if="extensionUiRequests.length" class="session-panel-count">
          {{ extensionUiRequests.length }}
        </span>
      </div>
    </header>

    <div
      v-if="
        !hasExtensionUiRequests &&
        !extensionStatuses.length &&
        !extensionWidgets.length &&
        !workspaceSession.activeExtensionTitle
      "
      class="session-empty"
    >
      No extension activity
    </div>

    <p v-if="workspaceSession.activeExtensionTitle" class="extension-title">
      {{ workspaceSession.activeExtensionTitle }}
    </p>

    <div v-if="extensionStatuses.length" class="extension-kv-list">
      <div v-for="[key, value] in extensionStatuses" :key="key">
        <span>{{ key }}</span>
        <strong>{{ value }}</strong>
      </div>
    </div>

    <article v-for="[key, widget] in extensionWidgets" :key="key" class="extension-widget">
      <strong>{{ key }}</strong>
      <p v-for="line in widget.lines" :key="line">{{ line }}</p>
    </article>

    <article v-for="request in extensionUiRequests" :key="request.id" class="extension-request-row">
      <div>
        <strong>{{ getExtensionRequestTitle(request) }}</strong>
        <span>{{ getExtensionRequestDescription(request) }}</span>
      </div>
      <span class="extension-request-row__type">{{ request.type }}</span>
      <BaseButton size="sm" variant="secondary" @click="openExtensionRequestDialog(request)">
        Respond
      </BaseButton>
    </article>

    <Dialog
      :open="isExtensionRequestDialogOpen"
      @update:open="handleExtensionRequestDialogOpenChange"
    >
      <DialogContent class="extension-request-dialog">
        <template v-if="activeExtensionRequest">
          <DialogHeader>
            <DialogTitle>{{ getExtensionRequestTitle(activeExtensionRequest) }}</DialogTitle>
            <DialogDescription>
              {{ getExtensionRequestDescription(activeExtensionRequest) }}
            </DialogDescription>
          </DialogHeader>

          <p
            v-if="activeExtensionRequest.type === 'confirm'"
            class="extension-request-dialog__copy"
          >
            {{ activeExtensionRequest.message }}
          </p>

          <div
            v-if="activeExtensionRequest.type === 'select'"
            class="extension-request-dialog__choices"
          >
            <BaseButton
              v-for="option in activeExtensionRequest.options"
              :key="option"
              size="sm"
              variant="secondary"
              @click="respondExtensionRequest(activeExtensionRequest, option)"
            >
              {{ option }}
            </BaseButton>
          </div>

          <input
            v-if="activeExtensionRequest.type === 'input'"
            :value="getExtensionDraft(activeExtensionRequest)"
            :placeholder="activeExtensionRequest.placeholder"
            class="extension-request-dialog__input"
            @input="setActiveExtensionDraft(($event.target as HTMLInputElement).value)"
          />

          <textarea
            v-if="activeExtensionRequest.type === 'editor'"
            :value="getExtensionDraft(activeExtensionRequest)"
            class="extension-request-dialog__textarea"
            @input="setActiveExtensionDraft(($event.target as HTMLTextAreaElement).value)"
          />

          <DialogFooter>
            <BaseButton
              type="button"
              size="sm"
              variant="ghost"
              @click="cancelExtensionRequest(activeExtensionRequest)"
            >
              Cancel
            </BaseButton>
            <BaseButton
              v-if="activeExtensionRequest.type === 'confirm'"
              type="button"
              size="sm"
              variant="primary"
              @click="respondExtensionRequest(activeExtensionRequest, true)"
            >
              Confirm
            </BaseButton>
            <BaseButton
              v-else-if="activeExtensionRequest.type !== 'select'"
              type="button"
              size="sm"
              variant="primary"
              @click="respondExtensionRequest(activeExtensionRequest)"
            >
              Submit
            </BaseButton>
          </DialogFooter>
        </template>
      </DialogContent>
    </Dialog>
  </section>
</template>
