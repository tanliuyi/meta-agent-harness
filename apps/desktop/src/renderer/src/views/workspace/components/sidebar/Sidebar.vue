<script setup lang="ts">
import { BaseContextMenu, BaseIconButton } from '@renderer/components/base'
import PlusIcon from '@renderer/components/icons/PlusIcon.vue'
import FolderIcon from '@renderer/components/icons/FolderIcon.vue'
import FolderOpenIcon from '@renderer/components/icons/FolderOpenIcon.vue'
import SettingIcon from '@renderer/components/icons/SettingIcon.vue'
import UpdateBanner from '@renderer/components/update/UpdateBanner.vue'
import { confirm } from '@renderer/composables/useConfirmDialog'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import useWorkspaceUiStore from '@renderer/stores/workspace-ui'
import { useWorkspaceViewSettings } from '@renderer/composables/useWorkspaceViewSettings'
import type { ProjectSummary, ProjectTrustDecision } from '@shared/coding-agent/types'
import type { WorkspaceSession } from '@renderer/stores/workspace-session'
import type { Component } from 'vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { LoaderCircle, Pencil, ShieldAlert, ShieldCheck, ShieldOff, Trash2 } from '@lucide/vue'
import { RouterLink, useRouter } from 'vue-router'
import NameCommandDialog from '@renderer/components/chat/composer/dialogs/NameCommandDialog.vue'
import SidebarThreadItem from './SidebarThreadItem.vue'
import {
  getExpandButtonText,
  getExpandedProjectThreadCount,
  getProjectThreads,
  type ProjectExpansion,
  type ProjectThreadItem
} from './support/sidebar-project-list'

withDefaults(
  defineProps<{
    visible?: boolean
  }>(),
  { visible: true }
)

type ThreadMenuActionId = 'copy-id' | 'rename' | 'open-parent' | 'locate-current-leaf' | 'archive'
type ProjectMenuActionId = 'new-thread' | 'rename-project' | 'delete-project' | 'project-trust'

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

interface ProjectListItem {
  project: ProjectSummary
  threads: ProjectThreadItem[]
  visibleThreads: ProjectThreadItem[]
  expansion: Readonly<ProjectExpansion>
  hasRunningThread: boolean
  canExpand: boolean
  canCollapse: boolean
  expandButtonText: string
}

const workspaceProject = useWorkspaceProjectStore()

const workspaceSession = useWorkspaceSessionStore()
const workspaceUi = useWorkspaceUiStore()
const router = useRouter()
const { threadSortMode } = useWorkspaceViewSettings()
const renameThreadDialogOpen = ref(false)
const renameThreadTarget = ref<WorkspaceSession>()
const renameThreadDraft = ref('')
const renameProjectDialogOpen = ref(false)
const renameProjectTarget = ref<ProjectSummary>()
const renameProjectDraft = ref('')
const projectsLoading = ref(true)
const threadsLoading = ref(true)
const expandedProjects = ref<Record<string, { displayCount: number; hasExpanded: boolean }>>({})
const defaultProjectExpansion: Readonly<ProjectExpansion> = Object.freeze({
  displayCount: 5,
  hasExpanded: false
})

async function loadProjects(): Promise<void> {
  projectsLoading.value = true
  try {
    await workspaceProject.loadProjects()
  } finally {
    projectsLoading.value = false
  }
}

async function loadThreads(): Promise<void> {
  threadsLoading.value = true
  try {
    await workspaceSession.loadThreads()
  } finally {
    threadsLoading.value = false
  }
}

void loadProjects()
void loadThreads()

function readProjectExpansion(projectId: string): Readonly<ProjectExpansion> {
  return expandedProjects.value[projectId] ?? defaultProjectExpansion
}

function ensureProjectExpansion(projectId: string): ProjectExpansion {
  if (!expandedProjects.value[projectId]) {
    expandedProjects.value[projectId] = { displayCount: 5, hasExpanded: false }
  }
  return expandedProjects.value[projectId]
}

function expandProject(projectId: string, totalCount: number, increment: number = 10): void {
  const expansion = ensureProjectExpansion(projectId)
  expansion.displayCount = getExpandedProjectThreadCount(expansion, totalCount, increment)
  expansion.hasExpanded = true
}

function collapseProject(projectId: string): void {
  const expansion = ensureProjectExpansion(projectId)
  expansion.displayCount = 5
}

const currentTime = ref(Date.now())
let currentTimeTimer: number | undefined

const projectListItems = computed<ProjectListItem[]>(() => {
  return workspaceProject.projectList.map((project) => {
    const projectThreads = workspaceSession.sessionsByProject[project.projectId] ?? []
    const threads = getProjectThreads(projectThreads, threadSortMode.value)
    const expansion = readProjectExpansion(project.projectId)
    const visibleThreads = threads.slice(0, expansion.displayCount)
    return {
      project,
      threads,
      visibleThreads,
      expansion,
      hasRunningThread: threads.some((threadItem) => threadItem.thread.status === 'running'),
      canExpand: expansion.displayCount < threads.length,
      canCollapse: expansion.hasExpanded && expansion.displayCount > 5,
      expandButtonText: getExpandButtonText(threads.length, expansion.displayCount)
    }
  })
})

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
    actions.push({ label: '信任项目', value: 'trustProject' })
    if (project.trust.parentPath) {
      actions.push({ label: '信任父目录', value: 'trustParent' })
    }
    actions.push({ label: '本次信任', value: 'trustSession' })
  }
  actions.push({ label: '不信任', value: 'doNotTrust', tone: 'destructive' })

  const result = await confirm({
    actions,
    cancelText: '取消',
    description: `${getProjectTrustDescription(project)}。项目路径：${project.path}`,
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

async function runThreadMenuAction(
  actionId: ThreadMenuActionId,
  thread: WorkspaceSession
): Promise<void> {
  switch (actionId) {
    case 'copy-id':
      await navigator.clipboard.writeText(thread.threadId)
      return
    case 'rename':
      openRenameThreadDialog(thread)
      return
    case 'open-parent':
      await workspaceSession.openParentSession(thread.threadId)
      return
    case 'locate-current-leaf':
      await workspaceSession.setActiveSessionId(thread.threadId)
      if (thread.snapshot?.currentEntryId) {
        workspaceSession.focusActiveSessionTreeEntry(thread.snapshot.currentEntryId)
      }
      return
    case 'archive':
      await archiveThread(thread)
      return
  }
}

async function navigateThreadLeaf(thread: WorkspaceSession, entryId: string): Promise<void> {
  await workspaceSession.setActiveSessionId(thread.threadId)
  await workspaceSession.navigateActiveSessionTree(entryId)
}

function openRenameThreadDialog(thread: WorkspaceSession): void {
  renameThreadTarget.value = thread
  renameThreadDraft.value = thread.title?.trim() ?? ''
  renameThreadDialogOpen.value = true
}

async function submitRenameThreadDialog(): Promise<void> {
  const thread = renameThreadTarget.value
  const nextName = renameThreadDraft.value.trim()
  if (!thread || !nextName) {
    return
  }
  await workspaceSession.runCommand('name', nextName, thread.threadId)
  renameThreadDialogOpen.value = false
  renameThreadTarget.value = undefined
  renameThreadDraft.value = ''
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

async function runProjectMenuAction(
  actionId: ProjectMenuActionId,
  project: ProjectSummary
): Promise<void> {
  switch (actionId) {
    case 'new-thread': {
      const projectId = project.projectId
      void router.push({ name: 'WorkspaceNew', query: { projectId } })
      return
    }
    case 'rename-project':
      renameProjectTarget.value = project
      renameProjectDraft.value = project.name
      renameProjectDialogOpen.value = true
      return
    case 'delete-project':
      await deleteProject(project)
      return
    case 'project-trust':
      await requestProjectTrust(project)
      return
  }
}

async function submitRenameProjectDialog(): Promise<void> {
  const project = renameProjectTarget.value
  const name = renameProjectDraft.value.trim()
  if (!project || !name) {
    return
  }
  await workspaceProject.renameProject(project.projectId, name)
  if (!workspaceProject.errorMessage) {
    renameProjectDialogOpen.value = false
    renameProjectTarget.value = undefined
    renameProjectDraft.value = ''
  }
}

async function deleteProject(project: ProjectSummary): Promise<void> {
  const result = await confirm({
    actions: [{ label: '删除项目', value: 'delete', tone: 'destructive' }],
    cancelText: '取消',
    description: `将删除 Meta Agent 中的项目配置和全部会话（包括已归档会话）。不会删除真实项目目录：${project.path}`,
    id: `delete-project-${project.projectId}`,
    title: `删除项目“${project.name}”？`,
    tone: 'destructive'
  })
  if (!result.confirmed || result.action !== 'delete') {
    return
  }
  if (await workspaceProject.deleteProject(project.projectId)) {
    delete expandedProjects.value[project.projectId]
    await workspaceSession.loadThreads()
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
        },
        {
          id: 'rename-project',
          label: '重命名项目',
          icon: Pencil
        },
        {
          id: 'delete-project',
          label: '删除项目',
          icon: Trash2,
          danger: true
        }
      ]
    }
  ]

  if (project.trust?.requiresTrust) {
    sections.push({
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
  <aside v-show="visible" class="workspace__sidebar">
    <div class="sidebar-section__header">
      <span>工作空间</span>
      <span class="sidebar-tooltip-trigger project-tree__add-btn">
        <BaseIconButton
          label="添加项目"
          size="small"
          :disabled="projectsLoading"
          @click="createProject"
        >
          <PlusIcon :size="14" />
        </BaseIconButton>
      </span>
    </div>
    <ScrollArea class="sidebar-section">
      <div v-if="projectsLoading" class="sidebar-loading" role="status" aria-live="polite">
        <LoaderCircle class="sidebar-loading__icon" :size="14" aria-hidden="true" />
        <span>正在加载项目</span>
      </div>

      <template v-else-if="workspaceProject.errorMessage">
        <p class="sidebar-error">
          {{ workspaceProject.errorMessage }}
        </p>
      </template>

      <ul v-else class="project-tree">
        <Collapsible
          v-for="projectItem in projectListItems"
          :key="projectItem.project.projectId"
          v-slot="{ open }"
          :open="workspaceUi.isProjectOpen(projectItem.project.projectId)"
          class="project-tree__item"
          @update:open="(open) => workspaceUi.setProjectOpen(projectItem.project.projectId, open)"
        >
          <BaseContextMenu
            :sections="getProjectMenuSections(projectItem.project)"
            @select="
              (item) => runProjectMenuAction(item.id as ProjectMenuActionId, projectItem.project)
            "
          >
            <CollapsibleTrigger>
              <!-- Project row only toggles the tree; thread selection belongs to thread items. -->
              <div class="project-tree__project">
                <FolderIcon v-if="!open" :size="12" />
                <FolderOpenIcon v-else :size="12" />
                <span class="project-tree__project-name">{{ projectItem.project.name }}</span>
                <span
                  v-if="!open && projectItem.hasRunningThread"
                  class="thread-status project-tree__running-status is-running"
                  aria-label="运行中"
                  role="img"
                >
                  <svg class="thread-status__svg" viewBox="0 0 16 16" aria-hidden="true">
                    <circle class="thread-status__track" cx="8" cy="8" r="6.25" />
                    <circle class="thread-status__runner" cx="8" cy="8" r="6.25" />
                  </svg>
                </span>
                <span class="sidebar-tooltip-trigger thread__add-btn">
                  <BaseIconButton
                    label="添加会话"
                    size="small"
                    :disabled="projectItem.project.status !== 'available'"
                    @click.stop="
                      $router.push({
                        name: 'WorkspaceNew',
                        query: { projectId: projectItem.project.projectId }
                      })
                    "
                  >
                    <PlusIcon :size="14" />
                  </BaseIconButton>
                </span>
              </div>
            </CollapsibleTrigger>
          </BaseContextMenu>

          <CollapsibleContent>
            <ul class="session-group">
              <template v-if="threadsLoading">
                <li
                  class="session-group__item is-empty is-loading"
                  role="status"
                  aria-live="polite"
                >
                  <LoaderCircle class="sidebar-loading__icon" :size="14" aria-hidden="true" />
                  <span class="session-group__item-title">正在加载会话</span>
                </li>
              </template>

              <template v-else-if="projectItem.threads.length === 0">
                <li class="session-group__item is-empty">
                  <span class="session-group__item-title">暂无会话</span>
                </li>
              </template>

              <template v-else>
                <SidebarThreadItem
                  v-for="threadItem in projectItem.visibleThreads"
                  :key="threadItem.thread.threadId"
                  :active="$route.params.sessionId === threadItem.thread.threadId"
                  :current-time="currentTime"
                  :depth="threadItem.depth"
                  :thread="threadItem.thread"
                  @menu-action="runThreadMenuAction"
                  @navigate-leaf="navigateThreadLeaf"
                  @select-thread="
                    (sessionId) =>
                      $router.push({ name: `WorkspaceSession`, params: { sessionId: sessionId } })
                  "
                />

                <li
                  v-if="projectItem.canExpand || projectItem.canCollapse"
                  class="session-group__expand-collapse"
                >
                  <button
                    v-if="projectItem.canExpand"
                    class="expand-collapse-btn"
                    @click="
                      expandProject(projectItem.project.projectId, projectItem.threads.length)
                    "
                  >
                    {{ projectItem.expandButtonText }}
                  </button>
                  <button
                    v-if="projectItem.canCollapse"
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
      <UpdateBanner />
      <RouterLink to="/settings" class="button-cell">
        <SettingIcon :size="12" />
        <span>设置</span>
      </RouterLink>
    </div>
  </aside>

  <NameCommandDialog
    v-model:open="renameThreadDialogOpen"
    v-model="renameThreadDraft"
    @submit="submitRenameThreadDialog"
  />
  <NameCommandDialog
    v-model:open="renameProjectDialogOpen"
    v-model="renameProjectDraft"
    title="重命名项目"
    description="设置 Meta Agent 中显示的项目别名，不会修改真实目录名称。"
    label="项目别名"
    placeholder="例如：桌面客户端"
    @submit="submitRenameProjectDialog"
  />
</template>

<style lang="scss" scoped>
.workspace__sidebar {
  --sidebar-cyan: color-mix(in srgb, var(--color-primary) 82%, #35f2e5);
  --sidebar-amber: color-mix(in srgb, var(--color-warning, #ffcc4a) 84%, #ff4fd8);

  position: relative;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  min-height: 0;
  padding: var(--space-4) 0 0;
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-canvas);
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

.sidebar-tooltip-trigger {
  display: inline-flex;
}

.sidebar-section__header {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  height: 2.4em;
  padding: 0 var(--space-6);
  font-family: var(--font-mono);

  span {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
    font-weight: 750;
    letter-spacing: 0;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:first-child {
      margin-right: auto;
    }
  }

  .project-tree__add-btn {
    display: none;
    margin-left: auto;
  }

  &:hover,
  &:focus-within {
    .project-tree__add-btn {
      display: flex;
    }
  }
}

.sidebar-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-ui-xs);
}

.sidebar-loading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 2.2em;
  margin: 0 var(--space-2);
  padding: 0 var(--space-3);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-xs);
}

.sidebar-loading__icon {
  flex: 0 0 auto;
  animation: sidebar-loading-spin 0.9s linear infinite;
}

@keyframes sidebar-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

.session-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-tree {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-tree__item {
  position: relative;
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
  height: 2.2em;
  margin: 0 var(--space-2);
  padding: 0 var(--space-1);
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  transition:
    color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: color-mix(in srgb, var(--sidebar-cyan) 7%, var(--color-surface-raised));
    border-color: color-mix(in srgb, var(--sidebar-cyan) 30%, var(--color-border));
  }

  svg {
    width: 1.2em;
    height: 1.2em;
  }

  .project-tree__project-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-size-ui);
    color: var(--color-text);
    font-weight: 560;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: start;
  }

  .thread__add-btn {
    display: none;
  }

  &:hover,
  &:focus-within {
    .thread__add-btn {
      display: flex;
    }
  }
}

.session-group__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  margin: 0 var(--space-2);
  padding: var(--space-1) var(--space-3) var(--space-1)
    calc(var(--space-8) + var(--thread-indent, 0px));
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  cursor: default;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:not(.is-empty):hover {
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface-raised) 72%, transparent);
    border-color: var(--color-border-muted);
  }

  &.is-active {
    color: var(--color-text);
    background: color-mix(in srgb, var(--sidebar-cyan) 9%, var(--color-surface-raised));
    border-color: color-mix(in srgb, var(--sidebar-cyan) 34%, var(--color-border));
    box-shadow: inset 2px 0 0 var(--sidebar-cyan);
  }

  &-content {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &-main {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
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

  &-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    color: var(--color-text-subtle, var(--color-text-muted));
    font-size: var(--font-size-ui-xs);
    line-height: 1.25;

    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  &.is-empty {
    font-size: var(--font-size-ui-sm);
    color: var(--color-text-muted);
  }
}

.session-group__item {
  min-height: 28px;
}

.session-group__leaf-shortcuts {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 2px 0 1px;

  button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
    height: 22px;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    background: var(--color-surface);
    font: inherit;
    text-align: left;

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-raised);
    }
  }

  span,
  small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    font-size: var(--font-size-ui-xs);
    font-weight: 560;
  }

  small {
    color: var(--color-text-subtle, var(--color-text-muted));
    font-size: var(--font-size-ui-2xs);
  }
}

.session-group__expand-collapse {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-2);
  height: 2.4em;
  margin: 0 calc(var(--space-2) + 6px);
  padding: 0 var(--space-3) 0 var(--space-5);
}

.expand-collapse-btn {
  padding: 0;
  margin: 0;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-xs);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: none;

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
  .sidebar-loading__icon,
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
  height: 2.4em;
  margin: 0 var(--space-2) var(--space-5);
  padding: 0 var(--space-3);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  font: inherit;
  text-decoration: none;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: color-mix(in srgb, var(--sidebar-cyan) 7%, var(--color-surface-raised));
    border-color: color-mix(in srgb, var(--sidebar-cyan) 28%, var(--color-border));
  }

  &.router-link-active {
    color: var(--sidebar-cyan);
    background: color-mix(in srgb, var(--sidebar-cyan) 9%, transparent);
    border-color: color-mix(in srgb, var(--sidebar-cyan) 36%, var(--color-border));
  }
}
</style>
