<script setup lang="ts">
import BackIcon from '@/components/icons/BackIcon.vue'
import { RouterLink, useRouter } from 'vue-router'
import useWorkspaceSession from '@/stores/workspace-session'

const router = useRouter()
const { activeSessionId } = useWorkspaceSession()

const goBack = (): void => {
  console.log(activeSessionId)
  router.replace({ name: 'Workspace', params: { sessionid: activeSessionId ?? 'new' } })
}
</script>

<template>
  <aside class="settings__sidebar">
    <div class="sidebar-section">
      <button class="back-button" @click="goBack">
        <BackIcon :size="12" />
        <span>返回聊天</span>
      </button>
      <RouterLink class="settings-link" to="/settings/models">
        <span>模型</span>
      </RouterLink>
      <RouterLink class="settings-link" to="/settings/agent">
        <span>Agent</span>
      </RouterLink>
    </div>
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
  border-right: 1px solid rgb(255 255 255 / 4%);
  backdrop-filter: blur(16px);
}

.sidebar-section {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;

  &.is-footer {
    flex: 0 0 auto;
  }
}

.back-button {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: 28px;
  margin: 0 var(--space-2);
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }
}

.settings-link {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 28px;
  margin: var(--space-1) var(--space-2) 0;
  padding: 0 var(--space-3);
  color: var(--color-text-muted);
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 650;
  text-decoration: none;

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }

  &.router-link-active {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }
}
</style>
