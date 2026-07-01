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
import type {
  ProjectSummary,
  ProjectTrustDecision
} from '../../../../../../shared/coding-agent/types'

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

/**
 * 设置 Project trust。
 * @param projectId - Project ID。
 * @param decision - trust 决策。
 */
async function setProjectTrust(
  projectId: string,
  decision: ProjectTrustDecision
): Promise<void> {
  await workspaceProject.setProjectTrust(projectId, decision)
}

/**
 * 是否展示 Project trust 提示。
 * @param project - Project。
 * @returns 是否展示。
 */
function shouldShowTrustNotice(project: ProjectSummary): boolean {
  return project.trust?.requiresTrust === true && project.trust.state !== 'trusted'
}

/**
 * 获取 Project trust 状态标签。
 * @param project - Project。
 * @returns 状态标签。
 */
function getTrustLabel(project: ProjectSummary): string {
  switch (project.trust?.state) {
    case 'trusted':
      return project.trust.sessionOnly ? 'trusted session' : 'trusted'
    case 'untrusted':
      return 'untrusted'
    case 'unknown':
      return 'trust needed'
    case 'notRequired':
    default:
      return project.status
  }
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
            <small>{{ getTrustLabel(project) }}</small>
            <BaseIconButton
              label="创建 Thread"
              :disabled="project.status !== 'available'"
              @click.stop="createThreadInProject(project.projectId)"
            >
              <PlusIcon />
            </BaseIconButton>
          </div>

          <div v-if="shouldShowTrustNotice(project)" class="project-trust">
            <p>未信任，本地 agent 资源已禁用。</p>
            <div class="project-trust__actions">
              <button type="button" @click="setProjectTrust(project.projectId, 'trustProject')">
                信任 Project
              </button>
              <button
                v-if="project.trust?.parentPath"
                type="button"
                @click="setProjectTrust(project.projectId, 'trustParent')"
              >
                信任父目录
              </button>
              <button type="button" @click="setProjectTrust(project.projectId, 'trustSession')">
                本次信任
              </button>
              <button type="button" @click="setProjectTrust(project.projectId, 'doNotTrust')">
                不信任
              </button>
            </div>
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

.project-trust {
  display: grid;
  gap: var(--space-2);
  margin: var(--space-1) 0 var(--space-2);
  padding: var(--space-2);
  color: var(--color-text-muted);
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);

  p {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
  }
}

.project-trust__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);

  button {
    min-height: 24px;
    padding: 0 var(--space-2);
    color: var(--color-text-muted);
    font: inherit;
    font-size: 11px;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xs);
    cursor: pointer;
  }

  button:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
    border-color: var(--color-border-strong);
  }
}

</style>
