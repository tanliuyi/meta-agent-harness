<script setup lang="ts">
import { computed, ref } from 'vue'
import { BaseButton } from '@renderer/components/base'
import ExtensionWidget from '@renderer/components/extension/ExtensionWidget.vue'
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
  getExtensionDisplayLines,
  getExtensionDisplayText,
  getExtensionInitialDraft,
  getExtensionRequestDescription,
  getExtensionRequestTitle,
  getExtensionRequestTypeLabel
} from './display/extensionDisplay'

const NOTIFICATIONS_WIDGET_KEY = '通知'
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
const notificationLines = computed(() =>
  workspaceSession.activeExtensionNotifications.length > 0
    ? workspaceSession.activeExtensionNotifications
    : undefined
)
const hasExtensionWorkingState = computed(
  () =>
    Boolean(workspaceSession.activeExtensionWorkingMessage) ||
    workspaceSession.activeExtensionWorkingVisible === false ||
    Boolean(workspaceSession.activeExtensionWorkingIndicator)
)
const hasExtensionActivity = computed(
  () =>
    hasExtensionUiRequests.value ||
    extensionStatuses.value.length > 0 ||
    extensionWidgets.value.length > 0 ||
    workspaceSession.activeExtensionNotifications.length > 0 ||
    Boolean(workspaceSession.activeExtensionTitle) ||
    hasExtensionWorkingState.value
)
const workingStateText = computed(() => {
  if (workspaceSession.activeExtensionWorkingVisible === false) {
    return '工作行已隐藏'
  }
  return workspaceSession.activeExtensionWorkingMessage || '使用默认工作行'
})
const workingIndicatorText = computed(() => {
  const indicator = workspaceSession.activeExtensionWorkingIndicator
  if (!indicator) {
    return undefined
  }
  if (indicator.frames && indicator.frames.length === 0) {
    return '指示器已隐藏'
  }
  if (indicator.frames?.length) {
    return `${indicator.frames.length} 个自定义帧`
  }
  return '默认指示器'
})

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

function clearNotifications(): void {
  workspaceSession.clearExtensionNotifications()
}
</script>

<template>
  <section class="session-section" role="tabpanel">
    <header class="session-section__header">
      <div class="session-section__title">
        <h3>扩展</h3>
        <span v-if="extensionUiRequests.length" class="session-panel-count">
          {{ extensionUiRequests.length }}
        </span>
      </div>
    </header>

    <div v-if="!hasExtensionActivity" class="session-empty">
      暂无扩展活动
    </div>

    <div v-if="hasExtensionActivity" class="extension-panel-stack">
      <section
        v-if="workspaceSession.activeExtensionTitle || hasExtensionWorkingState"
        class="extension-panel-group"
      >
        <header class="extension-panel-group__header">
          <span>当前状态</span>
        </header>
        <p v-if="workspaceSession.activeExtensionTitle" class="extension-title">
          {{ workspaceSession.activeExtensionTitle }}
        </p>
        <div v-if="hasExtensionWorkingState" class="extension-kv-list">
          <div>
            <span>工作状态</span>
            <strong>{{ workingStateText }}</strong>
          </div>
          <div v-if="workingIndicatorText">
            <span>指示器</span>
            <strong>{{ workingIndicatorText }}</strong>
          </div>
        </div>
      </section>

      <section v-if="hasExtensionUiRequests" class="extension-panel-group">
        <header class="extension-panel-group__header">
          <span>请求</span>
          <strong>{{ extensionUiRequests.length }}</strong>
        </header>
        <article
          v-for="request in extensionUiRequests"
          :key="request.id"
          class="extension-request-row"
        >
          <div>
            <strong>{{ getExtensionRequestTitle(request) }}</strong>
            <span>{{ getExtensionRequestDescription(request) }}</span>
          </div>
          <span class="extension-request-row__type">{{ getExtensionRequestTypeLabel(request) }}</span>
          <BaseButton size="sm" variant="secondary" @click="openExtensionRequestDialog(request)">
            响应
          </BaseButton>
        </article>
      </section>

      <section
        v-if="extensionStatuses.length || notificationLines || extensionWidgets.length"
        class="extension-panel-group"
      >
        <header class="extension-panel-group__header">
          <span>活动</span>
        </header>

        <div v-if="extensionStatuses.length" class="extension-kv-list">
          <div v-for="[key, value] in extensionStatuses" :key="key">
            <span>{{ getExtensionDisplayText(key) }}</span>
            <strong>{{ getExtensionDisplayText(value) }}</strong>
          </div>
        </div>

        <ExtensionWidget
          v-if="notificationLines"
          :title="NOTIFICATIONS_WIDGET_KEY"
          :lines="notificationLines"
          variant="detail"
        >
          <template #actions>
            <BaseButton size="sm" variant="ghost" @click="clearNotifications">清除</BaseButton>
          </template>
        </ExtensionWidget>

        <ExtensionWidget
          v-for="[key, widget] in extensionWidgets"
          :key="key"
          :title="getExtensionDisplayText(key)"
          :lines="getExtensionDisplayLines(widget.lines)"
          variant="detail"
        />
      </section>
    </div>

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
            :aria-label="getExtensionRequestTitle(activeExtensionRequest)"
            class="extension-request-dialog__input"
            @input="setActiveExtensionDraft(($event.target as HTMLInputElement).value)"
          />

          <textarea
            v-if="activeExtensionRequest.type === 'editor'"
            :value="getExtensionDraft(activeExtensionRequest)"
            :aria-label="getExtensionRequestTitle(activeExtensionRequest)"
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
              取消
            </BaseButton>
            <BaseButton
              v-if="activeExtensionRequest.type === 'confirm'"
              type="button"
              size="sm"
              variant="primary"
              @click="respondExtensionRequest(activeExtensionRequest, true)"
            >
              确认
            </BaseButton>
            <BaseButton
              v-else-if="activeExtensionRequest.type !== 'select'"
              type="button"
              size="sm"
              variant="primary"
              @click="respondExtensionRequest(activeExtensionRequest)"
            >
              提交
            </BaseButton>
          </DialogFooter>
        </template>
      </DialogContent>
    </Dialog>
  </section>
</template>
