<script setup lang="ts">
/**
 * SessionPanel.vue - 当前活跃会话的右侧面板组件。
 *
 * 展示会话状态、Project、会话文件以及待处理的审批请求与最近事件。
 */

import { BaseButton, BaseIconButton, BaseSegmentedControl } from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import DiffViewer from '@renderer/components/chat/messages/tools/DiffViewer.vue'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type {
  ApprovalRequest,
  ApprovalResponse,
  CommandInfo,
  ExtensionUiRequest,
  ThreadSnapshot
} from '@shared/coding-agent/types'
import { computed, onMounted, ref, watch } from 'vue'

const workspaceProject = useWorkspaceProjectStore()
const workspaceSession = useWorkspaceSessionStore()

/** 当前会话所属 Project。 */
const sessionProject = computed(() => {
  const projectId = workspaceSession.activeSession?.projectId
  return projectId ? workspaceProject.projects[projectId] : undefined
})

/** 当前待处理审批列表。 */
const pendingApprovals = computed(() => Object.values(workspaceSession.activePendingApprovals))

/** 是否存在待处理审批。 */
const hasPendingApprovals = computed(() => pendingApprovals.value.length > 0)

/** 当前待处理 extension UI 请求列表。 */
const extensionUiRequests = computed(() => Object.values(workspaceSession.activeExtensionUiRequests))

/** 是否存在待处理 extension UI 请求。 */
const hasExtensionUiRequests = computed(() => extensionUiRequests.value.length > 0)

/** 当前 extension 状态条目。 */
const extensionStatuses = computed(() =>
  Object.entries(workspaceSession.activeExtensionStatuses).filter(([, value]) => value)
)

/** 当前 extension widgets。 */
const extensionWidgets = computed(() => Object.entries(workspaceSession.activeExtensionWidgets))

type SessionTreeNode = NonNullable<ThreadSnapshot['sessionTree']>[number]
type FileChange = ThreadSnapshot['fileChanges'][number]
type ApprovalScope = ApprovalResponse['scope']
type OnOffValue = 'on' | 'off'
type SessionPanelTabId = 'session' | 'changes' | 'tree' | 'commands' | 'extensions' | 'approvals'

interface SessionPanelTab {
  id: SessionPanelTabId
  label: string
}

type FlatSessionTreeNode = {
  node: SessionTreeNode
  depth: number
}

/** 当前活跃 session leaf entry，可作为 fork 默认位置。 */
const currentEntryId = computed(() => workspaceSession.activeSnapshot?.currentEntryId)

/** 当前 session tree 的扁平展示数据。 */
const sessionTreeRows = computed<FlatSessionTreeNode[]>(() =>
  flattenSessionTree(workspaceSession.activeSnapshot?.sessionTree ?? [])
)

/** 当前文件变更列表。 */
const fileChanges = computed(() => workspaceSession.activeSnapshot?.fileChanges ?? [])

/** 选中的文件变更。 */
const selectedFileChangeId = ref<string>()

/** 当前选中的文件变更。 */
const selectedFileChange = computed(() => {
  const changes = fileChanges.value
  return (
    changes.find((change) => getFileChangeId(change) === selectedFileChangeId.value) ??
    changes[0]
  )
})

/** 当前选中文件变更的 diff。 */
const selectedReviewDiff = computed(() => getReviewDiff(selectedFileChange.value))

/** 文件变更统计。 */
const fileChangeStats = computed(() =>
  fileChanges.value.reduce(
    (stats, change) => ({
      additions: stats.additions + (change.additions ?? 0),
      deletions: stats.deletions + (change.deletions ?? 0)
    }),
    { additions: 0, deletions: 0 }
  )
)

/** 当前是否有可操作 thread。 */
const hasActiveThread = computed(() => Boolean(workspaceSession.activeSessionId))

/** 当前模型展示名。 */
const activeModelLabel = computed(() => {
  const model = workspaceSession.activeSnapshot?.model
  if (!model) return '-'
  return model.displayName || `${model.provider}/${model.id}`
})

/** 当前 thinking level 展示名。 */
const activeThinkingLabel = computed(() => workspaceSession.activeSnapshot?.thinkingLevel ?? '-')

/** 当前自动压缩状态。 */
const autoCompactionValue = computed<OnOffValue>(() =>
  workspaceSession.activeSnapshot?.autoCompactionEnabled === false ? 'off' : 'on'
)

const onOffOptions: Array<{ label: string; value: OnOffValue }> = [
  { label: 'On', value: 'on' },
  { label: 'Off', value: 'off' }
]

const sessionPanelTabs: SessionPanelTab[] = [
  { id: 'session', label: 'Session' },
  { id: 'changes', label: 'Changes' },
  { id: 'tree', label: 'Tree' },
  { id: 'commands', label: 'Commands' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'approvals', label: 'Approvals' }
]

const SESSION_PANEL_TABS_STORAGE_KEY = 'meta-agent.session-panel.tabs'
const SESSION_PANEL_ACTIVE_TAB_STORAGE_KEY = 'meta-agent.session-panel.active-tab'

const activeTabId = ref<SessionPanelTabId>('session')
const openTabIds = ref<SessionPanelTabId[]>(sessionPanelTabs.map((tab) => tab.id))
const attentionTabIds = ref<SessionPanelTabId[]>([])

const openTabs = computed(() =>
  sessionPanelTabs.filter((tab) => openTabIds.value.includes(tab.id))
)
const closedTabs = computed(() =>
  sessionPanelTabs.filter((tab) => !openTabIds.value.includes(tab.id))
)

/** extension input/editor 的本地草稿。 */
const extensionDrafts = ref<Record<string, string>>({})

/** approval 作用域草稿。 */
const approvalScopeDrafts = ref<Record<string, ApprovalScope>>({})

/** 用户输入的 session 文件路径。 */
const sessionPathDraft = ref('')

onMounted(() => {
  const persistedTabs = readStoredTabs()
  const persistedActiveTab = readStoredTab(SESSION_PANEL_ACTIVE_TAB_STORAGE_KEY)

  if (persistedTabs) {
    openTabIds.value = persistedTabs
  }
  if (persistedActiveTab) {
    selectTab(persistedActiveTab)
  }
})

watch(
  () => workspaceSession.activeSessionId,
  (threadId) => {
    if (threadId) {
      void workspaceSession.loadCommands(threadId)
    }
  },
  { immediate: true }
)

watch(
  openTabIds,
  (tabIds) => {
    window.localStorage.setItem(SESSION_PANEL_TABS_STORAGE_KEY, JSON.stringify(tabIds))
  },
  { deep: true }
)

watch(activeTabId, (tabId) => {
  window.localStorage.setItem(SESSION_PANEL_ACTIVE_TAB_STORAGE_KEY, tabId)
  clearTabAttention(tabId)
})

watch(
  () => pendingApprovals.value.length,
  (count, previousCount) => {
    if (count > previousCount) {
      markTabAttention('approvals')
    }
  }
)

watch(
  () => extensionUiRequests.value.length,
  (count, previousCount) => {
    if (count > previousCount) {
      markTabAttention('extensions')
    }
  }
)

/**
 * 获取 command 展示名。
 * @param command - command。
 * @returns 展示名。
 */
function getCommandName(command: CommandInfo): string {
  return command.name
}

/**
 * 获取 command 辅助文本。
 * @param command - command。
 * @returns 辅助文本。
 */
function getCommandDescription(command: CommandInfo): string {
  return command.description || command.source
}

function getTabCount(tabId: SessionPanelTabId): number | undefined {
  switch (tabId) {
    case 'changes':
      return fileChanges.value.length || undefined
    case 'tree':
      return sessionTreeRows.value.length || undefined
    case 'commands':
      return workspaceSession.activeCommands.length || undefined
    case 'extensions':
      return extensionUiRequests.value.length + extensionStatuses.value.length + extensionWidgets.value.length || undefined
    case 'approvals':
      return pendingApprovals.value.length || undefined
    case 'session':
      return undefined
  }
}

function readStoredTab(key: string): SessionPanelTabId | undefined {
  const value = window.localStorage.getItem(key)
  return isSessionPanelTabId(value) ? value : undefined
}

function readStoredTabs(): SessionPanelTabId[] | undefined {
  const value = window.localStorage.getItem(SESSION_PANEL_TABS_STORAGE_KEY)
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return undefined
    }
    const tabIds = parsed.filter(isSessionPanelTabId)
    return tabIds.length > 0 ? Array.from(new Set(tabIds)) : undefined
  } catch {
    return undefined
  }
}

function isSessionPanelTabId(value: unknown): value is SessionPanelTabId {
  return sessionPanelTabs.some((tab) => tab.id === value)
}

function isTabAttention(tabId: SessionPanelTabId): boolean {
  return attentionTabIds.value.includes(tabId)
}

function markTabAttention(tabId: SessionPanelTabId): void {
  if (activeTabId.value === tabId) {
    return
  }
  if (!attentionTabIds.value.includes(tabId)) {
    attentionTabIds.value = [...attentionTabIds.value, tabId]
  }
}

function clearTabAttention(tabId: SessionPanelTabId): void {
  if (!attentionTabIds.value.includes(tabId)) {
    return
  }
  attentionTabIds.value = attentionTabIds.value.filter((id) => id !== tabId)
}

function selectTab(tabId: SessionPanelTabId): void {
  if (!openTabIds.value.includes(tabId)) {
    openTabIds.value = [...openTabIds.value, tabId]
  }
  activeTabId.value = tabId
  clearTabAttention(tabId)
}

function closeTab(tabId: SessionPanelTabId): void {
  const currentIndex = openTabIds.value.indexOf(tabId)
  const nextOpenTabs = openTabIds.value.filter((id) => id !== tabId)
  openTabIds.value = nextOpenTabs
  if (activeTabId.value !== tabId) {
    return
  }
  activeTabId.value =
    nextOpenTabs[Math.min(currentIndex, nextOpenTabs.length - 1)] ??
    nextOpenTabs[currentIndex - 1] ??
    sessionPanelTabs.find((tab) => tab.id !== tabId)?.id ??
    'session'
}

function moveActiveTab(fromTabId: SessionPanelTabId, direction: 1 | -1): void {
  if (openTabIds.value.length === 0) {
    return
  }
  const currentIndex = Math.max(0, openTabIds.value.indexOf(fromTabId))
  const nextIndex = (currentIndex + direction + openTabIds.value.length) % openTabIds.value.length
  activeTabId.value = openTabIds.value[nextIndex] ?? activeTabId.value
}

function handleTabKeydown(event: KeyboardEvent, tabId: SessionPanelTabId): void {
  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault()
      moveActiveTab(tabId, 1)
      return
    case 'ArrowLeft':
      event.preventDefault()
      moveActiveTab(tabId, -1)
      return
    case 'Home':
      event.preventDefault()
      activeTabId.value = openTabIds.value[0] ?? activeTabId.value
      return
    case 'End':
      event.preventDefault()
      activeTabId.value = openTabIds.value.at(-1) ?? activeTabId.value
      return
    case 'Backspace':
    case 'Delete':
      event.preventDefault()
      closeTab(tabId)
      return
  }
}

/**
 * 获取 extension UI 请求标题。
 * @param request - extension UI 请求。
 * @returns 标题。
 */
function getExtensionRequestTitle(request: ExtensionUiRequest): string {
  return 'title' in request ? request.title : request.type
}

/**
 * 将 session tree 展平，保留层级。
 * @param nodes - tree nodes。
 * @param depth - 当前层级。
 * @returns 展平后的节点。
 */
function flattenSessionTree(nodes: SessionTreeNode[], depth = 0): FlatSessionTreeNode[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenSessionTree(node.children, depth + 1)
  ])
}

/**
 * 获取 file change 稳定 ID。
 * @param change - 文件变更。
 * @returns ID。
 */
function getFileChangeId(change: FileChange): string {
  return `${change.toolCallId ?? change.createdAt}:${change.path}`
}

/**
 * 判断 file change 是否当前选中。
 * @param change - 文件变更。
 * @returns 是否选中。
 */
function isSelectedFileChange(change: FileChange): boolean {
  return selectedFileChange.value
    ? getFileChangeId(change) === getFileChangeId(selectedFileChange.value)
    : false
}

/**
 * 获取 file change 文件名。
 * @param path - 路径。
 * @returns 文件名。
 */
function getFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/**
 * 获取 file change 可展示 diff。
 * @param change - 文件变更。
 * @returns diff 文本。
 */
function getReviewDiff(change: FileChange | undefined): string | undefined {
  return change?.diff || change?.patch
}

function getApprovalScope(approval: ApprovalRequest): ApprovalScope {
  return approvalScopeDrafts.value[approval.approvalId] ?? approval.scope
}

function setApprovalScope(approval: ApprovalRequest, scope: ApprovalScope): void {
  approvalScopeDrafts.value = {
    ...approvalScopeDrafts.value,
    [approval.approvalId]: scope
  }
}

async function respondApproval(
  approval: ApprovalRequest,
  input: Pick<ApprovalResponse, 'allow' | 'choice' | 'reason'>
): Promise<void> {
  const scope = getApprovalScope(approval)
  await workspaceSession.respondApproval(approval, { ...input, scope })
  const next = { ...approvalScopeDrafts.value }
  delete next[approval.approvalId]
  approvalScopeDrafts.value = next
}

function getApprovalRiskLabel(risk: ApprovalRequest['risk']): string {
  switch (risk) {
    case 'high':
      return '高风险'
    case 'medium':
      return '中风险'
    case 'low':
      return '低风险'
  }
}

function getApprovalScopeLabel(scope: ApprovalScope): string {
  switch (scope) {
    case 'workspace':
      return '工作区'
    case 'thread':
      return '线程'
    case 'once':
      return '一次'
  }
}

/**
 * 格式化重试延迟。
 * @param delayMs - 延迟毫秒数。
 * @returns 展示文本。
 */
function formatRetryDelay(delayMs: number): string {
  if (delayMs < 1000) return `${delayMs}ms`
  return `${Math.round(delayMs / 1000)}s`
}

/**
 * 切换到输入的 session 路径。
 */
async function switchSessionFromDraft(): Promise<void> {
  await workspaceSession.switchActiveSessionPath(sessionPathDraft.value)
}

/**
 * 设置自动压缩状态。
 * @param value - 新状态。
 */
async function setAutoCompactionValue(value: OnOffValue): Promise<void> {
  await workspaceSession.setActiveAutoCompaction(value === 'on')
}

/**
 * 获取 extension request 的输入草稿。
 * @param request - extension UI 请求。
 * @returns 草稿文本。
 */
function getExtensionDraft(request: ExtensionUiRequest): string {
  if (extensionDrafts.value[request.id] === undefined) {
    extensionDrafts.value[request.id] = request.type === 'editor' ? (request.prefill ?? '') : ''
  }
  return extensionDrafts.value[request.id]
}

/**
 * 更新 extension request 的输入草稿。
 * @param id - 请求 ID。
 * @param value - 草稿文本。
 */
function setExtensionDraft(id: string, value: string): void {
  extensionDrafts.value = {
    ...extensionDrafts.value,
    [id]: value
  }
}

/**
 * 响应 extension UI 请求。
 * @param request - 请求。
 * @param value - 响应值。
 */
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
    return
  }
  await workspaceSession.respondExtensionUi(threadId, {
    id: request.id,
    value: typeof value === 'string' ? value : getExtensionDraft(request)
  })
}

/**
 * 取消 extension UI 请求。
 * @param request - 请求。
 */
async function cancelExtensionRequest(request: ExtensionUiRequest): Promise<void> {
  const threadId = workspaceSession.activeSessionId
  if (!threadId) {
    return
  }
  await workspaceSession.respondExtensionUi(threadId, { id: request.id, cancelled: true })
}

/** 是否折叠面板。 */
defineProps<{
  collapsed?: boolean
}>()

/** 切换面板折叠状态。 */
defineEmits<{
  toggle: []
}>()
</script>

<template>
  <section class="session-panel" :class="{ 'session-panel--collapsed': collapsed }">
    <header class="session-panel__header">
      <div class="session-panel__tabs" role="tablist" aria-label="Session panel">
        <div
          v-for="tab in openTabs"
          :key="tab.id"
          class="session-panel__tab"
          :class="{ 'is-active': activeTabId === tab.id, 'has-attention': isTabAttention(tab.id) }"
        >
          <button
            type="button"
            class="session-panel__tab-main"
            role="tab"
            :aria-selected="activeTabId === tab.id"
            @click="selectTab(tab.id)"
            @keydown="handleTabKeydown($event, tab.id)"
          >
            <span>{{ tab.label }}</span>
            <small v-if="getTabCount(tab.id)">{{ getTabCount(tab.id) }}</small>
          </button>
          <button
            class="session-panel__tab-close"
            type="button"
            tabindex="-1"
            :aria-label="`关闭 ${tab.label}`"
            @click.stop="closeTab(tab.id)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        </div>
        <button
          v-for="tab in closedTabs"
          :key="`restore-${tab.id}`"
          type="button"
          class="session-panel__tab is-closed"
          :class="{ 'has-attention': isTabAttention(tab.id) }"
          @click="selectTab(tab.id)"
        >
          <span>+ {{ tab.label }}</span>
          <small v-if="getTabCount(tab.id)">{{ getTabCount(tab.id) }}</small>
        </button>
      </div>
      <div class="session-panel__actions">
        <BaseIconButton
          class="session-panel__collapse"
          :active="!collapsed"
          :label="collapsed ? '展开会话面板' : '收起会话面板'"
          @click="$emit('toggle')"
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
          >
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </BaseIconButton>
      </div>
    </header>

    <div v-if="!collapsed" class="session-panel__body">
      <ScrollArea class="session-panel__scroll">
        <div v-if="openTabs.length === 0" class="session-panel__empty-tabs">
          选择上方的 + tab 恢复面板
        </div>

        <section v-if="activeTabId === 'session'" class="session-section" role="tabpanel">
          <header class="session-section__header">
            <h3>Session</h3>
          </header>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{{ workspaceSession.activeSession?.status ?? 'new' }}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{{ sessionProject?.name ?? '-' }}</dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd>{{ workspaceSession.activeSnapshot?.sessionFile ?? '-' }}</dd>
            </div>
          </dl>
          <div class="session-browser-summary">
            <div>
              <span>Entries</span>
              <strong>{{ sessionTreeRows.length }}</strong>
            </div>
            <div>
              <span>Leaf</span>
              <strong>{{ currentEntryId ?? '-' }}</strong>
            </div>
          </div>
          <div class="session-primary-actions">
            <BaseButton
              size="sm"
              variant="primary"
              :disabled="!hasActiveThread"
              @click="workspaceSession.newActiveSession()"
            >
              New
            </BaseButton>
            <BaseButton
              size="sm"
              variant="secondary"
              @click="workspaceSession.compactActive()"
              :disabled="!hasActiveThread"
            >
              Compact
            </BaseButton>
            <BaseButton
              size="sm"
              variant="secondary"
              :disabled="!hasActiveThread"
              @click="workspaceSession.exportActiveSession()"
            >
              Export
            </BaseButton>
          </div>
          <div class="session-secondary-actions">
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="!hasActiveThread"
              @click="workspaceSession.importActiveSessionFromPicker()"
            >
              Import
            </BaseButton>
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="!hasActiveThread"
              @click="workspaceSession.cloneActiveSession()"
            >
              Clone
            </BaseButton>
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="!hasActiveThread || !currentEntryId"
              @click="currentEntryId && workspaceSession.forkActiveSession(currentEntryId)"
            >
              Fork
            </BaseButton>
          </div>
          <div class="session-path-form">
            <BaseField
              id="session-switch-path"
              v-model="sessionPathDraft"
              label="Session path"
              placeholder="/path/to/session.jsonl"
              hint="切换到已有 Pi-compatible session 文件"
            />
            <BaseButton
              size="sm"
              :disabled="!hasActiveThread || !sessionPathDraft.trim()"
              @click="switchSessionFromDraft"
            >
              Switch
            </BaseButton>
          </div>
          <p v-if="workspaceSession.activeSessionActionMessage" class="session-action-message">
            {{ workspaceSession.activeSessionActionMessage }}
          </p>
          <div v-if="workspaceSession.activeExportResult" class="export-result">
            <div>
              <span>HTML export</span>
              <strong>{{ getFileName(workspaceSession.activeExportResult.path) }}</strong>
            </div>
            <div class="export-result__actions">
              <BaseButton size="sm" variant="primary" @click="workspaceSession.openActiveExport()">
                Open
              </BaseButton>
              <BaseButton size="sm" variant="ghost" @click="workspaceSession.revealActiveExport()">
                Show
              </BaseButton>
            </div>
          </div>
        </section>

        <section v-if="activeTabId === 'session'" class="session-section" role="tabpanel">
          <header class="session-section__header">
            <h3>Runtime</h3>
          </header>

          <div class="runtime-summary">
            <div>
              <span>Model</span>
              <strong>{{ activeModelLabel }}</strong>
            </div>
            <div>
              <span>Thinking</span>
              <strong>{{ activeThinkingLabel }}</strong>
            </div>
          </div>

          <div class="runtime-control-list">
            <BaseButton
              size="sm"
              variant="secondary"
              :disabled="!hasActiveThread"
              @click="workspaceSession.cycleActiveModel()"
            >
              Cycle model
            </BaseButton>
            <BaseButton
              size="sm"
              variant="secondary"
              :disabled="!hasActiveThread"
              @click="workspaceSession.cycleActiveThinkingLevel()"
            >
              Cycle thinking
            </BaseButton>
            <div class="runtime-toggle-row" :class="{ 'is-disabled': !hasActiveThread }">
              <div>
                <span>Auto compact</span>
                <small>上下文接近上限时自动压缩</small>
              </div>
              <BaseSegmentedControl
                label="Auto compact"
                :model-value="autoCompactionValue"
                :options="onOffOptions"
                @update:model-value="setAutoCompactionValue"
              />
            </div>
            <div class="runtime-retry-actions">
              <span>Auto retry</span>
              <BaseButton
                size="sm"
                variant="ghost"
                :disabled="!hasActiveThread"
                @click="workspaceSession.setActiveAutoRetry(true)"
              >
                Enable
              </BaseButton>
              <BaseButton
                size="sm"
                variant="ghost"
                :disabled="!hasActiveThread"
                @click="workspaceSession.setActiveAutoRetry(false)"
              >
                Disable
              </BaseButton>
            </div>
          </div>

          <article v-if="workspaceSession.activeRetryState" class="retry-card">
            <div>
              <strong>
                Retry {{ workspaceSession.activeRetryState.attempt }} /
                {{ workspaceSession.activeRetryState.maxAttempts }}
              </strong>
              <span>
                {{ formatRetryDelay(workspaceSession.activeRetryState.delayMs) }} ·
                {{ workspaceSession.activeRetryState.errorMessage }}
              </span>
            </div>
            <BaseButton size="sm" variant="ghost" @click="workspaceSession.abortActiveRetry()">
              Abort retry
            </BaseButton>
          </article>
        </section>

        <section v-if="activeTabId === 'changes'" class="session-section" role="tabpanel">
          <header class="session-section__header">
            <h3>Changes</h3>
            <span v-if="fileChanges.length" class="change-stats">
              +{{ fileChangeStats.additions }} / -{{ fileChangeStats.deletions }}
            </span>
          </header>

          <div v-if="fileChanges.length === 0" class="session-empty">No file changes</div>
          <div v-else class="change-review">
            <div class="change-list">
              <button
                v-for="change in fileChanges"
                :key="getFileChangeId(change)"
                type="button"
                class="change-item"
                :class="{ 'is-active': isSelectedFileChange(change) }"
                @click="selectedFileChangeId = getFileChangeId(change)"
              >
                <span>{{ getFileName(change.path) }}</span>
                <small>{{ change.changeType }} · {{ change.path }}</small>
                <strong>
                  <template v-if="change.additions !== undefined">+{{ change.additions }}</template>
                  <template v-if="change.deletions !== undefined"> -{{ change.deletions }}</template>
                </strong>
              </button>
            </div>

            <div v-if="selectedFileChange" class="change-preview">
              <header>
                <strong>{{ selectedFileChange.path }}</strong>
                <span v-if="selectedFileChange.firstChangedLine">
                  line {{ selectedFileChange.firstChangedLine }}
                </span>
              </header>
              <DiffViewer v-if="selectedReviewDiff" :diff="selectedReviewDiff" />
              <pre v-else>No diff available</pre>
            </div>
          </div>
        </section>

        <section v-if="activeTabId === 'tree'" class="session-section" role="tabpanel">
          <header class="session-section__header">
            <h3>Tree</h3>
          </header>
          <div v-if="sessionTreeRows.length === 0" class="session-empty">No session entries</div>
          <div v-else class="session-tree">
            <article
              v-for="{ node, depth } in sessionTreeRows"
              :key="node.id"
              class="session-tree__item"
              :class="{ 'is-current': node.id === currentEntryId }"
              :title="depth > 0 ? `Depth ${depth}` : undefined"
            >
              <div class="session-tree__content">
                <div class="session-tree__row">
                  <span class="session-tree__title">{{ node.label || node.title }}</span>
                  <span v-if="node.id === currentEntryId" class="session-tree__current">Current</span>
                </div>
                <small>
                  <span>{{ node.type }}</span>
                  <span>{{ new Date(node.timestamp).toLocaleString() }}</span>
                </small>
                <p v-if="node.summary">{{ node.summary }}</p>
              </div>
              <BaseButton
                class="session-tree__action"
                size="sm"
                variant="ghost"
                @click="workspaceSession.forkActiveSession(node.id)"
              >
                Fork
              </BaseButton>
            </article>
          </div>
        </section>

        <section v-if="activeTabId === 'commands'" class="session-section" role="tabpanel">
          <header class="session-section__header">
            <h3>Commands</h3>
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="!hasActiveThread"
              @click="workspaceSession.loadCommands()"
            >
              Refresh
            </BaseButton>
          </header>
          <div v-if="workspaceSession.activeCommandsLoading" class="session-empty">Loading...</div>
          <div v-else-if="workspaceSession.activeCommands.length === 0" class="session-empty">
            No commands
          </div>
          <div v-else class="command-list">
            <button
              v-for="command in workspaceSession.activeCommands"
              :key="`${command.source}:${command.name}`"
              type="button"
              class="command-item"
              @click="workspaceSession.runCommand(getCommandName(command))"
            >
              <span>/{{ getCommandName(command) }}</span>
              <small>{{ getCommandDescription(command) }}</small>
            </button>
          </div>
        </section>

        <section
          v-if="activeTabId === 'extensions'"
          class="session-section"
          role="tabpanel"
        >
          <header class="session-section__header">
            <h3>Extensions</h3>
          </header>

          <div
            v-if="
              !hasExtensionUiRequests &&
              !extensionStatuses.length &&
              !extensionWidgets.length &&
              !workspaceSession.activeExtensionTitle
            "
            class="session-empty"
          >
            No extension activity
          </div>

          <p v-if="workspaceSession.activeExtensionTitle" class="extension-title">
            {{ workspaceSession.activeExtensionTitle }}
          </p>

          <div v-if="extensionStatuses.length" class="extension-kv-list">
            <div v-for="[key, value] in extensionStatuses" :key="key">
              <span>{{ key }}</span>
              <strong>{{ value }}</strong>
            </div>
          </div>

          <article v-for="[key, widget] in extensionWidgets" :key="key" class="extension-widget">
            <strong>{{ key }}</strong>
            <p v-for="line in widget.lines" :key="line">{{ line }}</p>
          </article>

          <article
            v-for="request in extensionUiRequests"
            :key="request.id"
            class="extension-request"
          >
            <header>
              <strong>{{ getExtensionRequestTitle(request) }}</strong>
              <span>{{ request.type }}</span>
            </header>

            <p v-if="request.type === 'confirm'">{{ request.message }}</p>

            <div v-if="request.type === 'select'" class="extension-request__choices">
              <button
                v-for="option in request.options"
                :key="option"
                type="button"
                @click="respondExtensionRequest(request, option)"
              >
                {{ option }}
              </button>
            </div>

            <input
              v-if="request.type === 'input'"
              :value="getExtensionDraft(request)"
              :placeholder="request.placeholder"
              @input="setExtensionDraft(request.id, ($event.target as HTMLInputElement).value)"
            />

            <textarea
              v-if="request.type === 'editor'"
              :value="getExtensionDraft(request)"
              @input="setExtensionDraft(request.id, ($event.target as HTMLTextAreaElement).value)"
            />

            <div class="extension-request__actions">
              <BaseButton size="sm" variant="ghost" @click="cancelExtensionRequest(request)">
                Cancel
              </BaseButton>
              <BaseButton
                v-if="request.type === 'confirm'"
                size="sm"
                variant="primary"
                @click="respondExtensionRequest(request, true)"
              >
                Confirm
              </BaseButton>
              <BaseButton
                v-else-if="request.type !== 'select'"
                size="sm"
                variant="primary"
                @click="respondExtensionRequest(request)"
              >
                Submit
              </BaseButton>
            </div>
          </article>
        </section>

        <section v-if="activeTabId === 'approvals'" class="session-section" role="tabpanel">
          <header class="session-section__header">
            <h3>Approvals</h3>
          </header>
          <div v-if="!hasPendingApprovals" class="session-empty">No approvals</div>
          <article
            v-for="approval in pendingApprovals"
            :key="approval.approvalId"
            class="approval-card"
          >
            <header>
              <strong>{{ approval.action }}</strong>
              <span>{{ getApprovalRiskLabel(approval.risk) }}</span>
            </header>
            <p>{{ approval.subject }}</p>
            <div class="approval-card__scope" role="group" aria-label="审批作用域">
              <button
                v-for="scope in ['once', 'thread', 'workspace'] as const"
                :key="scope"
                type="button"
                :class="{ 'is-active': getApprovalScope(approval) === scope }"
                @click="setApprovalScope(approval, scope)"
              >
                {{ getApprovalScopeLabel(scope) }}
              </button>
            </div>
            <div v-if="approval.choices?.length" class="approval-card__choices">
              <button
                v-for="choice in approval.choices"
                :key="choice"
                type="button"
                @click="respondApproval(approval, { allow: true, choice })"
              >
                {{ choice }}
              </button>
            </div>
            <div class="approval-card__actions">
              <button type="button" @click="respondApproval(approval, { allow: false })">
                Deny
              </button>
              <button type="button" @click="respondApproval(approval, { allow: true })">
                Allow
              </button>
            </div>
          </article>
        </section>
      </ScrollArea>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.session-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

.session-panel__header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: var(--session-header-height);
  padding: 0 var(--space-3) 0 var(--space-2);
  border-bottom: 1px solid var(--color-border-muted);
}

.session-panel__tabs {
  display: flex;
  flex: 1 1 auto;
  align-items: end;
  gap: 2px;
  min-width: 0;
  height: inherit;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.session-panel__tabs::-webkit-scrollbar {
  display: none;
}

.session-panel__tab {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  max-width: 128px;
  height: 30px;
  min-width: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }

  &.is-active {
    color: var(--color-text);
    background: var(--color-canvas);
    border-color: var(--color-border-muted);
  }

  &.has-attention:not(.is-active) {
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-warning, var(--color-text-muted)) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-warning, var(--color-border)) 38%, transparent);
  }

  &.is-closed {
    height: 24px;
    align-self: center;
    gap: 5px;
    padding: 0 7px;
    color: var(--color-text-subtle);
    font: inherit;
    font-size: var(--font-size-ui-xs);
    font-weight: 650;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;

    small {
      color: var(--color-text);
      background: var(--color-surface-raised);
    }

    &.has-attention {
      color: var(--color-warning, var(--color-text));
      background: color-mix(in srgb, var(--color-warning, var(--color-text-muted)) 9%, transparent);
    }
  }
}

.session-panel__tab-main {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: 100%;
  padding: 0 0 0 7px;
  color: inherit;
  font: inherit;
  font-size: var(--font-size-ui-xs);
  font-weight: 650;
  background: transparent;
  border: 0;
  cursor: pointer;

  span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    flex: 0 0 auto;
    min-width: 16px;
    padding: 0 4px;
    color: var(--color-text-subtle);
    font-size: var(--font-size-ui-2xs);
    text-align: center;
    background: var(--color-control-track);
    border-radius: 999px;
  }
}

.session-panel__tab.has-attention:not(.is-active) .session-panel__tab-main::after {
  content: '';
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  background: var(--color-warning, var(--color-text-muted));
  border-radius: 999px;
}

.session-panel__tab-close {
  display: inline-grid;
  flex: 0 0 auto;
  width: 20px;
  height: 100%;
  place-items: center;
  padding: 0;
  color: var(--color-text-subtle);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  line-height: 1;
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }
}

.session-panel__actions {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  height: inherit;
}

.session-panel__collapse {
  pointer-events: auto;
}

.session-panel__body {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding: 0 var(--space-2) var(--space-2);
  overflow: hidden;
}

.session-panel__scroll {
  min-width: 0;
  min-height: 0;
}

.session-panel__scroll :deep([data-slot='scroll-area-viewport']) {
  display: grid;
  gap: var(--space-3);
  align-content: start;
}

.session-panel__empty-tabs {
  display: grid;
  min-height: 120px;
  place-items: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
}

dl {
  display: grid;
  gap: var(--space-2);
  margin: 0;
}

dl div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

dt {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-xs);
  text-transform: uppercase;
}

dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-section {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.session-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.session-section__header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-ui-xs);
  font-weight: 700;
}

.session-primary-actions,
.session-secondary-actions,
.runtime-control-list {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.session-primary-actions {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.session-secondary-actions {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.session-action-message,
.session-empty,
.extension-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.runtime-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.session-browser-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.session-browser-summary div {
  min-width: 0;
  padding: 7px 8px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.session-browser-summary span,
.session-browser-summary strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-browser-summary span {
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-2xs);
}

.session-browser-summary strong {
  color: var(--color-text);
  font-size: var(--font-size-ui-xs);
  font-weight: 650;
}

.session-path-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: end;
  min-width: 0;
}

.export-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  padding: 7px 8px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  > div:first-child {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  span,
  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-2xs);
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-xs);
    font-weight: 650;
  }
}

.export-result__actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
}

.runtime-summary div,
.retry-card,
.runtime-toggle-row,
.runtime-retry-actions {
  min-width: 0;
  padding: 7px 8px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.runtime-summary span,
.runtime-summary strong,
.runtime-toggle-row span,
.runtime-toggle-row small,
.runtime-retry-actions span,
.retry-card span,
.retry-card strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-summary span,
.runtime-toggle-row small,
.retry-card span {
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-2xs);
}

.runtime-summary strong,
.runtime-toggle-row span,
.runtime-retry-actions span,
.retry-card strong {
  color: var(--color-text);
  font-size: var(--font-size-ui-xs);
  font-weight: 650;
}

.retry-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
}

.runtime-toggle-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;

  > div {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  &.is-disabled {
    opacity: 0.52;
    pointer-events: none;
  }
}

.runtime-retry-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--space-1);
  align-items: center;
}

.command-list {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.command-item {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 7px 8px;
  text-align: left;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.command-item span,
.command-item small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-item span {
  color: var(--color-text);
  font-size: var(--font-size-ui-xs);
  font-weight: 650;
}

.command-item small {
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-2xs);
}

.change-stats {
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.change-review {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.change-list {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.change-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px var(--space-2);
  min-width: 0;
  padding: 7px 8px;
  text-align: left;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.change-item.is-active {
  border-color: var(--color-primary);
}

.change-item span,
.change-item small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-item span {
  color: var(--color-text);
  font-size: var(--font-size-ui-xs);
  font-weight: 650;
}

.change-item small {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-2xs);
}

.change-item strong {
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  white-space: nowrap;
}

.change-preview {
  display: grid;
  min-width: 0;
  max-height: 320px;
  overflow: hidden;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.change-preview header {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 7px 8px;
  border-bottom: 1px solid var(--color-border);
}

.change-preview header strong,
.change-preview header span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-preview header strong {
  color: var(--color-text);
  font-size: var(--font-size-ui-xs);
}

.change-preview header span {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-2xs);
}

.change-preview :deep(.diff-viewer) {
  max-height: 272px;
}

.change-preview pre {
  margin: 0;
  padding: var(--space-2);
  overflow: auto;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-xs);
}

.session-tree {
  display: grid;
  min-width: 0;
  padding: 2px 0;
}

.session-tree__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  min-height: 38px;
  padding: 5px 6px;
  border-left: 2px solid transparent;
  border-radius: var(--radius-sm);

  &:hover {
    background: var(--color-surface-raised);

    .session-tree__action {
      opacity: 1;
    }
  }
}

.session-tree__item.is-current {
  background: var(--color-primary-soft);
  border-left-color: var(--color-primary);
}

.session-tree__content {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.session-tree__row {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
}

.session-tree__title,
.session-tree__content small,
.session-tree__content p {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-tree__title {
  flex: 1 1 auto;
  color: var(--color-text);
  font-size: var(--font-size-ui-xs);
  font-weight: 650;
  white-space: nowrap;
}

.session-tree__content small,
.session-tree__content p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-2xs);
}

.session-tree__content small {
  display: flex;
  gap: var(--space-1);
  align-items: center;
}

.session-tree__content small span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-tree__content small span + span::before {
  padding-right: var(--space-1);
  content: '·';
}

.session-tree__content p {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  line-height: 1.35;
}

.session-tree__current {
  flex: 0 0 auto;
  min-height: 18px;
  padding: 0 6px;
  color: var(--color-primary-strong);
  font-size: var(--font-size-ui-2xs);
  font-weight: 700;
  line-height: 18px;
  background: var(--color-surface);
  border: 1px solid var(--color-primary-outline);
  border-radius: var(--radius-xs);
}

.session-tree__action {
  opacity: 0.72;
}

.extension-kv-list,
.extension-widget,
.extension-request {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.extension-kv-list div,
.extension-request header {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.extension-kv-list span,
.extension-request span,
.extension-widget p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.extension-kv-list strong,
.extension-widget strong,
.extension-request strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-ui-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extension-request p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.extension-request input,
.extension-request textarea {
  width: 100%;
  min-width: 0;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-ui-xs);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.extension-request input {
  min-height: 28px;
  padding: 0 8px;
}

.extension-request textarea {
  min-height: 84px;
  padding: 7px 8px;
  resize: vertical;
}

.extension-request__choices,
.extension-request__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.extension-request__choices button {
  min-height: 26px;
  padding: 0 8px;
  color: var(--color-text);
  font: inherit;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.approval-card {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-danger-outline);
  border-radius: var(--radius-md);

  header,
  .approval-card__actions,
  .approval-card__choices,
  .approval-card__scope {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  header {
    justify-content: space-between;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-xs);
  }

  span,
  p {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
  }

  button {
    min-height: 26px;
    padding: 0 8px;
    color: var(--color-text);
    font: inherit;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .approval-card__scope {
    gap: 2px;
    padding: 2px;
    background: var(--color-surface);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
  }

  .approval-card__scope button {
    border-color: transparent;
    color: var(--color-text-muted);
    background: transparent;

    &.is-active {
      color: var(--color-text);
      background: var(--color-surface-raised);
      border-color: var(--color-border);
    }
  }
}
</style>
