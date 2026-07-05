/**
 * agent-settings.ts - Pi agent 设置页状态。
 *
 * renderer 通过 preload 调用 main 进程 AgentSettingsService，不能直接读写
 * settings.json。
 */

import type {
  AgentSettingsSnapshot,
  ResourcePackageInput,
  ResourcePackageProgressEvent,
  ResourcePackageSummary,
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

const useAgentSettingsStore = defineStore('agent-settings', () => {
  const toast = useToast()
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const snapshot = ref<AgentSettingsSnapshot | null>(null)
  const draft = ref<AgentSettingsDraft | null>(null)
  const resourceSnapshot = ref<ResourceSnapshot | null>(null)
  const resourcePackages = ref<ResourcePackageSummary[]>([])
  const resourcePackagesLoading = ref(false)
  const resourcePackageProgress = ref<Record<string, ResourcePackageProgressState>>({})

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
    if (!draft.value) return
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.updateAgentSettings(toUpdateInput(draft.value)))
      toast.success('Agent 设置已保存')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Agent 设置保存失败'
      toast.error('Agent 设置保存失败', error.value)
    } finally {
      saving.value = false
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
    await savePartial({ display: { ...draft.value.display } }, '显示与交互保存失败')
  }

  async function saveSafety(): Promise<void> {
    if (!draft.value) return
    await savePartial({ safety: { ...draft.value.safety } }, '安全与遥测保存失败')
  }

  async function saveMedia(): Promise<void> {
    if (!draft.value) return
    await savePartial({ media: { ...draft.value.media } }, '图片与终端保存失败')
  }

  async function saveResources(): Promise<void> {
    if (!draft.value) return
    await savePartial(
      {
        resources: {
          packages: cleanStringList(draft.value.resources.packages),
          extensions: cleanStringList(draft.value.resources.extensions),
          skills: cleanStringList(draft.value.resources.skills),
          prompts: cleanStringList(draft.value.resources.prompts),
          themes: cleanStringList(draft.value.resources.themes)
        }
      },
      '资源路径保存失败'
    )
    await loadResourceSnapshot()
  }

  async function loadResourceSnapshot(): Promise<void> {
    try {
      resourceSnapshot.value = await window.api.codingAgent.getResourceSnapshot()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '资源发现快照加载失败'
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

  async function loadResourcePackages(): Promise<void> {
    resourcePackagesLoading.value = true
    error.value = null
    try {
      resourcePackages.value = await window.api.codingAgent.listResourcePackages()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '资源包加载失败'
    } finally {
      resourcePackagesLoading.value = false
    }
  }

  async function addResourcePackage(input: ResourcePackageInput): Promise<void> {
    resourcePackagesLoading.value = true
    error.value = null
    try {
      resourcePackages.value = await window.api.codingAgent.addResourcePackage(input)
      applySnapshot(await window.api.codingAgent.getAgentSettings())
      await loadResourceSnapshot()
      toast.success('Package source 已添加')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Package source 添加失败'
      toast.error('Package source 添加失败', error.value)
    } finally {
      resourcePackagesLoading.value = false
    }
  }

  async function installResourcePackage(input: ResourcePackageInput): Promise<void> {
    resourcePackagesLoading.value = true
    error.value = null
    applyResourcePackageProgress({
      type: 'start',
      action: 'install',
      source: input.source,
      message: `Installing ${input.source}...`
    })
    try {
      resourcePackages.value = await window.api.codingAgent.installResourcePackage(input)
      applySnapshot(await window.api.codingAgent.getAgentSettings())
      await loadResourceSnapshot()
      toast.success('Package 已安装')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Package 安装失败'
      applyResourcePackageProgress({
        type: 'error',
        action: 'install',
        source: input.source,
        message: error.value
      })
      toast.error('Package 安装失败', error.value)
    } finally {
      resourcePackagesLoading.value = false
    }
  }

  async function removeResourcePackage(input: ResourcePackageInput): Promise<void> {
    resourcePackagesLoading.value = true
    error.value = null
    try {
      resourcePackages.value = await window.api.codingAgent.removeResourcePackage(input)
      applySnapshot(await window.api.codingAgent.getAgentSettings())
      await loadResourceSnapshot()
      toast.success('Package source 已移除')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Package source 移除失败'
      toast.error('Package source 移除失败', error.value)
    } finally {
      resourcePackagesLoading.value = false
    }
  }

  async function updateResourcePackage(input: UpdateResourcePackageInput = {}): Promise<void> {
    resourcePackagesLoading.value = true
    error.value = null
    if (input.source) {
      applyResourcePackageProgress({
        type: 'start',
        action: 'update',
        source: input.source,
        message: `Updating ${input.source}...`
      })
    }
    try {
      resourcePackages.value = await window.api.codingAgent.updateResourcePackage(input)
      await loadResourceSnapshot()
      toast.success(input.source ? 'Package 已更新' : 'Packages 已更新')
    } catch (cause) {
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
    } finally {
      resourcePackagesLoading.value = false
    }
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
          thinkingBudgets: { ...draft.value.advanced.thinkingBudgets },
          codeBlockIndent: draft.value.advanced.codeBlockIndent
        }
      },
      '高级设置保存失败'
    )
  }

  async function savePartial(
    input: UpdateAgentSettingsInput,
    fallbackMessage: string
  ): Promise<void> {
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.updateAgentSettings(input))
      toast.success('设置已保存')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : fallbackMessage
      toast.error(fallbackMessage, error.value)
    } finally {
      saving.value = false
    }
  }

  function applySnapshot(nextSnapshot: AgentSettingsSnapshot): void {
    snapshot.value = nextSnapshot
    draft.value = {
      delivery: { ...nextSnapshot.delivery },
      runtime: { ...nextSnapshot.runtime },
      display: { ...nextSnapshot.display },
      safety: { ...nextSnapshot.safety },
      media: { ...nextSnapshot.media },
      resources: {
        packages: [...nextSnapshot.resources.packages],
        extensions: [...nextSnapshot.resources.extensions],
        skills: [...nextSnapshot.resources.skills],
        prompts: [...nextSnapshot.resources.prompts],
        themes: [...nextSnapshot.resources.themes]
      },
      shell: {
        shellPath: nextSnapshot.shell.shellPath,
        shellCommandPrefix: nextSnapshot.shell.shellCommandPrefix,
        npmCommand: [...nextSnapshot.shell.npmCommand],
        sessionDir: nextSnapshot.shell.sessionDir
      },
      advanced: {
        thinkingBudgets: { ...nextSnapshot.advanced.thinkingBudgets },
        codeBlockIndent: nextSnapshot.advanced.codeBlockIndent
      }
    }
  }

  return {
    loading,
    saving,
    error,
    snapshot,
    draft,
    resourcePackages,
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
    loadResourcePackages,
    addResourcePackage,
    installResourcePackage,
    removeResourcePackage,
    updateResourcePackage,
    saveShell,
    saveAdvanced
  }
})

function toUpdateInput(draft: AgentSettingsDraft): UpdateAgentSettingsInput {
  return {
    delivery: { ...draft.delivery },
    runtime: { ...draft.runtime },
    display: { ...draft.display },
    safety: { ...draft.safety },
    media: { ...draft.media },
    resources: {
      packages: cleanStringList(draft.resources.packages),
      extensions: cleanStringList(draft.resources.extensions),
      skills: cleanStringList(draft.resources.skills),
      prompts: cleanStringList(draft.resources.prompts),
      themes: cleanStringList(draft.resources.themes)
    },
    shell: {
      shellPath: draft.shell.shellPath,
      shellCommandPrefix: draft.shell.shellCommandPrefix,
      npmCommand: cleanStringList(draft.shell.npmCommand),
      sessionDir: draft.shell.sessionDir
    },
    advanced: {
      thinkingBudgets: { ...draft.advanced.thinkingBudgets },
      codeBlockIndent: draft.advanced.codeBlockIndent
    }
  }
}

function cleanStringList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

export default useAgentSettingsStore
