<script setup lang="ts">
import {
  BaseBadge,
  BaseButton,
  BaseField,
  BasePanel,
  BaseSegmentedControl
} from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { ResourceSnapshot, ResourceSnapshotInput } from '@shared/coding-agent/types'
import {
  ChevronRight,
  Command,
  Flag,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Wrench
} from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

type ExtensionPathRow = ResourceSnapshot['resources']['extensions'][number]
type ExtensionCapabilityRow = ResourceSnapshot['extensions'][number]
type ExtensionGroupKey = string
type ExtensionScope = 'project' | 'user'

interface ExtensionListRow {
  path: ExtensionPathRow
  extension?: ExtensionCapabilityRow
}

interface ExtensionGroup {
  key: ExtensionGroupKey
  title: string
  rows: ExtensionListRow[]
}

interface CapabilitySummary {
  total: number
  commands: number
  tools: number
  flags: number
}

const agentSettings = useAgentSettingsStore()
const workspaceProject = useWorkspaceProjectStore()
const workspaceSession = useWorkspaceSessionStore()
const router = useRouter()
const snapshotScope = ref<'project' | 'global'>('project')
const refreshSpinKey = ref(0)
const addDialogOpen = ref(false)
const pathSettingsDialogOpen = ref(false)
const pathDraft = ref('')
const scopeDraft = ref<ExtensionScope>('user')
const selectedRow = ref<ExtensionListRow | null>(null)
const addDialogProjectId = ref<string | null>(null)
const selectedRowProjectId = ref<string | null>(null)

const searchQuery = ref('')
const scopeFilter = ref<'all' | 'project' | 'user' | 'package'>('all')
const statusFilter = ref<'all' | 'enabled' | 'disabled'>('all')
const expandedGroups = ref<Record<string, boolean>>({})
const expandedCapabilities = ref<Record<string, boolean>>({})

const scopeFilterOptions = [
  { label: '全部', value: 'all' },
  { label: '项目', value: 'project' },
  { label: '用户', value: 'user' },
  { label: '包', value: 'package' }
]
const statusFilterOptions = [
  { label: '全部', value: 'all' },
  { label: '已启用', value: 'enabled' },
  { label: '已禁用', value: 'disabled' }
]

const extensionRows = computed(() => agentSettings.discoveredExtensions)
const extensionPathRows = computed(() => agentSettings.resolvedExtensionPaths)
const resourceSnapshot = computed(() => agentSettings.resourceSnapshot)
const activeProject = computed(() => workspaceProject.activeProject)
const activeProjectId = computed(
  () => workspaceSession.activeProjectId ?? activeProject.value?.projectId
)
const canWriteProjectSettings = computed(() => Boolean(activeProjectId.value))
const projectSnapshotInput = computed<ResourceSnapshotInput | undefined>(() => {
  if (workspaceSession.activeSessionId) {
    return { threadId: workspaceSession.activeSessionId }
  }
  if (!activeProject.value) {
    return undefined
  }
  return { projectId: activeProject.value.projectId }
})
const snapshotInput = computed<ResourceSnapshotInput>(() =>
  snapshotScope.value === 'project' ? (projectSnapshotInput.value ?? {}) : {}
)
const snapshotScopeLabel = computed(() => {
  if (snapshotScope.value === 'global') return '全局设置视角'
  if (workspaceSession.activeSnapshot?.cwd)
    return `当前会话 · ${workspaceSession.activeSnapshot.cwd}`
  if (activeProject.value?.path) return `当前项目 · ${activeProject.value.path}`
  return '未选择项目，使用全局设置视角'
})
const discoveredStats = computed(() => {
  const resources = resourceSnapshot.value?.resources
  return [
    { label: '已加载扩展', value: extensionRows.value.length },
    { label: '已解析路径', value: resources?.extensions.length ?? 0 },
    { label: '诊断', value: agentSettings.resourceDiagnostics.length }
  ]
})
const capabilityByPath = computed(() => {
  const rows = new Map<string, ExtensionCapabilityRow>()
  for (const extension of extensionRows.value) {
    rows.set(extension.path, extension)
    rows.set(extension.resolvedPath, extension)
  }
  return rows
})
const extensionGroups = computed<ExtensionGroup[]>(() => {
  const projectRows: ExtensionListRow[] = []
  const userRows: ExtensionListRow[] = []
  const packageGroups = new Map<string, ExtensionListRow[]>()

  for (const path of extensionPathRows.value) {
    const row: ExtensionListRow = {
      path,
      extension: capabilityByPath.value.get(path.path)
    }
    if (path.sourceInfo.origin === 'package') {
      const source = path.sourceInfo.source
      if (!packageGroups.has(source)) {
        packageGroups.set(source, [])
      }
      packageGroups.get(source)!.push(row)
    } else if (path.sourceInfo.scope === 'project') {
      projectRows.push(row)
    } else {
      userRows.push(row)
    }
  }

  const groups: ExtensionGroup[] = [
    {
      key: 'project',
      title: '项目',
      rows: projectRows
    },
    {
      key: 'user',
      title: '用户',
      rows: userRows
    }
  ]

  for (const [source, rows] of packageGroups) {
    groups.push({
      key: `package:${source}`,
      title: source,
      rows
    })
  }

  return groups
})
const filteredExtensionGroups = computed<ExtensionGroup[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return extensionGroups.value
    .map((group) => {
      const rows = group.rows.filter((row) => {
        const matchesScope =
          scopeFilter.value === 'all' ||
          (scopeFilter.value === 'package'
            ? group.key.startsWith('package:')
            : group.key === scopeFilter.value)
        const matchesStatus =
          statusFilter.value === 'all' ||
          (statusFilter.value === 'enabled' ? row.path.enabled : !row.path.enabled)
        if (!matchesScope || !matchesStatus) return false
        if (!query) return true
        const haystack = [
          row.path.path,
          ...(row.extension?.commands.map((c) => c.name) ?? []),
          ...(row.extension?.tools.map((t) => t.name) ?? []),
          ...(row.extension?.flags.map((f) => f.name) ?? [])
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(query)
      })
      return { ...group, rows }
    })
    .filter((group) => group.rows.length > 0)
})
const totalFilteredRows = computed(() =>
  filteredExtensionGroups.value.reduce((sum, group) => sum + group.rows.length, 0)
)
const hasActiveFilters = computed(
  () =>
    searchQuery.value.trim().length > 0 ||
    scopeFilter.value !== 'all' ||
    statusFilter.value !== 'all'
)
const addScopeOptions = computed(() => [
  { label: '用户', value: 'user' as const },
  {
    label: '当前项目',
    value: 'project' as const
  }
])
const addDialogDescription = computed(() =>
  scopeDraft.value === 'project'
    ? '保存后会写入当前项目 .pi/settings.json。'
    : '保存后会写入全局用户 settings.json。'
)

onMounted(async () => {
  if (!agentSettings.snapshot) {
    await agentSettings.load()
  }
  await refreshResourceSnapshot()
  await loadProjectPathsForCurrentView()
})

watch(activeProjectId, (projectId, previousProjectId) => {
  if (projectId !== previousProjectId) {
    closeAddDialog()
    closePathSettings()
  }
  void loadProjectPathsForCurrentView()
})

watch(snapshotInput, () => {
  void refreshResourceSnapshot()
})

function refreshResourceSnapshot(): Promise<void> {
  return agentSettings.loadResourceSnapshot(snapshotInput.value)
}

async function refreshResourceSnapshotWithSpin(): Promise<void> {
  refreshSpinKey.value += 1
  await refreshResourceSnapshot()
  await loadProjectPathsForCurrentView()
}

function selectSnapshotScope(scope: typeof snapshotScope.value): void {
  snapshotScope.value = scope
  void loadProjectPathsForCurrentView()
}

function clearFilters(): void {
  searchQuery.value = ''
  scopeFilter.value = 'all'
  statusFilter.value = 'all'
}

function isGroupExpanded(key: string): boolean {
  return expandedGroups.value[key] !== false
}

function toggleGroup(key: string): void {
  expandedGroups.value = { ...expandedGroups.value, [key]: !isGroupExpanded(key) }
}

function isCapabilitiesExpanded(path: string): boolean {
  return expandedCapabilities.value[path] === true
}

function toggleCapabilities(path: string): void {
  expandedCapabilities.value = {
    ...expandedCapabilities.value,
    [path]: !isCapabilitiesExpanded(path)
  }
}

function getCapabilitySummary(row: ExtensionListRow): CapabilitySummary {
  const extension = row.extension
  const commands = extension?.commands.length ?? 0
  const tools = extension?.tools.length ?? 0
  const flags = extension?.flags.length ?? 0
  return { total: commands + tools + flags, commands, tools, flags }
}

function getCapabilityTypeLabel(type: 'commands' | 'tools' | 'flags'): string {
  return { commands: '命令', tools: '工具', flags: '参数' }[type]
}

function openAddDialog(): void {
  pathDraft.value = ''
  scopeDraft.value = canWriteProjectSettings.value ? 'project' : 'user'
  addDialogProjectId.value = activeProjectId.value ?? null
  addDialogOpen.value = true
}

function closeAddDialog(): void {
  addDialogOpen.value = false
  addDialogProjectId.value = null
}

async function selectPathForDraft(): Promise<void> {
  const selectedPaths = await window.api.codingAgent.selectResourcePath({
    title: '选择扩展路径',
    mode: 'any',
    multi: false,
    defaultPath: pathDraft.value || undefined
  })
  if (!selectedPaths?.length) return
  pathDraft.value = selectedPaths[0]
}

async function saveAddedPath(): Promise<void> {
  const path = pathDraft.value.trim()
  if (!path) return
  if (scopeDraft.value === 'project') {
    const projectId = addDialogProjectId.value
    if (!projectId || projectId !== activeProjectId.value) {
      closeAddDialog()
      await refreshResourceSnapshot()
      return
    }
    if (!(await ensureProjectPathsLoaded(projectId))) return
    await agentSettings.saveProjectExtensionPaths(
      projectId,
      appendPathSetting(agentSettings.projectExtensionPaths, path)
    )
  } else {
    await saveUserExtensionPaths(
      appendPathSetting(agentSettings.draft?.resources.extensions ?? [], path)
    )
  }
  closeAddDialog()
  await refreshResourceSnapshot()
}

function openPathSettings(row: ExtensionListRow): void {
  selectedRow.value = row
  selectedRowProjectId.value =
    row.path.sourceInfo.scope === 'project' ? (activeProjectId.value ?? null) : null
  pathSettingsDialogOpen.value = true
}

function closePathSettings(): void {
  pathSettingsDialogOpen.value = false
  selectedRow.value = null
  selectedRowProjectId.value = null
}

async function setSelectedPathEnabled(enabled: boolean): Promise<void> {
  if (!selectedRow.value) return
  const path = selectedRow.value.path
  if (path.sourceInfo.scope === 'project') {
    const projectId = selectedRowProjectId.value
    if (!projectId || projectId !== activeProjectId.value) {
      closePathSettings()
      await refreshResourceSnapshot()
      return
    }
    if (!(await ensureProjectPathsLoaded(projectId))) return
    await agentSettings.saveProjectExtensionPaths(
      projectId,
      setPathEnabled(agentSettings.projectExtensionPaths, path.path, enabled)
    )
  } else if (path.sourceInfo.scope === 'user') {
    await saveUserExtensionPaths(
      setPathEnabled(agentSettings.draft?.resources.extensions ?? [], path.path, enabled)
    )
  }
  closePathSettings()
  await refreshResourceSnapshot()
}

async function removeSelectedPath(): Promise<void> {
  if (!selectedRow.value) return
  const path = selectedRow.value.path
  if (path.sourceInfo.scope === 'project') {
    const projectId = selectedRowProjectId.value
    if (!projectId || projectId !== activeProjectId.value) {
      closePathSettings()
      await refreshResourceSnapshot()
      return
    }
    if (!(await ensureProjectPathsLoaded(projectId))) return
    await agentSettings.saveProjectExtensionPaths(
      projectId,
      removePathSetting(agentSettings.projectExtensionPaths, path.path)
    )
  } else if (path.sourceInfo.scope === 'user') {
    await saveUserExtensionPaths(
      removePathSetting(agentSettings.draft?.resources.extensions ?? [], path.path)
    )
  }
  closePathSettings()
  await refreshResourceSnapshot()
}

async function saveUserExtensionPaths(extensions: string[]): Promise<void> {
  if (!agentSettings.draft) return
  agentSettings.draft.resources.extensions = extensions
  await agentSettings.saveResources()
}

async function loadProjectPathsForCurrentView(): Promise<void> {
  const projectId = activeProjectId.value
  if (!projectId) {
    await agentSettings.loadProjectExtensionPaths()
    return
  }
  await ensureProjectPathsLoaded(projectId)
}

async function ensureProjectPathsLoaded(projectId: string): Promise<boolean> {
  if (agentSettings.projectExtensionPathsProjectId !== projectId) {
    await agentSettings.loadProjectExtensionPaths(projectId)
  }
  return (
    activeProjectId.value === projectId &&
    agentSettings.projectExtensionPathsProjectId === projectId
  )
}

function canConfigureExtensionPath(path: ExtensionPathRow): boolean {
  return path.sourceInfo.origin === 'top-level' && path.sourceInfo.scope !== 'temporary'
}

function canRemoveExtensionPath(path: ExtensionPathRow): boolean {
  if (!canConfigureExtensionPath(path)) return false
  if (path.sourceInfo.source !== 'local') return false
  const settings = getSettingsForPathScope(path.sourceInfo.scope)
  return settings.some((entry) => normalizePathSetting(entry).path === path.path)
}

function getSettingsForPathScope(scope: string): string[] {
  if (scope === 'project') return agentSettings.projectExtensionPaths
  if (scope === 'user') return agentSettings.draft?.resources.extensions ?? []
  return []
}

function getExtensionPathStateLabel(path: ExtensionPathRow): string {
  if (!path.enabled) return '已禁用'
  if (path.sourceInfo.origin === 'package') return '包来源'
  if (path.sourceInfo.scope === 'project') return '项目'
  return '启用'
}

function getExtensionPathStateTone(
  path: ExtensionPathRow
): 'success' | 'neutral' | 'info' | 'warning' {
  if (!path.enabled) return 'neutral'
  if (path.sourceInfo.origin === 'package') return 'info'
  if (path.sourceInfo.scope === 'project') return 'success'
  return 'success'
}

function getExtensionPathDisplayName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

function getExtensionPathDisplaySubtitle(path: string): string {
  const segments = path.split(/[/\\]/)
  segments.pop()
  return segments.join('/') || path
}

function getExtensionPathMeta(path: ExtensionPathRow): string {
  return [
    getSourceScopeLabel(path.sourceInfo.scope),
    getSourceOriginLabel(path.sourceInfo.origin),
    getSourceLabel(path.sourceInfo.source)
  ].join(' · ')
}

function getCapabilityCount(row: ExtensionListRow): number {
  const summary = getCapabilitySummary(row)
  return summary.total
}

function appendPathSetting(settings: string[], path: string): string[] {
  const cleaned = removePathSetting(settings, path)
  return [...cleaned, path]
}

function setPathEnabled(settings: string[], path: string, enabled: boolean): string[] {
  const cleaned = removePathSetting(settings, path)
  return [...cleaned, `${enabled ? '+' : '-'}${path}`]
}

function removePathSetting(settings: string[], path: string): string[] {
  return settings.filter((entry) => normalizePathSetting(entry).path !== path)
}

function normalizePathSetting(entry: string): { path: string; prefix: '+' | '-' | undefined } {
  const trimmed = entry.trim()
  const prefix = trimmed[0] === '+' || trimmed[0] === '-' ? (trimmed[0] as '+' | '-') : undefined
  return {
    path: prefix ? trimmed.slice(1) : trimmed,
    prefix
  }
}

function getSourceScopeLabel(scope: string): string {
  return (
    {
      project: '项目',
      user: '用户',
      temporary: '临时'
    }[scope] ?? scope
  )
}

function getSourceOriginLabel(origin: string): string {
  return (
    {
      package: '包来源',
      'top-level': '直接配置'
    }[origin] ?? origin
  )
}

function getSourceLabel(source: string): string {
  return (
    {
      auto: '自动',
      local: '本地',
      unknown: '未知'
    }[source] ?? source
  )
}

function getDiagnosticTypeLabel(type: string): string {
  return (
    {
      error: '错误',
      warning: '警告',
      collision: '冲突'
    }[type] ?? type
  )
}
</script>

<template>
  <div class="extensions-page">
    <header class="extensions-page__header">
      <div>
        <p class="extensions-page__eyebrow">发现</p>
        <h1 class="extensions-page__title">扩展列表</h1>
        <p class="extensions-page__subtitle">
          统一查看扩展发现结果，并在同一处配置用户或项目扩展路径。
        </p>
      </div>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel title="扩展管理" eyebrow="发现">
      <template #actions>
        <BaseButton size="sm" variant="secondary" @click="openAddDialog">
          <template #icon>
            <Plus :size="14" />
          </template>
          添加扩展路径
        </BaseButton>
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="agentSettings.resourcePackagesLoading"
          @click="refreshResourceSnapshotWithSpin"
        >
          <template #icon>
            <RefreshCw :key="refreshSpinKey" class="refresh-spin-icon" :size="14" />
          </template>
          刷新
        </BaseButton>
      </template>

      <div class="extension-scope">
        <div class="extension-scope__selector">
          <span>发现视角</span>
          <BaseSegmentedControl
            :model-value="snapshotScope"
            label="发现视角"
            size="small"
            :options="[
              { label: '项目', value: 'project' },
              { label: '全局', value: 'global' }
            ]"
            @update:model-value="selectSnapshotScope"
          />
        </div>
        <div class="extension-scope__label">
          <strong>{{ snapshotScopeLabel }}</strong>
          <span>切换视角只影响本页发现结果，不会自动修改运行中会话。</span>
        </div>
      </div>

      <div class="extension-toolbar">
        <BaseField
          id="extension-search"
          v-model="searchQuery"
          type="search"
          label="搜索扩展"
          placeholder="路径、命令或工具名称"
        />
        <SettingsSelectField v-model="scopeFilter" label="作用域" :options="scopeFilterOptions" />
        <SettingsSelectField v-model="statusFilter" label="状态" :options="statusFilterOptions" />
        <BaseButton v-if="hasActiveFilters" size="sm" variant="ghost" @click="clearFilters">
          清除筛选
        </BaseButton>
      </div>

      <div class="extension-summary" aria-label="扩展发现统计">
        <div v-for="item in discoveredStats" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>

      <div v-if="!resourceSnapshot" class="empty-state">
        <strong>正在等待资源快照</strong>
        <span>点击刷新可重新加载扩展发现结果。</span>
      </div>
      <div v-else-if="extensionPathRows.length === 0" class="empty-state">
        <strong>暂无扩展路径</strong>
        <span>添加包来源或扩展路径后，桌面端会按 Pi core 规则发现。</span>
      </div>
      <div v-else-if="totalFilteredRows === 0" class="empty-state">
        <Search :size="22" />
        <strong>没有匹配的扩展</strong>
        <span>调整搜索词、作用域或状态筛选后再试。</span>
      </div>
      <div v-else class="extension-groups">
        <section v-for="group in filteredExtensionGroups" :key="group.key" class="extension-group">
          <button
            class="extension-group__header"
            type="button"
            :aria-expanded="isGroupExpanded(group.key)"
            @click="toggleGroup(group.key)"
          >
            <ChevronRight
              class="extension-group__chevron"
              :class="{ 'is-expanded': isGroupExpanded(group.key) }"
              :size="16"
              aria-hidden="true"
            />
            <div class="extension-group__heading">
              <h3>{{ group.title }}</h3>
            </div>
            <BaseBadge tone="neutral">{{ group.rows.length }}</BaseBadge>
          </button>

          <ul v-if="isGroupExpanded(group.key)" class="extension-list">
            <li
              v-for="row in group.rows"
              :key="`${group.key}:${row.path.path}`"
              class="extension-list__row"
              :class="{ 'is-disabled': !row.path.enabled }"
            >
              <div class="extension-list__main">
                <div class="extension-list__copy">
                  <div class="extension-list__title">
                    <strong :title="row.path.path">{{
                      getExtensionPathDisplayName(row.path.path)
                    }}</strong>
                    <BaseBadge :tone="getExtensionPathStateTone(row.path)">
                      {{ getExtensionPathStateLabel(row.path) }}
                    </BaseBadge>
                  </div>
                  <span class="extension-list__path" :title="row.path.path">{{
                    getExtensionPathDisplaySubtitle(row.path.path)
                  }}</span>
                  <span class="extension-list__source">{{ getExtensionPathMeta(row.path) }}</span>
                  <div class="extension-list__summary">
                    <template v-if="row.extension && getCapabilityCount(row) > 0">
                      <BaseBadge
                        v-if="getCapabilitySummary(row).commands > 0"
                        tone="info"
                        class="capability-badge"
                      >
                        <Command :size="11" aria-hidden="true" />
                        {{ getCapabilitySummary(row).commands }} 命令
                      </BaseBadge>
                      <BaseBadge
                        v-if="getCapabilitySummary(row).tools > 0"
                        tone="info"
                        class="capability-badge"
                      >
                        <Wrench :size="11" aria-hidden="true" />
                        {{ getCapabilitySummary(row).tools }} 工具
                      </BaseBadge>
                      <BaseBadge
                        v-if="getCapabilitySummary(row).flags > 0"
                        tone="info"
                        class="capability-badge"
                      >
                        <Flag :size="11" aria-hidden="true" />
                        {{ getCapabilitySummary(row).flags }} 参数
                      </BaseBadge>
                      <BaseButton
                        size="sm"
                        variant="ghost"
                        @click="toggleCapabilities(row.path.path)"
                      >
                        {{ isCapabilitiesExpanded(row.path.path) ? '收起' : '详情' }}
                      </BaseButton>
                    </template>
                    <span v-else class="extension-list__empty-capability">
                      {{ row.path.enabled ? '未注册命令/工具/参数' : '已禁用，未加载能力' }}
                    </span>
                  </div>
                </div>

                <div class="extension-list__actions">
                  <BaseButton
                    v-if="canConfigureExtensionPath(row.path)"
                    size="sm"
                    variant="ghost"
                    @click="openPathSettings(row)"
                  >
                    <template #icon>
                      <Settings :size="14" />
                    </template>
                    设置
                  </BaseButton>
                  <BaseButton
                    v-else-if="group.key.startsWith('package')"
                    size="sm"
                    variant="ghost"
                    @click="router.push('/settings/extensions/packages')"
                  >
                    包来源
                  </BaseButton>
                  <span v-else class="extension-list__state">
                    {{ getExtensionPathStateLabel(row.path) }}
                  </span>
                </div>
              </div>

              <div
                v-if="
                  isCapabilitiesExpanded(row.path.path) &&
                  row.extension &&
                  getCapabilityCount(row) > 0
                "
                class="extension-list__capabilities"
              >
                <div
                  v-for="type in ['commands', 'tools', 'flags'] as const"
                  :key="type"
                  class="capability-section"
                  :class="{ 'is-empty': (row.extension?.[type]?.length ?? 0) === 0 }"
                >
                  <span class="capability-section__label">
                    {{ getCapabilityTypeLabel(type) }}
                    <em>({{ row.extension?.[type]?.length ?? 0 }})</em>
                  </span>
                  <div v-if="row.extension?.[type]?.length" class="capability-chips">
                    <span
                      v-for="item in row.extension[type]"
                      :key="`${type}:${row.path.path}:${item.name}`"
                    >
                      <template v-if="type === 'commands'">/{{ item.name }}</template>
                      <template v-else-if="type === 'tools'">tool:{{ item.name }}</template>
                      <template v-else>--{{ item.name }}</template>
                    </span>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </BasePanel>

    <BasePanel v-if="agentSettings.resourceDiagnostics.length" title="诊断" eyebrow="警告">
      <ul class="resource-diagnostics">
        <li
          v-for="diagnostic in agentSettings.resourceDiagnostics"
          :key="`${diagnostic.path}:${diagnostic.message}`"
        >
          <strong>{{ getDiagnosticTypeLabel(diagnostic.type) }}</strong>
          <span>{{ diagnostic.message }}</span>
          <small v-if="diagnostic.path">{{ diagnostic.path }}</small>
        </li>
      </ul>
    </BasePanel>

    <Dialog :open="addDialogOpen" @update:open="addDialogOpen = $event">
      <DialogContent class="extension-dialog">
        <form class="extension-dialog__form" @submit.prevent="saveAddedPath">
          <DialogHeader>
            <DialogTitle>添加扩展路径</DialogTitle>
            <DialogDescription>{{ addDialogDescription }}</DialogDescription>
          </DialogHeader>

          <BaseField
            id="extension-path-add"
            v-model="pathDraft"
            label="扩展路径"
            placeholder="/path/to/extension.ts"
            hint="可以选择单个扩展文件，也可以填写扩展目录。"
          />
          <BaseButton type="button" size="sm" variant="ghost" @click="selectPathForDraft">
            <template #icon>
              <FolderOpen :size="14" />
            </template>
            选择路径
          </BaseButton>
          <div class="extension-dialog__scope">
            <span>作用域</span>
            <BaseSegmentedControl
              v-model="scopeDraft"
              label="扩展路径作用域"
              size="small"
              :options="addScopeOptions"
            />
            <p v-if="scopeDraft === 'project' && !canWriteProjectSettings">
              当前没有可写入的项目，请切换到用户作用域或先打开项目。
            </p>
          </div>

          <DialogFooter>
            <BaseButton type="button" size="sm" variant="ghost" @click="closeAddDialog">
              取消
            </BaseButton>
            <BaseButton
              type="submit"
              size="sm"
              variant="primary"
              :disabled="
                agentSettings.saving ||
                !pathDraft.trim() ||
                (scopeDraft === 'project' && !canWriteProjectSettings)
              "
            >
              保存
            </BaseButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog :open="pathSettingsDialogOpen" @update:open="pathSettingsDialogOpen = $event">
      <DialogContent class="extension-dialog">
        <DialogHeader>
          <DialogTitle>扩展路径设置</DialogTitle>
          <DialogDescription>
            {{ selectedRow ? getExtensionPathMeta(selectedRow.path) : '扩展路径' }}
          </DialogDescription>
        </DialogHeader>

        <div v-if="selectedRow" class="extension-dialog__summary">
          <strong>{{ selectedRow.path.path }}</strong>
          <span>{{ getExtensionPathStateLabel(selectedRow.path) }}</span>
        </div>

        <DialogFooter>
          <BaseButton
            v-if="selectedRow && canRemoveExtensionPath(selectedRow.path)"
            type="button"
            size="sm"
            variant="danger"
            :disabled="agentSettings.saving"
            @click="removeSelectedPath"
          >
            移除
          </BaseButton>
          <BaseButton
            type="button"
            size="sm"
            variant="ghost"
            :disabled="agentSettings.saving"
            @click="closePathSettings"
          >
            取消
          </BaseButton>
          <BaseButton
            v-if="selectedRow?.path.enabled"
            type="button"
            size="sm"
            variant="secondary"
            :disabled="agentSettings.saving"
            @click="setSelectedPathEnabled(false)"
          >
            禁用
          </BaseButton>
          <BaseButton
            v-else-if="selectedRow"
            type="button"
            size="sm"
            variant="primary"
            :disabled="agentSettings.saving"
            @click="setSelectedPathEnabled(true)"
          >
            启用
          </BaseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
