/**
 * agent-settings.ts - Pi agent 设置页状态。
 *
 * renderer 通过 preload 调用 main 进程 AgentSettingsService，不能直接读写
 * settings.json。
 */

import type {
  AgentSettingsSnapshot,
  ResourcePackageInput,
  ResourcePackageListInput,
  ResourcePackageProgressEvent,
  ResourcePackageSummary,
  ResourceSnapshotInput,
  ResourceSnapshot,
  UpdateAgentSettingsInput,
  UpdateResourcePackageInput
} from '@shared/coding-agent/types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useToast } from '@renderer/composables/useToast'

type AgentSettingsDraft = Omit<AgentSettingsSnapshot, 'storage' | 'diagnostics'>

export interface ResourcePackageProgressState {
  source: string
  action: ResourcePackageProgressEvent['action']
  running: boolean
  message?: string
  error?: string
}

interface ResourcePackagesRequest {
  generation: number
  input: ResourcePackageListInput
}

const useAgentSettingsStore = defineStore('agent-settings', () => {
  const toast = useToast()
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const snapshot = ref<AgentSettingsSnapshot | null>(null)
  const draft = ref<AgentSettingsDraft | null>(null)
  const resourceSnapshot = ref<ResourceSnapshot | null>(null)
  const resourceSnapshotInput = ref<ResourceSnapshotInput>({})
  const resourcePackages = ref<ResourcePackageSummary[]>([])
  const resourcePackagesInput = ref<ResourcePackageListInput>({})
  const projectExtensionPaths = ref<string[]>([])
  const projectExtensionPathsProjectId = ref<string | null>(null)
  const resourcePackagesLoading = ref(false)
  const resourcePackageProgress = ref<Record<string, ResourcePackageProgressState>>({})
  let resourceSnapshotGeneration = 0
  let projectExtensionPathsGeneration = 0
  let resourcePackagesGeneration = 0
  let savingOperations = 0

  const diagnostics = computed(() => snapshot.value?.diagnostics ?? [])
  const resourceDiagnostics = computed(() => resourceSnapshot.value?.diagnostics ?? [])
  const discoveredExtensions = computed(() => resourceSnapshot.value?.extensions ?? [])
  const resolvedExtensionPaths = computed(() => resourceSnapshot.value?.resources.extensions ?? [])
  const resourcePaths = computed(() => resourceSnapshot.value?.resources)
  const storage = computed(() => snapshot.value?.storage)
  const canSave = computed(() => Boolean(draft.value) && !saving.value)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.getAgentSettings())
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Agent 设置加载失败'
    } finally {
      loading.value = false
    }
  }

  async function save(): Promise<void> {
    if (!draft.value || saving.value) return
    const submittedDraft = cloneAgentSettingsDraft(draft.value)
    const input = toUpdateInput(submittedDraft)
    beginSaving()
    error.value = null
    try {
      applySavedSnapshot(
        await window.api.codingAgent.updateAgentSettings(input),
        submittedDraft,
        input
      )
      toast.success('Agent 设置已保存')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Agent 设置保存失败'
      toast.error('Agent 设置保存失败', error.value)
    } finally {
      finishSaving()
    }
  }

  async function saveDelivery(): Promise<void> {
    if (!draft.value) return
    await savePartial({ delivery: { ...draft.value.delivery } }, '消息投递保存失败')
  }

  async function saveRuntime(): Promise<void> {
    if (!draft.value) return
    await savePartial({ runtime: { ...draft.value.runtime } }, '运行时设置保存失败')
  }

  async function saveDisplay(): Promise<void> {
    if (!draft.value) return
    await savePartial(
      {
        display: {
          quietStartup: draft.value.display.quietStartup,
          collapseChangelog: draft.value.display.collapseChangelog,
          hideThinkingBlock: draft.value.display.hideThinkingBlock,
          doubleEscapeAction: draft.value.display.doubleEscapeAction,
          treeFilterMode: draft.value.display.treeFilterMode,
          editorPaddingX: draft.value.display.editorPaddingX,
          autocompleteMaxVisible: draft.value.display.autocompleteMaxVisible
        }
      },
      '显示与交互保存失败'
    )
  }

  async function saveSafety(): Promise<void> {
    if (!draft.value) return
    await savePartial({ safety: { ...draft.value.safety } }, '安全与遥测保存失败')
  }

  async function saveMedia(): Promise<void> {
    if (!draft.value) return
    await savePartial(
      {
        media: {
          imageAutoResize: draft.value.media.imageAutoResize,
          blockImages: draft.value.media.blockImages,
          imageWidthCells: draft.value.media.imageWidthCells
        }
      },
      '图片设置保存失败'
    )
  }

  async function saveResources(): Promise<void> {
    if (!draft.value) return
    await savePartial(
      {
        resources: {
          packages: cleanStringList(draft.value.resources.packages),
          extensions: cleanStringList(draft.value.resources.extensions),
          skills: cleanStringList(draft.value.resources.skills),
          prompts: cleanStringList(draft.value.resources.prompts)
        }
      },
      '资源路径保存失败'
    )
    await loadResourceSnapshot(resourceSnapshotInput.value)
  }

  async function loadResourceSnapshot(input: ResourceSnapshotInput = {}): Promise<void> {
    const normalizedInput = normalizeResourceSnapshotInput(input)
    const generation = ++resourceSnapshotGeneration
    if (
      getResourceSnapshotInputKey(normalizedInput) !==
      getResourceSnapshotInputKey(resourceSnapshotInput.value)
    ) {
      resourceSnapshot.value = null
    }
    resourceSnapshotInput.value = normalizedInput
    try {
      const nextSnapshot = await window.api.codingAgent.getResourceSnapshot(normalizedInput)
      if (generation === resourceSnapshotGeneration) {
        resourceSnapshot.value = nextSnapshot
      }
    } catch (cause) {
      if (generation === resourceSnapshotGeneration) {
        error.value = cause instanceof Error ? cause.message : '资源发现快照加载失败'
      }
    }
  }

  async function setExtensionPathEnabled(path: string, enabled: boolean): Promise<void> {
    if (!draft.value) return
    const disableEntry = `-${path}`
    const enableEntry = `+${path}`
    const next = draft.value.resources.extensions.filter(
      (entry) => entry !== disableEntry && entry !== enableEntry
    )
    next.push(enabled ? enableEntry : disableEntry)
    draft.value.resources.extensions = next
    await saveResources()
  }

  async function loadProjectExtensionPaths(projectId?: string): Promise<void> {
    const generation = ++projectExtensionPathsGeneration
    error.value = null
    if (!projectId) {
      projectExtensionPaths.value = []
      projectExtensionPathsProjectId.value = null
      return
    }
    if (projectExtensionPathsProjectId.value !== projectId) {
      projectExtensionPaths.value = []
      projectExtensionPathsProjectId.value = null
    }
    try {
      const paths = await window.api.codingAgent.getProjectExtensionPaths({ projectId })
      if (generation === projectExtensionPathsGeneration) {
        projectExtensionPaths.value = paths
        projectExtensionPathsProjectId.value = projectId
      }
    } catch (cause) {
      if (generation === projectExtensionPathsGeneration) {
        error.value = cause instanceof Error ? cause.message : '项目扩展路径加载失败'
      }
    }
  }

  async function saveProjectExtensionPaths(projectId: string, extensions: string[]): Promise<void> {
    const generation = ++projectExtensionPathsGeneration
    beginSaving()
    error.value = null
    try {
      const paths = await window.api.codingAgent.updateProjectExtensionPaths({
        projectId,
        extensions: cleanStringList(extensions)
      })
      if (generation !== projectExtensionPathsGeneration) return
      projectExtensionPaths.value = paths
      projectExtensionPathsProjectId.value = projectId
      await loadResourceSnapshot(resourceSnapshotInput.value)
      toast.success('项目扩展路径已保存')
    } catch (cause) {
      if (generation === projectExtensionPathsGeneration) {
        error.value = cause instanceof Error ? cause.message : '项目扩展路径保存失败'
        toast.error('项目扩展路径保存失败', error.value)
      }
    } finally {
      finishSaving()
    }
  }

  async function loadResourcePackages(input: ResourcePackageListInput = {}): Promise<void> {
    const normalizedInput = normalizeResourcePackageListInput(input)
    if (
      getResourcePackagesInputKey(normalizedInput) !==
      getResourcePackagesInputKey(resourcePackagesInput.value)
    ) {
      resourcePackages.value = []
    }
    resourcePackagesInput.value = normalizedInput
    const request = beginResourcePackagesRequest(normalizedInput)
    try {
      const packages = await window.api.codingAgent.listResourcePackages(request.input)
      if (isCurrentResourcePackagesRequest(request)) {
        resourcePackages.value = packages
      }
    } catch (cause) {
      if (isCurrentResourcePackagesRequest(request)) {
        error.value = cause instanceof Error ? cause.message : '资源包加载失败'
      }
    } finally {
      finishResourcePackagesRequest(request)
    }
  }

  async function addResourcePackage(input: ResourcePackageInput): Promise<void> {
    if (!canRunResourcePackageMutation(input.projectId)) return
    const request = beginResourcePackagesRequest(resourcePackagesInput.value)
    try {
      await window.api.codingAgent.addResourcePackage(input)
      if (await refreshAfterResourcePackageMutation(request, !input.projectId)) {
        toast.success('Package source 已添加')
      }
    } catch (cause) {
      if (isCurrentResourcePackagesRequest(request)) {
        error.value = cause instanceof Error ? cause.message : 'Package source 添加失败'
        toast.error('Package source 添加失败', error.value)
      }
    } finally {
      finishResourcePackagesRequest(request)
    }
  }

  async function installResourcePackage(input: ResourcePackageInput): Promise<void> {
    if (!canRunResourcePackageMutation(input.projectId)) return
    const request = beginResourcePackagesRequest(resourcePackagesInput.value)
    applyResourcePackageProgress({
      type: 'start',
      action: 'install',
      source: input.source,
      message: `Installing ${input.source}...`
    })
    try {
      await window.api.codingAgent.installResourcePackage(input)
      if (await refreshAfterResourcePackageMutation(request, !input.projectId)) {
        toast.success('Package 已安装')
      }
    } catch (cause) {
      if (isCurrentResourcePackagesRequest(request)) {
        error.value = cause instanceof Error ? cause.message : 'Package 安装失败'
        applyResourcePackageProgress({
          type: 'error',
          action: 'install',
          source: input.source,
          message: error.value
        })
        toast.error('Package 安装失败', error.value)
      }
    } finally {
      finishResourcePackagesRequest(request)
    }
  }

  async function removeResourcePackage(input: ResourcePackageInput): Promise<void> {
    if (!canRunResourcePackageMutation(input.projectId)) return
    const request = beginResourcePackagesRequest(resourcePackagesInput.value)
    try {
      await window.api.codingAgent.removeResourcePackage(input)
      if (await refreshAfterResourcePackageMutation(request, !input.projectId)) {
        toast.success('Package source 已移除')
      }
    } catch (cause) {
      if (isCurrentResourcePackagesRequest(request)) {
        error.value = cause instanceof Error ? cause.message : 'Package source 移除失败'
        toast.error('Package source 移除失败', error.value)
      }
    } finally {
      finishResourcePackagesRequest(request)
    }
  }

  async function updateResourcePackage(input: UpdateResourcePackageInput = {}): Promise<void> {
    if (!canRunResourcePackageMutation(input.projectId)) return
    const request = beginResourcePackagesRequest(resourcePackagesInput.value)
    if (input.source) {
      applyResourcePackageProgress({
        type: 'start',
        action: 'update',
        source: input.source,
        message: `Updating ${input.source}...`
      })
    }
    try {
      await window.api.codingAgent.updateResourcePackage(input)
      if (await refreshAfterResourcePackageMutation(request, false)) {
        toast.success(input.source ? 'Package 已更新' : 'Packages 已更新')
      }
    } catch (cause) {
      if (isCurrentResourcePackagesRequest(request)) {
        error.value = cause instanceof Error ? cause.message : 'Package 更新失败'
        if (input.source) {
          applyResourcePackageProgress({
            type: 'error',
            action: 'update',
            source: input.source,
            message: error.value
          })
        }
        toast.error('Package 更新失败', error.value)
      }
    } finally {
      finishResourcePackagesRequest(request)
    }
  }

  function beginResourcePackagesRequest(input: ResourcePackageListInput): ResourcePackagesRequest {
    const request = {
      generation: ++resourcePackagesGeneration,
      input: normalizeResourcePackageListInput(input)
    }
    resourcePackagesLoading.value = true
    error.value = null
    return request
  }

  function canRunResourcePackageMutation(projectId: string | undefined): boolean {
    return !projectId || projectId === resourcePackagesInput.value.projectId
  }

  function isCurrentResourcePackagesRequest(request: ResourcePackagesRequest): boolean {
    return (
      request.generation === resourcePackagesGeneration &&
      getResourcePackagesInputKey(request.input) ===
        getResourcePackagesInputKey(resourcePackagesInput.value)
    )
  }

  function finishResourcePackagesRequest(request: ResourcePackagesRequest): void {
    if (isCurrentResourcePackagesRequest(request)) {
      resourcePackagesLoading.value = false
    }
  }

  async function refreshAfterResourcePackageMutation(
    request: ResourcePackagesRequest,
    refreshAgentSettings: boolean
  ): Promise<boolean> {
    if (!isCurrentResourcePackagesRequest(request)) return false
    if (refreshAgentSettings) {
      const nextSnapshot = await window.api.codingAgent.getAgentSettings()
      if (!isCurrentResourcePackagesRequest(request)) return false
      applySnapshot(nextSnapshot)
    }
    const packages = await window.api.codingAgent.listResourcePackages(request.input)
    if (!isCurrentResourcePackagesRequest(request)) return false
    resourcePackages.value = packages
    await loadResourceSnapshot(resourceSnapshotInput.value)
    return isCurrentResourcePackagesRequest(request)
  }

  function applyResourcePackageProgress(event: ResourcePackageProgressEvent): void {
    const current = resourcePackageProgress.value[event.source]
    const next: ResourcePackageProgressState = {
      source: event.source,
      action: event.action,
      running: event.type === 'start' || event.type === 'progress',
      message: event.message ?? current?.message,
      error: event.type === 'error' ? event.message : undefined
    }
    if (event.type === 'complete') {
      next.running = false
      next.message = `${event.action} complete`
    }
    resourcePackageProgress.value = {
      ...resourcePackageProgress.value,
      [event.source]: next
    }
  }

  window.api.codingAgent.onEvent((event) => {
    if (event.type === 'resourcePackage') {
      applyResourcePackageProgress(event.event)
    }
  })

  async function saveShell(): Promise<void> {
    if (!draft.value) return
    await savePartial(
      {
        shell: {
          shellPath: draft.value.shell.shellPath,
          shellCommandPrefix: draft.value.shell.shellCommandPrefix,
          npmCommand: cleanStringList(draft.value.shell.npmCommand),
          sessionDir: draft.value.shell.sessionDir
        }
      },
      'Shell 设置保存失败'
    )
  }

  async function saveAdvanced(): Promise<void> {
    if (!draft.value) return
    await savePartial(
      {
        advanced: {
          thinkingBudgets: { ...draft.value.advanced.thinkingBudgets }
        }
      },
      '高级设置保存失败'
    )
  }

  async function savePartial(
    input: UpdateAgentSettingsInput,
    fallbackMessage: string
  ): Promise<void> {
    if (!draft.value || saving.value) return
    const submittedDraft = cloneAgentSettingsDraft(draft.value)
    beginSaving()
    error.value = null
    try {
      applySavedSnapshot(
        await window.api.codingAgent.updateAgentSettings(input),
        submittedDraft,
        input
      )
      toast.success('设置已保存')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : fallbackMessage
      toast.error(fallbackMessage, error.value)
    } finally {
      finishSaving()
    }
  }

  function beginSaving(): void {
    savingOperations += 1
    saving.value = true
  }

  function finishSaving(): void {
    savingOperations = Math.max(0, savingOperations - 1)
    saving.value = savingOperations > 0
  }

  function applySnapshot(nextSnapshot: AgentSettingsSnapshot): void {
    snapshot.value = nextSnapshot
    draft.value = cloneAgentSettingsDraft(nextSnapshot)
  }

  function applySavedSnapshot(
    nextSnapshot: AgentSettingsSnapshot,
    submittedDraft: AgentSettingsDraft,
    input: UpdateAgentSettingsInput
  ): void {
    const currentDraft = draft.value
      ? cloneAgentSettingsDraft(draft.value)
      : cloneAgentSettingsDraft(submittedDraft)
    const persistedDraft = cloneAgentSettingsDraft(nextSnapshot)
    snapshot.value = nextSnapshot
    draft.value = {
      delivery:
        input.delivery !== undefined
          ? mergeSavedSection(
              submittedDraft.delivery,
              currentDraft.delivery,
              persistedDraft.delivery
            )
          : currentDraft.delivery,
      runtime:
        input.runtime !== undefined
          ? mergeSavedSection(submittedDraft.runtime, currentDraft.runtime, persistedDraft.runtime)
          : currentDraft.runtime,
      display:
        input.display !== undefined
          ? mergeSavedSection(submittedDraft.display, currentDraft.display, persistedDraft.display)
          : currentDraft.display,
      safety:
        input.safety !== undefined
          ? mergeSavedSection(submittedDraft.safety, currentDraft.safety, persistedDraft.safety)
          : currentDraft.safety,
      media:
        input.media !== undefined
          ? mergeSavedSection(submittedDraft.media, currentDraft.media, persistedDraft.media)
          : currentDraft.media,
      resources:
        input.resources !== undefined
          ? mergeSavedSection(
              submittedDraft.resources,
              currentDraft.resources,
              persistedDraft.resources
            )
          : currentDraft.resources,
      shell:
        input.shell !== undefined
          ? mergeSavedSection(submittedDraft.shell, currentDraft.shell, persistedDraft.shell)
          : currentDraft.shell,
      advanced:
        input.advanced !== undefined
          ? mergeSavedSection(
              submittedDraft.advanced,
              currentDraft.advanced,
              persistedDraft.advanced
            )
          : currentDraft.advanced
    }
  }

  return {
    loading,
    saving,
    error,
    snapshot,
    draft,
    resourcePackages,
    resourcePackagesInput,
    projectExtensionPaths,
    projectExtensionPathsProjectId,
    resourceSnapshot,
    resourcePackagesLoading,
    resourcePackageProgress,
    diagnostics,
    resourceDiagnostics,
    discoveredExtensions,
    resolvedExtensionPaths,
    resourcePaths,
    storage,
    canSave,
    load,
    save,
    saveDelivery,
    saveRuntime,
    saveDisplay,
    saveSafety,
    saveMedia,
    saveResources,
    loadResourceSnapshot,
    setExtensionPathEnabled,
    loadProjectExtensionPaths,
    saveProjectExtensionPaths,
    loadResourcePackages,
    addResourcePackage,
    installResourcePackage,
    removeResourcePackage,
    updateResourcePackage,
    saveShell,
    saveAdvanced
  }
})

function cloneAgentSettingsDraft(value: AgentSettingsDraft): AgentSettingsDraft {
  return {
    delivery: { ...value.delivery },
    runtime: { ...value.runtime },
    display: { ...value.display },
    safety: { ...value.safety },
    media: { ...value.media },
    resources: {
      packages: [...value.resources.packages],
      extensions: [...value.resources.extensions],
      skills: [...value.resources.skills],
      prompts: [...value.resources.prompts],
      themes: [...value.resources.themes]
    },
    shell: {
      shellPath: value.shell.shellPath,
      shellCommandPrefix: value.shell.shellCommandPrefix,
      npmCommand: [...value.shell.npmCommand],
      sessionDir: value.shell.sessionDir
    },
    advanced: {
      thinkingBudgets: { ...value.advanced.thinkingBudgets },
      codeBlockIndent: value.advanced.codeBlockIndent
    }
  }
}

function mergeSavedSection<T>(submitted: T, current: T, persisted: T): T {
  return settingsValuesEqual(submitted, current) ? persisted : current
}

function settingsValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => settingsValuesEqual(value, right[index]))
    )
  }
  if (!isSettingsRecord(left) || !isSettingsRecord(right)) return false

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        settingsValuesEqual(left[key], right[key])
    )
  )
}

function isSettingsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toUpdateInput(draft: AgentSettingsDraft): UpdateAgentSettingsInput {
  return {
    delivery: { ...draft.delivery },
    runtime: { ...draft.runtime },
    display: {
      quietStartup: draft.display.quietStartup,
      collapseChangelog: draft.display.collapseChangelog,
      hideThinkingBlock: draft.display.hideThinkingBlock,
      doubleEscapeAction: draft.display.doubleEscapeAction,
      treeFilterMode: draft.display.treeFilterMode,
      editorPaddingX: draft.display.editorPaddingX,
      autocompleteMaxVisible: draft.display.autocompleteMaxVisible
    },
    safety: { ...draft.safety },
    media: {
      imageAutoResize: draft.media.imageAutoResize,
      blockImages: draft.media.blockImages,
      imageWidthCells: draft.media.imageWidthCells
    },
    resources: {
      packages: cleanStringList(draft.resources.packages),
      extensions: cleanStringList(draft.resources.extensions),
      skills: cleanStringList(draft.resources.skills),
      prompts: cleanStringList(draft.resources.prompts)
    },
    shell: {
      shellPath: draft.shell.shellPath,
      shellCommandPrefix: draft.shell.shellCommandPrefix,
      npmCommand: cleanStringList(draft.shell.npmCommand),
      sessionDir: draft.shell.sessionDir
    },
    advanced: {
      thinkingBudgets: { ...draft.advanced.thinkingBudgets }
    }
  }
}

function cleanStringList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

function normalizeResourceSnapshotInput(input: ResourceSnapshotInput): ResourceSnapshotInput {
  return {
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {})
  }
}

function getResourceSnapshotInputKey(input: ResourceSnapshotInput): string {
  if (input.threadId) return `thread:${input.threadId}`
  if (input.projectId) return `project:${input.projectId}`
  return 'global'
}

function normalizeResourcePackageListInput(
  input: ResourcePackageListInput
): ResourcePackageListInput {
  return input.projectId ? { projectId: input.projectId } : {}
}

function getResourcePackagesInputKey(input: ResourcePackageListInput): string {
  return input.projectId ?? ''
}

export default useAgentSettingsStore
