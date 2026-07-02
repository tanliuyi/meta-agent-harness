/**
 * agent-settings.ts - Pi agent 设置页状态。
 *
 * renderer 通过 preload 调用 main 进程 AgentSettingsService，不能直接读写
 * settings.json。
 */

import type { AgentSettingsSnapshot, UpdateAgentSettingsInput } from '@shared/coding-agent/types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

type AgentSettingsDraft = Omit<AgentSettingsSnapshot, 'storage' | 'diagnostics'>

const useAgentSettingsStore = defineStore('agent-settings', () => {
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const snapshot = ref<AgentSettingsSnapshot | null>(null)
  const draft = ref<AgentSettingsDraft | null>(null)

  const diagnostics = computed(() => snapshot.value?.diagnostics ?? [])
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
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Agent 设置保存失败'
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
          packages: [...draft.value.resources.packages],
          extensions: [...draft.value.resources.extensions],
          skills: [...draft.value.resources.skills],
          prompts: [...draft.value.resources.prompts],
          themes: [...draft.value.resources.themes]
        }
      },
      '资源路径保存失败'
    )
  }

  async function saveShell(): Promise<void> {
    if (!draft.value) return
    await savePartial(
      {
        shell: {
          shellPath: draft.value.shell.shellPath,
          shellCommandPrefix: draft.value.shell.shellCommandPrefix,
          npmCommand: [...draft.value.shell.npmCommand],
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

  async function savePartial(input: UpdateAgentSettingsInput, fallbackMessage: string): Promise<void> {
    saving.value = true
    error.value = null
    try {
      applySnapshot(await window.api.codingAgent.updateAgentSettings(input))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : fallbackMessage
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
    diagnostics,
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
      packages: [...draft.resources.packages],
      extensions: [...draft.resources.extensions],
      skills: [...draft.resources.skills],
      prompts: [...draft.resources.prompts],
      themes: [...draft.resources.themes]
    },
    shell: {
      shellPath: draft.shell.shellPath,
      shellCommandPrefix: draft.shell.shellCommandPrefix,
      npmCommand: [...draft.shell.npmCommand],
      sessionDir: draft.shell.sessionDir
    },
    advanced: {
      thinkingBudgets: { ...draft.advanced.thinkingBudgets },
      codeBlockIndent: draft.advanced.codeBlockIndent
    }
  }
}

export default useAgentSettingsStore
