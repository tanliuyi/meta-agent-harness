/**
 * 本文件测试 Agent settings store 的加载边界。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isProxy } from 'vue'
import useAgentSettingsStore from '../agent-settings'
import type { AgentSettingsSnapshot } from '@shared/coding-agent/types'

vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn()
  })
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('agent-settings store', () => {
  it('加载通用 Agent 设置时不触发 resource snapshot 发现', async () => {
    const getAgentSettings = vi.fn().mockResolvedValue(createAgentSettingsSnapshot())
    const getResourceSnapshot = vi.fn().mockResolvedValue({
      resources: {
        extensions: [],
        skills: [],
        prompts: [],
        themes: []
      },
      extensions: [],
      diagnostics: []
    })
    installCodingAgentApi({ getAgentSettings, getResourceSnapshot })

    const store = useAgentSettingsStore()
    await store.load()

    expect(getAgentSettings).toHaveBeenCalledTimes(1)
    expect(getResourceSnapshot).not.toHaveBeenCalled()
    expect(store.snapshot?.storage.agentDir).toBe('/tmp/agent')
    expect(store.resourceSnapshot).toBeNull()
  })

  it('保存资源后沿用当前 resource snapshot 输入刷新', async () => {
    const snapshot = createAgentSettingsSnapshot()
    const updateAgentSettings = vi.fn().mockResolvedValue(snapshot)
    const getResourceSnapshot = vi.fn().mockResolvedValue({
      resources: {
        extensions: [],
        skills: [],
        prompts: [],
        themes: []
      },
      extensions: [],
      diagnostics: []
    })
    installCodingAgentApi({
      getAgentSettings: vi.fn().mockResolvedValue(snapshot),
      updateAgentSettings,
      getResourceSnapshot
    })

    const store = useAgentSettingsStore()
    await store.load()
    await store.loadResourceSnapshot({ threadId: 'thread-a' })
    await store.saveResources()

    expect(getResourceSnapshot).toHaveBeenNthCalledWith(1, { threadId: 'thread-a' })
    expect(getResourceSnapshot).toHaveBeenNthCalledWith(2, { threadId: 'thread-a' })
    const refreshedInput = getResourceSnapshot.mock.calls[1]?.[0]
    expect(isProxy(refreshedInput)).toBe(false)
    expect(() => structuredClone(refreshedInput)).not.toThrow()
  })

  it('禁用用户级扩展路径时写入全局 resources 并刷新快照', async () => {
    const snapshot = createAgentSettingsSnapshot()
    const updateAgentSettings = vi.fn().mockResolvedValue(snapshot)
    const getResourceSnapshot = vi.fn().mockResolvedValue({
      resources: {
        extensions: [],
        skills: [],
        prompts: [],
        themes: []
      },
      extensions: [],
      diagnostics: []
    })
    installCodingAgentApi({
      getAgentSettings: vi.fn().mockResolvedValue(snapshot),
      updateAgentSettings,
      getResourceSnapshot
    })

    const store = useAgentSettingsStore()
    await store.load()
    await store.loadResourceSnapshot({ cwd: '/project', projectTrusted: true })
    await store.setExtensionPathEnabled('/project/ext.ts', false)

    expect(updateAgentSettings).toHaveBeenCalledWith({
      resources: {
        packages: [],
        extensions: ['-/project/ext.ts'],
        skills: [],
        prompts: []
      }
    })
    expect(getResourceSnapshot).toHaveBeenLastCalledWith({ cwd: '/project', projectTrusted: true })
  })

  it('保存项目级扩展路径时调用 project IPC 并沿用当前视角刷新', async () => {
    const getResourceSnapshot = vi.fn().mockResolvedValue({
      resources: {
        extensions: [
          {
            path: '/project/ext.ts',
            enabled: false,
            sourceInfo: {
              path: '/project/ext.ts',
              source: 'local',
              scope: 'project',
              origin: 'top-level'
            }
          }
        ],
        skills: [],
        prompts: [],
        themes: []
      },
      extensions: [],
      diagnostics: []
    })
    const updateProjectExtensionPaths = vi.fn().mockResolvedValue(['-/project/ext.ts'])
    installCodingAgentApi({
      getResourceSnapshot,
      updateProjectExtensionPaths
    })

    const store = useAgentSettingsStore()
    await store.loadResourceSnapshot({ cwd: '/project', projectTrusted: true })
    await store.saveProjectExtensionPaths('/project', ['-/project/ext.ts'])

    expect(updateProjectExtensionPaths).toHaveBeenCalledWith({
      cwd: '/project',
      extensions: ['-/project/ext.ts']
    })
    expect(store.projectExtensionPaths).toEqual(['-/project/ext.ts'])
    expect(store.projectExtensionPathsCwd).toBe('/project')
    expect(getResourceSnapshot).toHaveBeenLastCalledWith({ cwd: '/project', projectTrusted: true })
    expect(store.resolvedExtensionPaths[0]).toEqual(
      expect.objectContaining({
        path: '/project/ext.ts',
        enabled: false
      })
    )
  })

  it('保存显示与交互时不提交 terminal-only 字段', async () => {
    const snapshot = createAgentSettingsSnapshot()
    snapshot.display.theme = 'minimal'
    const updateAgentSettings = vi.fn().mockResolvedValue(snapshot)
    installCodingAgentApi({
      getAgentSettings: vi.fn().mockResolvedValue(snapshot),
      updateAgentSettings
    })

    const store = useAgentSettingsStore()
    await store.load()
    await store.saveDisplay()

    expect(updateAgentSettings).toHaveBeenCalledWith({
      display: {
        quietStartup: false,
        collapseChangelog: true,
        hideThinkingBlock: false,
        doubleEscapeAction: 'tree',
        treeFilterMode: 'all',
        editorPaddingX: 12,
        autocompleteMaxVisible: 8
      }
    })
  })

  it('保存图片设置时不提交终端呈现字段', async () => {
    const snapshot = createAgentSettingsSnapshot()
    const updateAgentSettings = vi.fn().mockResolvedValue(snapshot)
    installCodingAgentApi({
      getAgentSettings: vi.fn().mockResolvedValue(snapshot),
      updateAgentSettings
    })

    const store = useAgentSettingsStore()
    await store.load()
    await store.saveMedia()

    expect(updateAgentSettings).toHaveBeenCalledWith({
      media: {
        imageAutoResize: true,
        blockImages: false,
        imageWidthCells: 80
      }
    })
  })

  it('保存资源和高级设置时不提交 terminal theme 或 markdown 渲染字段', async () => {
    const snapshot = createAgentSettingsSnapshot()
    snapshot.resources.themes = ['~/pi/themes']
    const updateAgentSettings = vi.fn().mockResolvedValue(snapshot)
    installCodingAgentApi({
      getAgentSettings: vi.fn().mockResolvedValue(snapshot),
      updateAgentSettings,
      getResourceSnapshot: vi.fn().mockResolvedValue({
        resources: {
          extensions: [],
          skills: [],
          prompts: [],
          themes: []
        },
        extensions: [],
        diagnostics: []
      })
    })

    const store = useAgentSettingsStore()
    await store.load()
    await store.saveResources()
    await store.saveAdvanced()

    expect(updateAgentSettings).toHaveBeenNthCalledWith(1, {
      resources: {
        packages: [],
        extensions: [],
        skills: [],
        prompts: []
      }
    })
    expect(updateAgentSettings).toHaveBeenNthCalledWith(2, {
      advanced: {
        thinkingBudgets: {}
      }
    })
  })
})

function installCodingAgentApi(overrides: Record<string, unknown>): void {
  vi.stubGlobal('window', {
    api: {
      codingAgent: {
        getAgentSettings: vi.fn(),
        getResourceSnapshot: vi.fn(),
        getProjectExtensionPaths: vi.fn(),
        updateProjectExtensionPaths: vi.fn(),
        onEvent: vi.fn(() => vi.fn()),
        ...overrides
      }
    }
  })
}

function createAgentSettingsSnapshot(): AgentSettingsSnapshot {
  return {
    delivery: {
      steeringMode: 'all',
      followUpMode: 'all',
      transport: 'auto'
    },
    runtime: {
      workerMode: 'nodeSidecar',
      compactionEnabled: true,
      compactionReserveTokens: 4096,
      compactionKeepRecentTokens: 2048,
      branchSummaryReserveTokens: 4096,
      branchSummarySkipPrompt: false,
      retryEnabled: true,
      retryMaxRetries: 2,
      retryBaseDelayMs: 500,
      providerRetryMaxRetryDelayMs: 5000,
      httpIdleTimeoutMs: 30000
    },
    display: {
      quietStartup: false,
      collapseChangelog: true,
      hideThinkingBlock: false,
      doubleEscapeAction: 'tree',
      treeFilterMode: 'all',
      showHardwareCursor: true,
      editorPaddingX: 12,
      autocompleteMaxVisible: 8
    },
    safety: {
      defaultProjectTrust: 'ask',
      enableInstallTelemetry: false,
      enableAnalytics: false,
      enableSkillCommands: true,
      warnAnthropicExtraUsage: true
    },
    media: {
      imageAutoResize: true,
      blockImages: false,
      showImages: true,
      imageWidthCells: 80,
      clearOnShrink: true,
      showTerminalProgress: true
    },
    resources: {
      packages: [],
      extensions: [],
      skills: [],
      prompts: [],
      themes: []
    },
    shell: {
      npmCommand: []
    },
    advanced: {
      thinkingBudgets: {},
      codeBlockIndent: '  '
    },
    storage: {
      agentDir: '/tmp/agent',
      settingsPath: '/tmp/agent/settings.json'
    },
    diagnostics: []
  }
}
