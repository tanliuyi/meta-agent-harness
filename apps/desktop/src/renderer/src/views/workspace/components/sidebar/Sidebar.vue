<script setup lang="ts">
import { BaseIconButton } from '@renderer/components/base'
import PlusIcon from '@renderer/components/icons/PlusIcon.vue'
import FolderIcon from '@renderer/components/icons/FolderIcon.vue'
import SettingIcon from '@renderer/components/icons/SettingIcon.vue'
import { confirm } from '@renderer/composables/useConfirmDialog'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { ProjectSummary, ProjectTrustDecision } from '@shared/coding-agent/types'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { RouterLink } from 'vue-router'

const workspaceProject = useWorkspaceProjectStore()
const workspaceSession = useWorkspaceSessionStore()

/**
 * 选择 Project，并进入未创建 thread 的新会话草稿态。
 * @param projectId - Project ID。
 */
async function openProject(projectId: string): Promise<void> {
  await workspaceProject.openProject(projectId)
  workspaceSession.startNewSession(projectId)
}

/**
 * 在指定 Project 下开始一个新会话草稿。
 * @param projectId - Project ID。
 */
function createThreadInProject(projectId: string): void {
  workspaceSession.startNewSession(projectId)
}

/**
 * 设置 Project trust。
 * @param projectId - Project ID。
 * @param decision - trust 决策。
 */
async function setProjectTrust(projectId: string, decision: ProjectTrustDecision): Promise<void> {
  await workspaceProject.setProjectTrust(projectId, decision)
}

/**
 * 是否需要 Project trust 决策。
 * @param project - Project。
 * @returns 是否需要。
 */
function shouldRequestProjectTrust(project: ProjectSummary): boolean {
  return project.trust?.requiresTrust === true && project.trust.state !== 'trusted'
}

/**
 * 通过 Dialog 请求 Project trust 决策。
 * @param project - Project。
 */
async function requestProjectTrust(project: ProjectSummary): Promise<void> {
  if (!shouldRequestProjectTrust(project)) {
    return
  }

  const actions: Array<{ label: string; value: ProjectTrustDecision }> = [
    { label: '信任 Project', value: 'trustProject' },
    { label: '本次信任', value: 'trustSession' },
    { label: '不信任', value: 'doNotTrust' }
  ]

  if (project.trust?.parentPath) {
    actions.splice(1, 0, { label: '信任父目录', value: 'trustParent' })
  }

  const result = await confirm({
    actions,
    cancelText: '稍后再说',
    description: `Project 路径：${project.path}`,
    id: `project-trust-${project.projectId}`,
    title: '是否信任此 Project？',
    tone: 'destructive'
  })

  if (!result.confirmed || !result.action) {
    return
  }

  await setProjectTrust(project.projectId, result.action as ProjectTrustDecision)
}

/**
 * 创建 Project，并在需要 trust 时弹出确认对话框。
 */
async function createProject(): Promise<void> {
  const project = await workspaceProject.createProject()

  if (project) {
    await requestProjectTrust(project)
  }
}
</script>

<template>
  <aside class="workspace__sidebar">
    <ScrollArea class="sidebar-section">
      <div class="sidebar-section__header">
        <span>项目</span>
        <BaseIconButton
          label="打开 Project"
          size="small"
          class="project-tree__add-btn"
          @click="createProject"
        >
          <PlusIcon :size="14" />
        </BaseIconButton>
      </div>

      <template v-if="workspaceProject.errorMessage || workspaceSession.errorMessage">
        <p class="sidebar-error">
          {{ workspaceProject.errorMessage || workspaceSession.errorMessage }}
        </p>
      </template>

      <ul class="project-tree">
        <Collapsible
          v-for="project in workspaceProject.projectList"
          :key="project.projectId"
          default-open
          class="project-tree__item"
        >
          <CollapsibleTrigger>
            <div class="project-tree__project" @click="openProject(project.projectId)">
              <FolderIcon :size="12" />
              <span>{{ project.name }}</span>
              <BaseIconButton
                label="创建 Thread"
                size="small"
                :disabled="project.status !== 'available'"
                class="thread__add-btn"
                @click.stop="createThreadInProject(project.projectId)"
              >
                <PlusIcon :size="14" />
              </BaseIconButton>
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <ul class="session-group">
              <template
                v-if="(workspaceSession.sessionsByProject[project.projectId] ?? []).length === 0"
              >
                <li class="session-group__item is-empty">
                  <span class="session-group__item-title">暂无会话</span>
                </li>
              </template>

              <li
                v-for="thread in workspaceSession.sessionsByProject[project.projectId] ?? []"
                :key="thread.threadId"
                class="session-group__item"
                :class="{
                  'is-active': thread.threadId === workspaceSession.activeSessionId
                }"
                @click="workspaceSession.setActiveSessionId(thread.threadId)"
              >
                <span class="session-group__item-title">{{ thread.title || '新会话' }}</span>
                <small>{{ thread.status }}</small>
              </li>
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </ul>
    </ScrollArea>
    <div class="sidebar-section is-footer">
      <RouterLink to="/settings" class="button-cell">
        <SettingIcon :size="12" />
        <span>设置</span>
      </RouterLink>
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
  overflow: hidden;
  color: var(--color-text);
  border-right: 1px solid rgb(255 255 255 / 4%);
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

.sidebar-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-3);

  span {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text);
    font-size: 12px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-tree__add-btn {
    visibility: hidden;
    margin-left: auto;
  }

  &:hover {
    .project-tree__add-btn {
      visibility: visible;
    }
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

.project-tree__project {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: 28px;
  padding: 0 var(--space-3);
  color: var(--color-text-muted);

  span {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 560;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thread__add-btn {
    visibility: hidden;
    margin-left: auto;
  }

  &:hover {
    .thread__add-btn {
      visibility: visible;
    }
  }
}

.session-group__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  margin: 0 var(--space-2);
  padding: 0 var(--space-3) 0 var(--space-8);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);

  &:not(.is-empty):hover,
  &.is-active {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }

  &-title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }

  &.is-empty {
    font-size: 12px;
    color: var(--color-text-muted);
  }
}

.session-group__item {
  height: 28px;
}

.button-cell {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  height: 28px;
  margin: 0 var(--space-2) var(--space-2);
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }
}
</style>
