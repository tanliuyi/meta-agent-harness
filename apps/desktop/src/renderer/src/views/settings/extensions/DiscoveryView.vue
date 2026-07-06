<script setup lang="ts">
import {
  BaseButton,
  BaseField,
  BasePanel,
  BaseSegmentedControl
} from '@renderer/components/base'
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
import { AlertTriangle, FolderOpen, Plus, RefreshCw, Settings } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

type ExtensionPathRow = ResourceSnapshot['resources']['extensions'][number]
type ExtensionCapabilityRow = ResourceSnapshot['extensions'][number]
type ExtensionGroupKey = 'project' | 'user' | 'package'
type ExtensionScope = 'project' | 'user'

interface ExtensionListRow {
  path: ExtensionPathRow
  extension?: ExtensionCapabilityRow
}

interface ExtensionGroup {
  key: ExtensionGroupKey
  title: string
  description: string
  rows: ExtensionListRow[]
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

const extensionRows = computed(() => agentSettings.discoveredExtensions)
const extensionPathRows = computed(() => agentSettings.resolvedExtensionPaths)
const resourceSnapshot = computed(() => agentSettings.resourceSnapshot)
const activeProject = computed(() => workspaceProject.activeProject)
const activeProjectCwd = computed(
  () => workspaceSession.activeSnapshot?.cwd ?? activeProject.value?.path ?? projectSnapshotInput.value?.cwd
)
const canWriteProjectSettings = computed(() => Boolean(activeProjectCwd.value))
const projectSnapshotInput = computed<ResourceSnapshotInput | undefined>(() => {
  if (workspaceSession.activeSessionId) {
    return { threadId: workspaceSession.activeSessionId }
  }
  if (!activeProject.value) {
    return undefined
  }
  return {
    cwd: activeProject.value.path,
    projectTrusted:
      activeProject.value.trust?.state === 'trusted' ||
      activeProject.value.trust?.state === 'notRequired'
  }
})
const snapshotInput = computed<ResourceSnapshotInput>(() =>
  snapshotScope.value === 'project' ? (projectSnapshotInput.value ?? {}) : {}
)
const snapshotScopeLabel = computed(() => {
  if (snapshotScope.value === 'global') return '全局设置视角'
  if (workspaceSession.activeSnapshot?.cwd) return `当前会话 · ${workspaceSession.activeSnapshot.cwd}`
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
  const groups: Record<ExtensionGroupKey, ExtensionListRow[]> = {
    project: [],
    user: [],
    package: []
  }

  for (const path of extensionPathRows.value) {
    const key = getExtensionGroupKey(path)
    groups[key].push({
      path,
      extension: capabilityByPath.value.get(path.path)
    })
  }

  return [
    {
      key: 'project',
      title: 'Project',
      description: '当前项目 .pi/settings.json 或项目自动发现的扩展。',
      rows: groups.project
    },
    {
      key: 'user',
      title: '用户',
      description: '全局用户 settings 与用户级自动发现扩展。',
      rows: groups.user
    },
    {
      key: 'package',
      title: '包来源',
      description: '来自 package source 的扩展；如需管理来源，请进入包来源页。',
      rows: groups.package
    }
  ]
})
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
  if (!agentSettings.resourceSnapshot) {
    await refreshResourceSnapshot()
  }
  await loadProjectPathsForCurrentView()
})

watch(activeProjectCwd, () => {
  void loadProjectPathsForCurrentView()
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
  void refreshResourceSnapshot()
  void loadProjectPathsForCurrentView()
}

function openAddDialog(): void {
  pathDraft.value = ''
  scopeDraft.value = canWriteProjectSettings.value ? 'project' : 'user'
  addDialogOpen.value = true
}

function closeAddDialog(): void {
  addDialogOpen.value = false
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
    const cwd = activeProjectCwd.value
    if (!cwd) return
    await ensureProjectPathsLoaded(cwd)
    await agentSettings.saveProjectExtensionPaths(
      cwd,
      appendPathSetting(agentSettings.projectExtensionPaths, path)
    )
  } else {
    await saveUserExtensionPaths(appendPathSetting(agentSettings.draft?.resources.extensions ?? [], path))
  }
  closeAddDialog()
  await refreshResourceSnapshot()
}

function openPathSettings(row: ExtensionListRow): void {
  selectedRow.value = row
  pathSettingsDialogOpen.value = true
}

function closePathSettings(): void {
  pathSettingsDialogOpen.value = false
}

async function setSelectedPathEnabled(enabled: boolean): Promise<void> {
  if (!selectedRow.value) return
  const path = selectedRow.value.path
  if (path.sourceInfo.scope === 'project') {
    const cwd = activeProjectCwd.value
    if (!cwd) return
    await ensureProjectPathsLoaded(cwd)
    await agentSettings.saveProjectExtensionPaths(
      cwd,
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
    const cwd = activeProjectCwd.value
    if (!cwd) return
    await ensureProjectPathsLoaded(cwd)
    await agentSettings.saveProjectExtensionPaths(
      cwd,
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
  const cwd = activeProjectCwd.value
  if (!cwd) return
  await ensureProjectPathsLoaded(cwd)
}

async function ensureProjectPathsLoaded(cwd: string): Promise<void> {
  if (agentSettings.projectExtensionPathsCwd === cwd) return
  await agentSettings.loadProjectExtensionPaths(cwd)
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

function getExtensionGroupKey(path: ExtensionPathRow): ExtensionGroupKey {
  if (path.sourceInfo.origin === 'package') return 'package'
  if (path.sourceInfo.scope === 'project') return 'project'
  return 'user'
}

function getExtensionPathStateLabel(path: ExtensionPathRow): string {
  if (!path.enabled) return '已禁用'
  if (path.sourceInfo.origin === 'package') return '包来源启用'
  if (path.sourceInfo.scope === 'project') return '项目启用'
  return '已启用'
}

function getExtensionPathMeta(path: ExtensionPathRow): string {
  return [
    getSourceScopeLabel(path.sourceInfo.scope),
    getSourceOriginLabel(path.sourceInfo.origin),
    getSourceLabel(path.sourceInfo.source)
  ].join(' · ')
}

function getCapabilityCount(row: ExtensionListRow): number {
  const extension = row.extension
  if (!extension) return 0
  return extension.commands.length + extension.tools.length + extension.flags.length
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
          统一查看扩展发现结果，并在同一处配置用户或 Project 扩展路径。
        </p>
      </div>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel title="扩展管理" eyebrow="发现">
      <template #actions>
        <div class="extension-scope__actions">
          <BaseButton size="sm" variant="secondary" @click="openAddDialog">
            <template #icon>
              <Plus :size="14" />
            </template>
            添加扩展路径
          </BaseButton>
          <BaseButton
            size="sm"
            :variant="snapshotScope === 'project' ? 'secondary' : 'ghost'"
            @click="selectSnapshotScope('project')"
          >
            项目
          </BaseButton>
          <BaseButton
            size="sm"
            :variant="snapshotScope === 'global' ? 'secondary' : 'ghost'"
            @click="selectSnapshotScope('global')"
          >
            全局
          </BaseButton>
          <BaseButton size="sm" variant="ghost" @click="refreshResourceSnapshotWithSpin">
            <template #icon>
              <RefreshCw :key="refreshSpinKey" class="refresh-spin-icon" :size="14" />
            </template>
            刷新
          </BaseButton>
        </div>
      </template>

      <div class="extension-scope">
        <div>
          <strong>{{ snapshotScopeLabel }}</strong>
          <span>切换视角只影响本页发现结果，不会自动修改运行中会话。</span>
        </div>
      </div>
      <div class="extension-toolbar">
        <div class="extension-stats" aria-label="扩展发现统计">
          <span v-for="item in discoveredStats" :key="item.label">
            {{ item.label }}: <strong>{{ item.value }}</strong>
          </span>
        </div>
        <div class="extension-warning">
          <AlertTriangle :size="15" />
          <span>发现结果会加载已启用的扩展代码。</span>
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
      <div v-else class="extension-groups">
        <section v-for="group in extensionGroups" :key="group.key" class="extension-group">
          <div class="extension-group__header">
            <div>
              <h3>{{ group.title }}</h3>
              <p>{{ group.description }}</p>
            </div>
            <span>{{ group.rows.length }}</span>
          </div>

          <div v-if="group.rows.length === 0" class="extension-group__empty">
            暂无{{ group.title }}扩展
          </div>
          <ul v-else class="extension-list">
            <li
              v-for="row in group.rows"
              :key="`${group.key}:${row.path.path}`"
              class="extension-list__row"
              :class="{ 'is-disabled': !row.path.enabled }"
            >
              <div class="extension-list__copy">
                <div class="extension-list__title-line">
                  <strong>{{ row.path.path }}</strong>
                  <span class="extension-status" :class="{ 'is-disabled': !row.path.enabled }">
                    {{ getExtensionPathStateLabel(row.path) }}
                  </span>
                </div>
                <span>{{ getExtensionPathMeta(row.path) }}</span>
              </div>

              <div class="extension-list__chips" aria-label="扩展能力">
                <template v-if="row.extension && getCapabilityCount(row) > 0">
                  <span
                    v-for="command in row.extension.commands"
                    :key="`command:${row.path.path}:${command.name}`"
                  >
                    /{{ command.name }}
                  </span>
                  <span v-for="tool in row.extension.tools" :key="`tool:${row.path.path}:${tool.name}`">
                    工具：{{ tool.name }}
                  </span>
                  <span v-for="flag in row.extension.flags" :key="`flag:${row.path.path}:${flag.name}`">
                    --{{ flag.name }}
                  </span>
                </template>
                <span v-else>{{ row.path.enabled ? '未注册命令/工具/参数' : '已禁用，未加载能力' }}</span>
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
                  v-else-if="group.key === 'package'"
                  size="sm"
                  variant="ghost"
                  @click="router.push('/settings/extensions/packages')"
                >
                  包来源
                </BaseButton>
                <span v-else class="extension-paths__state">
                  {{ getExtensionPathStateLabel(row.path) }}
                </span>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <ul v-if="agentSettings.resourceDiagnostics.length" class="resource-diagnostics">
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
              :disabled="!pathDraft.trim() || (scopeDraft === 'project' && !canWriteProjectSettings)"
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
            @click="removeSelectedPath"
          >
            移除
          </BaseButton>
          <BaseButton type="button" size="sm" variant="ghost" @click="closePathSettings">
            取消
          </BaseButton>
          <BaseButton
            v-if="selectedRow?.path.enabled"
            type="button"
            size="sm"
            variant="secondary"
            @click="setSelectedPathEnabled(false)"
          >
            禁用
          </BaseButton>
          <BaseButton
            v-else
            type="button"
            size="sm"
            variant="primary"
            @click="setSelectedPathEnabled(true)"
          >
            启用
          </BaseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
