<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BaseButton } from '@renderer/components/base'
import ExtensionRequestForm from '@renderer/components/extension/ExtensionRequestForm.vue'
import ExtensionWidget from '@renderer/components/extension/ExtensionWidget.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { ExtensionDialogRequest } from '@shared/coding-agent/types'
import {
  getExtensionDisplayText,
  getExtensionRequestDescription,
  getExtensionRequestTitle,
  getExtensionRequestTypeLabel
} from './display/extensionDisplay'

const NOTIFICATIONS_WIDGET_KEY = '通知'
const workspaceSession = useWorkspaceSessionStore()
const activeExtensionRequestId = ref<string>()
const isExtensionRequestDialogOpen = ref(false)

const extensionDialogs = computed(() => workspaceSession.activeExtensionDialogs)
const hasExtensionDialogs = computed(() => extensionDialogs.value.length > 0)
const activeExtensionRequest = computed(() =>
  extensionDialogs.value.find((request) => request.id === activeExtensionRequestId.value)
)
const extensionStatuses = computed(() =>
  Object.entries(workspaceSession.activeExtensionStatuses).filter(([, value]) => value)
)
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
    hasExtensionDialogs.value ||
    extensionStatuses.value.length > 0 ||
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

function isActiveExtensionRequest(request: ExtensionDialogRequest): boolean {
  return workspaceSession.activeExtensionDialog?.id === request.id
}

function openExtensionRequestDialog(request: ExtensionDialogRequest): void {
  if (!isActiveExtensionRequest(request)) {
    return
  }
  activeExtensionRequestId.value = request.id
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

async function respondExtensionRequest(
  request: ExtensionDialogRequest,
  value: string | boolean
): Promise<void> {
  if (await workspaceSession.respondExtensionDialog(request, value)) {
    closeExtensionRequestDialog()
  }
}

async function cancelExtensionRequest(request: ExtensionDialogRequest): Promise<void> {
  if (await workspaceSession.cancelExtensionDialog(request)) {
    closeExtensionRequestDialog()
  }
}

watch(activeExtensionRequest, (request) => {
  if (isExtensionRequestDialogOpen.value && !request) {
    closeExtensionRequestDialog()
  }
})

function clearNotifications(): void {
  workspaceSession.clearExtensionNotifications()
}
</script>

<template>
  <section class="session-section session-section--scrollable" role="tabpanel">
    <header class="session-section__header">
      <div class="session-section__title">
        <h3>扩展</h3>
        <span v-if="extensionDialogs.length" class="session-panel-count">
          {{ extensionDialogs.length }}
        </span>
      </div>
    </header>

    <ScrollArea class="session-section__content-scroll" :vertical-size="7">
      <div v-if="!hasExtensionActivity" class="session-empty">暂无扩展活动</div>

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

        <section v-if="hasExtensionDialogs" class="extension-panel-group">
          <header class="extension-panel-group__header">
            <span>请求</span>
            <strong>{{ extensionDialogs.length }}</strong>
          </header>
          <article
            v-for="request in extensionDialogs"
            :key="request.id"
            class="extension-request-row"
          >
            <div>
              <strong>{{ getExtensionRequestTitle(request) }}</strong>
              <span>{{ getExtensionRequestDescription(request) }}</span>
            </div>
            <span class="extension-request-row__type">{{
              getExtensionRequestTypeLabel(request)
            }}</span>
            <BaseButton
              v-if="isActiveExtensionRequest(request)"
              size="sm"
              variant="secondary"
              @click="openExtensionRequestDialog(request)"
            >
              响应
            </BaseButton>
            <span v-else class="extension-request-row__waiting">等待中</span>
          </article>
        </section>

        <section v-if="extensionStatuses.length || notificationLines" class="extension-panel-group">
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
        </section>
      </div>
    </ScrollArea>

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

          <ExtensionRequestForm
            :request="activeExtensionRequest"
            :draft="workspaceSession.activeExtensionDialogDrafts[activeExtensionRequest.id]"
            :responding="
              workspaceSession.activeExtensionDialogResponding[activeExtensionRequest.id]
            "
            :error="workspaceSession.activeExtensionDialogErrors[activeExtensionRequest.id]"
            @submit="respondExtensionRequest"
            @cancel="cancelExtensionRequest"
            @update:draft="workspaceSession.setExtensionDialogDraft"
          />
        </template>
      </DialogContent>
    </Dialog>
  </section>
</template>
