<script setup lang="ts">
/**
 * Sidebar.vue - Workspace 左侧边栏组件。
 *
 * 展示 Project 与 thread 列表，并支持切换当前会话。
 */

import { BaseIconButton } from '@renderer/components/base'
import PlusIcon from '@renderer/components/icons/PlusIcon.vue'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'

const workspaceProject = useWorkspaceProjectStore()
const workspaceSession = useWorkspaceSessionStore()

/**
 * 打开 Project 并刷新所有 thread。
 * @param projectId - Project ID。
 */
async function openProject(projectId: string): Promise<void> {
  await workspaceProject.openProject(projectId)
  await workspaceSession.loadThreads()
}

/**
 * 在指定 Project 下创建 Thread。
 * @param projectId - Project ID。
 */
async function createThreadInProject(projectId: string): Promise<void> {
  await workspaceSession.createThread(projectId)
}
</script>

<template>
  <aside class="workspace__sidebar">
    <div class="sidebar-section">
      <div class="sidebar-section__header">
        <span>Projects</span>
        <BaseIconButton label="打开 Project" @click="workspaceProject.createProject">
          <PlusIcon />
        </BaseIconButton>
      </div>

      <p v-if="workspaceProject.errorMessage || workspaceSession.errorMessage" class="sidebar-error">
        {{ workspaceProject.errorMessage || workspaceSession.errorMessage }}
      </p>

      <ul class="project-tree">
        <li
          v-for="project in workspaceProject.projectList"
          :key="project.projectId"
          class="project-tree__item"
        >
          <div
            class="project-tree__project"
            @click="openProject(project.projectId)"
          >
            <span>{{ project.name }}</span>
            <small>{{ project.status }}</small>
            <BaseIconButton
              label="创建 Thread"
              :disabled="project.status !== 'available'"
              @click.stop="createThreadInProject(project.projectId)"
            >
              <PlusIcon />
            </BaseIconButton>
          </div>

          <ul class="session-group">
            <li
              v-for="thread in workspaceSession.sessionsByProject[project.projectId] ?? []"
              :key="thread.threadId"
              class="session-group__item"
              :class="{
                'session-group__item--active': thread.threadId === workspaceSession.activeSessionId
              }"
              @click="workspaceSession.setActiveSessionId(thread.threadId)"
            >
              <span>{{ thread.title || thread.threadId }}</span>
              <small>{{ thread.status }}</small>
            </li>
          </ul>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.workspace__sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: var(--space-3) var(--space-2) var(--space-3) var(--space-3);
  overflow: hidden;
  color: var(--color-text);
  background:
    linear-gradient(180deg, rgb(255 255 255 / 4%), transparent 72px), var(--color-sidebar);
  border-right: 1px solid rgb(255 255 255 / 4%);
  backdrop-filter: blur(16px);
}

.sidebar-section {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding-right: var(--space-1);
  overflow-y: auto;
}

.sidebar-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 30px;
  padding: 0 var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border);

  span {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text);
    font-size: 12px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.sidebar-error {
  margin: 0;
  color: var(--color-danger, #ff7a7a);
  font-size: 11px;
}

.project-tree,
.session-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-tree__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.project-tree__project,
.session-group__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 32px;
  padding: 0 var(--space-2);
  color: var(--color-text-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;

  span {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 560;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    font-family: var(--font-mono);
    font-size: 10px;
  }

  &:hover,
  &--active {
    color: var(--color-text);
    background: var(--color-surface-raised);
    border-color: var(--color-border);
  }
}

.session-group {
  padding-left: var(--space-3);
}

.session-group__item {
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 28px;
}

</style>
