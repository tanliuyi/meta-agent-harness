<script setup lang="ts">
import BackIcon from '@/components/icons/BackIcon.vue'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import {
  Archive,
  Bot,
  Boxes,
  Brain,
  Palette,
  Puzzle,
  Settings2,
  Stethoscope,
  Info
} from 'lucide-vue-next'
import { RouterLink, useRouter } from 'vue-router'
import { WORKSPACE_SESSION_ROUTE_NAME } from '@renderer/router/workspace-route-host'
import useWorkspaceSession from '@/stores/workspace-session'

const router = useRouter()
const workspaceSession = useWorkspaceSession()

const goBack = (): void => {
  router.replace({
    name: WORKSPACE_SESSION_ROUTE_NAME,
    params: { sessionId: workspaceSession.activeSessionId ?? 'new' }
  })
}
</script>

<template>
  <aside class="settings__sidebar">
    <ScrollArea class="sidebar-section">
      <button class="back-button" @click="goBack">
        <BackIcon :size="12" />
        <span>返回聊天</span>
      </button>
      <RouterLink class="settings-link" to="/settings/general">
        <Settings2 :size="15" aria-hidden="true" />
        <span>通用</span>
      </RouterLink>
      <RouterLink class="settings-link" to="/settings/personalization">
        <Palette :size="15" aria-hidden="true" />
        <span>个性化</span>
      </RouterLink>
      <RouterLink class="settings-link" to="/settings/memory">
        <Brain :size="15" aria-hidden="true" />
        <span>记忆</span>
      </RouterLink>
      <RouterLink class="settings-link" to="/settings/models">
        <Boxes :size="15" aria-hidden="true" />
        <span>模型</span>
      </RouterLink>
      <RouterLink class="settings-link" to="/settings/agent">
        <Bot :size="15" aria-hidden="true" />
        <span>智能体</span>
      </RouterLink>
      <RouterLink class="settings-link" to="/settings/extensions">
        <Puzzle :size="15" aria-hidden="true" />
        <span>扩展</span>
      </RouterLink>
      <RouterLink class="settings-link" to="/settings/diagnostics">
        <Stethoscope :size="15" aria-hidden="true" />
        <span>诊断</span>
      </RouterLink>
      <RouterLink class="settings-link" to="/settings/archive">
        <Archive :size="15" aria-hidden="true" />
        <span>归档</span>
      </RouterLink>
      <RouterLink class="settings-link" to="/settings/about">
        <Info :size="15" aria-hidden="true" />
        <span>关于我们</span>
      </RouterLink>
    </ScrollArea>
  </aside>
</template>

<style lang="scss" scoped>
.settings__sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: var(--space-2) 0;
  overflow: hidden;
  color: var(--color-text);
  backdrop-filter: blur(16px);
}

.sidebar-section {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;

  &.is-footer {
    flex: 0 0 auto;
  }
}

.sidebar-section :deep([data-slot='scroll-area-viewport']) {
  display: flex;
  flex-direction: column;
}

.back-button {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  width: calc(100% - var(--space-2) * 2);
  min-width: 0;
  height: 28px;
  margin: 0 var(--space-2) var(--space-3);
  padding: 0 var(--space-3);
  color: var(--color-text-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  font-size: var(--font-size-ui-sm);
  font-weight: 650;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }
}

.settings-link {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: 2.4em;
  margin: var(--space-1) var(--space-2) 0;
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  font-weight: 650;
  text-decoration: none;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  > svg {
    flex: 0 0 auto;
  }

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }

  &.router-link-active {
    color: var(--color-text);
    background: var(--color-item-active);
    border-color: var(--color-item-active-border);
  }
}
</style>
