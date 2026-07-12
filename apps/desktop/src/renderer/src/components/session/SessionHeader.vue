<script lang="ts" setup>
/**
 * SessionHeader.vue - 当前活跃会话的顶部状态栏组件。
 *
 * 展示会话标题、工作目录与状态，并适配右侧面板的折叠状态。
 */

import { BaseDropdownMenu, BaseIconButton } from '@renderer/components/base'
import NameCommandDialog from '@renderer/components/chat/composer/dialogs/NameCommandDialog.vue'
import { confirm } from '@renderer/composables/useConfirmDialog'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import { useAppStore } from '@renderer/stores/app'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import useWorkspaceUiStore from '@renderer/stores/workspace-ui'
import {
  getThreadMenuSections,
  isThreadMenuActionId
} from '@renderer/views/workspace/components/sidebar/support/sidebar-thread-item'
import { Ellipsis } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const app = useAppStore()
const workspaceSession = useWorkspaceSessionStore()
const workspaceUi = useWorkspaceUiStore()
const { session, panel, openPanelTab } = useSessionContext()
const renameDialogOpen = ref(false)
const renameDraft = ref('')

const menuSections = computed(() => {
  const activeSession = workspaceSession.activeSession
  return activeSession ? getThreadMenuSections(activeSession) : []
})

async function runMenuAction(actionId: string): Promise<void> {
  const activeSession = workspaceSession.activeSession
  if (!activeSession || !isThreadMenuActionId(actionId)) return

  switch (actionId) {
    case 'copy-id':
      await navigator.clipboard.writeText(activeSession.threadId)
      return
    case 'rename':
      renameDraft.value = activeSession.title?.trim() ?? ''
      renameDialogOpen.value = true
      return
    case 'open-parent':
      await workspaceSession.openParentSession(activeSession.threadId)
      return
    case 'locate-current-leaf':
      if (activeSession.snapshot?.currentEntryId) {
        workspaceSession.focusActiveSessionTreeEntry(activeSession.snapshot.currentEntryId)
      }
      return
    case 'archive':
      await archiveActiveSession(activeSession.threadId, activeSession.title)
  }
}

async function submitRename(): Promise<void> {
  const activeSession = workspaceSession.activeSession
  const nextName = renameDraft.value.trim()
  if (!activeSession || !nextName) return

  await workspaceSession.runCommand('name', nextName, activeSession.threadId)
  renameDialogOpen.value = false
  renameDraft.value = ''
}

async function archiveActiveSession(threadId: string, title?: string): Promise<void> {
  const result = await confirm({
    actions: [{ label: '归档', value: 'archive' }],
    cancelText: '取消',
    description: title ? `会话：${title}` : `Thread ID：${threadId}`,
    id: `archive-thread-${threadId}`,
    title: '归档这个会话？',
    tone: 'destructive'
  })

  if (result.confirmed && result.action === 'archive') {
    await workspaceSession.archiveThread(threadId)
  }
}

/** 动态计算的头部样式，用于给右侧操作按钮预留空间。 */
const styles = computed(() => {
  const paddingRight = panel.value.open
    ? `var(--space-2)`
    : `calc(var(--space-2) + var(--session-panel-actions-width))`
  return {
    paddingRight,
    '--session-header-padding-right': paddingRight
  }
})
</script>

<template>
  <header class="session-header" :class="{ 'session-header--darwin': app.isMac }" :style="styles">
    <BaseIconButton
      v-if="app.isMac && !workspaceUi.sidebarOpen"
      class="session-header__sidebar-toggle"
      label="展开侧栏"
      size="small"
      @click="workspaceUi.sidebarOpen = true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        width="16"
        height="16"
        aria-hidden="true"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </svg>
    </BaseIconButton>
    <div class="session-header__title">
      <strong>{{ session.title }}</strong>
      <BaseDropdownMenu
        v-if="session.sessionId"
        :sections="menuSections"
        @select="(item) => runMenuAction(item.id)"
      >
        <BaseIconButton class="session-header__more" label="会话操作" size="small" :tooltip="false">
          <Ellipsis :size="16" />
        </BaseIconButton>
      </BaseDropdownMenu>
    </div>
    <div class="session-header__actions">
      <BaseIconButton label="查看会话信息" @click="openPanelTab('session')">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </BaseIconButton>
    </div>
    <div v-if="app.isMac" class="session-header__drag-spacer" aria-hidden="true" />
  </header>

  <NameCommandDialog v-model:open="renameDialogOpen" v-model="renameDraft" @submit="submitRename" />
</template>

<style lang="scss" scoped>
.session-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  min-height: 0;
  padding-left: var(--session-header-padding-left, var(--space-4));
  background: var(--color-surface);

  &--darwin {
    -webkit-app-region: drag;
    app-region: drag;
  }

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-header__sidebar-toggle {
    position: absolute;
    z-index: 2;
    top: calc((var(--session-header-height) - 26px) / 2);
    left: 81px;
    width: 26px;
    height: 26px;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  .session-header__sidebar-toggle :deep(*) {
    pointer-events: none;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  .session-header__title {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  .session-header__title strong {
    min-width: 0;
    -webkit-app-region: no-drag;
    app-region: no-drag;
    user-select: text;
  }

  .session-header__more {
    flex: 0 0 auto;
    margin-left: var(--space-2);
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  .session-header__actions {
    display: flex;
    flex-direction: row;
    align-items: center;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  .session-header__drag-spacer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--session-header-padding-right);
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
    font-weight: 650;
  }

  span {
    color: var(--color-text-muted);
    font-family: var(--font-mono) !important;
    font-size: var(--font-size-ui-xs);
  }
}
</style>
