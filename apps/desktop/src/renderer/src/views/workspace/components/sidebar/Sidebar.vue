<script setup lang="ts">
import { BaseContextMenu, BaseIconButton } from '@renderer/components/base'
import PlusIcon from '@renderer/components/icons/PlusIcon.vue'
import FolderIcon from '@renderer/components/icons/FolderIcon.vue'
import FolderOpenIcon from '@renderer/components/icons/FolderOpenIcon.vue'
import SettingIcon from '@renderer/components/icons/SettingIcon.vue'
import { confirm } from '@renderer/composables/useConfirmDialog'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { ProjectSummary, ProjectTrustDecision } from '@shared/coding-agent/types'
import type { WorkspaceSession } from '@renderer/stores/workspace-session'
import type { Component } from 'vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { Archive, Copy, ShieldAlert, ShieldCheck, ShieldOff } from '@lucide/vue'
import { RouterLink } from 'vue-router'

type ThreadMenuActionId = 'copy-id' | 'archive'
type ProjectMenuActionId = 'new-thread' | 'project-trust'

interface ThreadMenuItem {
  id: ThreadMenuActionId
  label: string
  shortcut?: string
  icon?: Component
  disabled?: boolean
  danger?: boolean
}

interface ThreadMenuSection {
  label?: string
  items: ThreadMenuItem[]
}

interface ProjectMenuItem {
  id: ProjectMenuActionId
  label: string
  icon?: Component
  disabled?: boolean
  danger?: boolean
}

interface ProjectMenuSection {
  label?: string
  items: ProjectMenuItem[]
}

interface ThreadListItem {
  thread: WorkspaceSession
  statusIndicator?: 'running' | 'error'
  statusLabel?: string
  updatedAtDistance?: string
}

interface ProjectListItem {
  project: ProjectSummary
  threads: ThreadListItem[]
}

const workspaceProject = useWorkspaceProjectStore()
const workspaceSession = useWorkspaceSessionStore()
const expandedProjects = ref<Record<string, { displayCount: number; hasExpanded: boolean }>>({})

function getProjectExpansion(projectId: string): { displayCount: number; hasExpanded: boolean } {
  if (!expandedProjects.value[projectId]) {
    expandedProjects.value[projectId] = { displayCount: 5, hasExpanded: false }
  }
  return expandedProjects.value[projectId]
}

function expandProject(projectId: string, totalCount: number, increment: number = 10): void {
  const expansion = getProjectExpansion(projectId)
  const remaining = totalCount - expansion.displayCount
  const toAdd = Math.min(increment, remaining)
  expansion.displayCount += toAdd
  expansion.hasExpanded = true
}

function collapseProject(projectId: string): void {
  const expansion = getProjectExpansion(projectId)
  expansion.displayCount = 5
}

function getExpandButtonText(totalCount: number, displayCount: number): string {
  const remaining = totalCount - displayCount
  if (remaining >= 10) {
    return `展开 10 条 (${remaining} 条)`
  } else if (remaining > 0) {
    return `展开 ${remaining} 条`
  } else {
    return '' // 不应该显示按钮
  }
}

const currentTime = ref(Date.now())
let currentTimeTimer: number | undefined

const threadMenuSections: ThreadMenuSection[] = [
  {
    items: [{ id: 'copy-id', label: '复制 Thread ID', icon: Copy }]
  },
  {
    items: [{ id: 'archive', label: '归档会话', icon: Archive, danger: true }]
  }
]

const projectListItems = computed<ProjectListItem[]>(() =>
  workspaceProject.projectList.map((project) => ({
    project,
    threads: (workspaceSession.sessionsByProject[project.projectId] ?? []).map((thread) =>
      toThreadListItem(thread)
    )
  }))
)

onMounted(() => {
  currentTimeTimer = window.setInterval(() => {
    currentTime.value = Date.now()
  }, 60_000)
})

onBeforeUnmount(() => {
  if (currentTimeTimer) {
    window.clearInterval(currentTimeTimer)
  }
})

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
  if (!project.trust?.requiresTrust) {
    return
  }

  const actions: Array<{ label: string; value: ProjectTrustDecision; tone?: 'destructive' }> = []
  if (project.trust.state !== 'trusted') {
    actions.push({ label: '信任 Project', value: 'trustProject' })
    if (project.trust.parentPath) {
      actions.push({ label: '信任父目录', value: 'trustParent' })
    }
    actions.push({ label: '本次信任', value: 'trustSession' })
  }
  actions.push({ label: '不信任', value: 'doNotTrust', tone: 'destructive' })

  const result = await confirm({
    actions,
    cancelText: '取消',
    description: `${getProjectTrustDescription(project)}。Project 路径：${project.path}`,
    id: `project-trust-${project.projectId}`,
    title: `${project.name}：${getProjectTrustStateLabel(project)}`,
    tone: project.trust.state === 'untrusted' ? 'destructive' : 'default'
  })

  if (!result.confirmed || !result.action) {
    return
  }

  await setProjectTrust(project.projectId, result.action as ProjectTrustDecision)
}

/**
 * 创建 Project。
 */
async function createProject(): Promise<void> {
  const project = await workspaceProject.createProject()
  if (project && shouldRequestProjectTrust(project)) {
    await requestProjectTrust(project)
  }
}

async function runThreadMenuAction(actionId: string, thread: WorkspaceSession): Promise<void> {
  switch (actionId) {
    case 'copy-id':
      await navigator.clipboard.writeText(thread.threadId)
      return
    case 'archive':
      await archiveThread(thread)
      return
  }
}

async function archiveThread(thread: WorkspaceSession): Promise<void> {
  const result = await confirm({
    actions: [{ label: '归档', value: 'archive' }],
    cancelText: '取消',
    description: thread.title ? `会话：${thread.title}` : `Thread ID：${thread.threadId}`,
    id: `archive-thread-${thread.threadId}`,
    title: '归档这个会话？',
    tone: 'destructive'
  })

  if (!result.confirmed || result.action !== 'archive') {
    return
  }

  await workspaceSession.archiveThread(thread.threadId)
}

async function runProjectMenuAction(actionId: string, project: ProjectSummary): Promise<void> {
  switch (actionId) {
    case 'new-thread':
      createThreadInProject(project.projectId)
      return
    case 'project-trust':
      await requestProjectTrust(project)
      return
  }
}

function getProjectMenuSections(project: ProjectSummary): ProjectMenuSection[] {
  const sections: ProjectMenuSection[] = [
    {
      items: [
        {
          id: 'new-thread',
          label: '新建 Thread',
          disabled: project.status !== 'available',
          icon: PlusIcon
        }
      ]
    }
  ]

  if (project.trust?.requiresTrust) {
    sections.push({
      label: 'Project trust',
      items: [
        {
          id: 'project-trust',
          label: getProjectTrustStateLabel(project) ?? '管理信任',
          icon: getProjectTrustIcon(project),
          danger: project.trust.state === 'untrusted'
        }
      ]
    })
  }

  return sections
}

function getThreadStatusIndicator(
  status: WorkspaceSession['status']
): 'running' | 'error' | undefined {
  if (status === 'running' || status === 'error') {
    return status
  }

  return undefined
}

function getThreadStatusLabel(status: WorkspaceSession['status']): string | undefined {
  const indicator = getThreadStatusIndicator(status)
  return indicator === undefined ? undefined : indicator === 'running' ? '运行中' : '错误'
}

function toThreadListItem(thread: WorkspaceSession): ThreadListItem {
  const statusIndicator = getThreadStatusIndicator(thread.status)
  return {
    thread,
    statusIndicator,
    statusLabel: statusIndicator ? getThreadStatusLabel(thread.status) : undefined,
    updatedAtDistance: statusIndicator ? undefined : formatUpdatedAtDistance(thread.updatedAt)
  }
}

function formatUpdatedAtDistance(updatedAt: string): string | undefined {
  const updatedAtTime = Date.parse(updatedAt)

  if (Number.isNaN(updatedAtTime)) {
    return undefined
  }

  const minutes = Math.max(1, Math.floor((currentTime.value - updatedAtTime) / 60_000))

  if (minutes >= 60 * 24) {
    return `${Math.floor(minutes / (60 * 24))} 天`
  }

  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)} 小时`
  }

  return `${minutes} 分`
}

function getProjectTrustStateLabel(project: ProjectSummary): string | undefined {
  const trust = project.trust
  if (!trust?.requiresTrust) {
    return undefined
  }

  if (trust.state === 'trusted') {
    return trust.sessionOnly ? '本次已信任' : '已信任'
  }

  if (trust.state === 'untrusted') {
    return '不信任'
  }

  return '未信任'
}

function getProjectTrustDescription(project: ProjectSummary): string | undefined {
  const trust = project.trust
  if (!trust?.requiresTrust) {
    return undefined
  }

  if (trust.state === 'trusted') {
    return '本地 agent 资源已启用'
  }

  return '本地 agent 资源已禁用'
}

function getProjectTrustIcon(project: ProjectSummary): Component | undefined {
  const state = project.trust?.state
  if (!project.trust?.requiresTrust) {
    return undefined
  }

  if (state === 'trusted') {
    return ShieldCheck
  }

  if (state === 'untrusted') {
    return ShieldOff
  }

  return ShieldAlert
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
          v-for="projectItem in projectListItems"
          :key="projectItem.project.projectId"
          v-slot="{ open }"
          default-open
          class="project-tree__item"
        >
          <BaseContextMenu
            :sections="getProjectMenuSections(projectItem.project)"
            @select="(item) => runProjectMenuAction(item.id, projectItem.project)"
          >
            <CollapsibleTrigger>
              <!-- Project row only toggles the tree; thread selection belongs to thread items. -->
              <div class="project-tree__project">
                <FolderIcon v-if="!open" :size="12" />
                <FolderOpenIcon v-else :size="12" />
                <span>{{ projectItem.project.name }}</span>
                <BaseIconButton
                  label="创建 Thread"
                  size="small"
                  :disabled="projectItem.project.status !== 'available'"
                  class="thread__add-btn"
                  @click.stop="createThreadInProject(projectItem.project.projectId)"
                >
                  <PlusIcon :size="14" />
                </BaseIconButton>
              </div>
            </CollapsibleTrigger>
          </BaseContextMenu>

          <CollapsibleContent>
            <ul class="session-group">
              <template v-if="projectItem.threads.length === 0">
                <li class="session-group__item is-empty">
                  <span class="session-group__item-title">暂无会话</span>
                </li>
              </template>

              <template v-else>
                <!-- 显示前 5 条，或者全部 -->
                <BaseContextMenu
                  v-for="threadItem in projectItem.threads.slice(
                    0,
                    getProjectExpansion(projectItem.project.projectId).displayCount
                  )"
                  :key="threadItem.thread.threadId"
                  :sections="threadMenuSections"
                  @select="(item) => runThreadMenuAction(item.id, threadItem.thread)"
                >
                  <li
                    class="session-group__item"
                    :class="{
                      'is-active': threadItem.thread.threadId === workspaceSession.activeSessionId
                    }"
                    @click="workspaceSession.setActiveSessionId(threadItem.thread.threadId)"
                  >
                    <span class="session-group__item-title">
                      {{ threadItem.thread.title || '新会话' }}
                    </span>
                    <span
                      v-if="threadItem.statusIndicator"
                      class="thread-status"
                      :class="`is-${threadItem.statusIndicator}`"
                      :aria-label="threadItem.statusLabel"
                      role="img"
                    >
                      <svg
                        v-if="threadItem.statusIndicator === 'running'"
                        class="thread-status__svg"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                      >
                        <circle class="thread-status__track" cx="8" cy="8" r="6.25" />
                        <circle class="thread-status__runner" cx="8" cy="8" r="6.25" />
                      </svg>
                      <svg v-else class="thread-status__svg" viewBox="0 0 16 16" aria-hidden="true">
                        <circle class="thread-status__error-ring" cx="8" cy="8" r="6.25" />
                        <path class="thread-status__error-mark" d="M8 4.75v4.2" />
                        <circle class="thread-status__error-dot" cx="8" cy="11.35" r="0.7" />
                      </svg>
                    </span>
                    <time
                      v-else-if="threadItem.updatedAtDistance"
                      class="thread-updated-at"
                      :datetime="threadItem.thread.updatedAt"
                    >
                      {{ threadItem.updatedAtDistance }}
                    </time>
                  </li>
                </BaseContextMenu>

                <!-- 展开/收起按钮 -->
                <li
                  v-if="
                    getProjectExpansion(projectItem.project.projectId).displayCount <
                      projectItem.threads.length ||
                    (getProjectExpansion(projectItem.project.projectId).hasExpanded &&
                      getProjectExpansion(projectItem.project.projectId).displayCount > 5)
                  "
                  class="session-group__expand-collapse"
                >
                  <button
                    v-if="getProjectExpansion(projectItem.project.projectId).displayCount < projectItem.threads.length"
                    class="expand-collapse-btn"
                    @click="expandProject(projectItem.project.projectId, projectItem.threads.length)"
                  >
                    {{
                      getExpandButtonText(
                        projectItem.threads.length,
                        getProjectExpansion(projectItem.project.projectId).displayCount
                      )
                    }}
                  </button>
                  <button
                    v-if="
                      getProjectExpansion(projectItem.project.projectId).hasExpanded &&
                      getProjectExpansion(projectItem.project.projectId).displayCount > 5
                    "
                    class="expand-collapse-btn collapse-btn"
                    @click="collapseProject(projectItem.project.projectId)"
                  >
                    收起
                  </button>
                </li>
              </template>
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
  background: var(--color-canvas);
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
    font-size: var(--font-size-ui-sm);
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
  color: var(--color-danger);
  font-size: var(--font-size-ui-xs);
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
  font-size: var(--font-size-ui-sm);
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
    font-size: var(--font-size-ui);
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
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  cursor: default;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:not(.is-empty):hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }

  &.is-active {
    color: var(--color-text);
    background: var(--color-item-active);
    border-color: var(--color-item-active-border);
  }

  &-title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--font-size-ui-sm);
    font-weight: 500;
  }

  &.is-empty {
    font-size: var(--font-size-ui-sm);
    color: var(--color-text-muted);
  }
}

.session-group__item {
  height: 28px;
}

.session-group__expand-collapse {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-2);
  margin: 0 var(--space-2);
  padding: 0 var(--space-3) 0 var(--space-8);
}

.expand-collapse-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;

  &:hover {
    color: var(--color-text);
  }
}

.collapse-btn {
  color: var(--color-text-subtle);

  &:hover {
    color: var(--color-text);
  }
}

.thread-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--color-text-muted);
}

.thread-updated-at {
  flex: 0 0 auto;
  color: var(--color-text-subtle, var(--color-text-muted));
  font-size: var(--font-size-ui-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.thread-status__svg {
  display: block;
  width: 14px;
  height: 14px;
  overflow: visible;
}

.thread-status__track,
.thread-status__runner,
.thread-status__error-ring {
  fill: none;
  stroke-width: 2;
}

.thread-status__track {
  stroke: currentColor;
  opacity: 0.22;
}

.thread-status__runner {
  animation: thread-status-spin 0.9s linear infinite;
  stroke: currentColor;
  stroke-dasharray: 22 40;
  stroke-linecap: round;
  transform-origin: 8px 8px;
}

.thread-status.is-error {
  color: var(--color-danger);
}

.thread-status__error-ring {
  animation: thread-status-error-pulse 1.4s var(--ease-standard) infinite;
  stroke: currentColor;
}

.thread-status__error-mark {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.8;
}

.thread-status__error-dot {
  animation: thread-status-error-dot 1.4s var(--ease-standard) infinite;
  fill: currentColor;
}

@keyframes thread-status-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes thread-status-error-pulse {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 1;
  }
}

@keyframes thread-status-error-dot {
  0%,
  100% {
    transform: scale(0.85);
  }

  50% {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .thread-status__runner,
  .thread-status__error-ring,
  .thread-status__error-dot {
    animation: none;
  }
}

.button-cell {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  height: 28px;
  margin: 0 var(--space-2) var(--space-2);
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  font: inherit;
  text-decoration: none;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

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
