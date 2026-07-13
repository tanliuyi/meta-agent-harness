/**
 * 本文件测试 Agent settings store 的加载边界。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isProxy } from 'vue'
import useAgentSettingsStore from '../agent-settings'
import type { AgentSettingsSnapshot, ResourceSnapshot } from '@shared/coding-agent/types'

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
    await store.loadResourceSnapshot({ projectId: 'project-a' })
    await store.setExtensionPathEnabled('/project/ext.ts', false)

    expect(updateAgentSettings).toHaveBeenCalledWith({
      resources: {
        packages: [],
        extensions: ['-/project/ext.ts'],
        skills: [],
        prompts: []
      }
    })
    expect(getResourceSnapshot).toHaveBeenLastCalledWith({ projectId: 'project-a' })
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
    await store.loadResourceSnapshot({ projectId: 'project-a' })
    await store.saveProjectExtensionPaths('project-a', ['-/project/ext.ts'])

    expect(updateProjectExtensionPaths).toHaveBeenCalledWith({
      projectId: 'project-a',
      extensions: ['-/project/ext.ts']
    })
    expect(store.projectExtensionPaths).toEqual(['-/project/ext.ts'])
    expect(store.projectExtensionPathsProjectId).toBe('project-a')
    expect(getResourceSnapshot).toHaveBeenLastCalledWith({ projectId: 'project-a' })
    expect(store.resolvedExtensionPaths[0]).toEqual(
      expect.objectContaining({
        path: '/project/ext.ts',
        enabled: false
      })
    )
  })

  it('忽略晚到的旧 resource snapshot 响应', async () => {
    const first = createDeferred<ReturnType<typeof createResourceSnapshot>>()
    const second = createDeferred<ReturnType<typeof createResourceSnapshot>>()
    const getResourceSnapshot = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    installCodingAgentApi({ getResourceSnapshot })
    const store = useAgentSettingsStore()

    const firstLoad = store.loadResourceSnapshot({ projectId: 'project-a' })
    const secondLoad = store.loadResourceSnapshot({ projectId: 'project-b' })
    second.resolve(createResourceSnapshot('project-b'))
    await secondLoad
    first.resolve(createResourceSnapshot('project-a'))
    await firstLoad

    expect(store.resourceSnapshot?.diagnostics).toEqual([
      expect.objectContaining({ message: 'project-b' })
    ])
  })

  it('切换 resource snapshot 上下文时立即清空旧项目资源', async () => {
    const next = createDeferred<ReturnType<typeof createResourceSnapshot>>()
    const getResourceSnapshot = vi
      .fn()
      .mockResolvedValueOnce(createResourceSnapshot('project-a'))
      .mockReturnValueOnce(next.promise)
    installCodingAgentApi({ getResourceSnapshot })
    const store = useAgentSettingsStore()
    await store.loadResourceSnapshot({ projectId: 'project-a' })

    const nextLoad = store.loadResourceSnapshot({ projectId: 'project-b' })

    expect(store.resourceSnapshot).toBeNull()
    next.resolve(createResourceSnapshot('project-b'))
    await nextLoad
  })

  it('忽略晚到的旧项目 extension 路径响应', async () => {
    const first = createDeferred<string[]>()
    const second = createDeferred<string[]>()
    const getProjectExtensionPaths = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    installCodingAgentApi({ getProjectExtensionPaths })
    const store = useAgentSettingsStore()

    const firstLoad = store.loadProjectExtensionPaths('project-a')
    const secondLoad = store.loadProjectExtensionPaths('project-b')
    second.resolve(['/project-b/ext.ts'])
    await secondLoad
    first.resolve(['/project-a/ext.ts'])
    await firstLoad

    expect(store.projectExtensionPathsProjectId).toBe('project-b')
    expect(store.projectExtensionPaths).toEqual(['/project-b/ext.ts'])
  })

  it('切换项目路径上下文时立即清空旧项目路径', async () => {
    const next = createDeferred<string[]>()
    const getProjectExtensionPaths = vi
      .fn()
      .mockResolvedValueOnce(['/project-a/ext.ts'])
      .mockReturnValueOnce(next.promise)
    installCodingAgentApi({ getProjectExtensionPaths })
    const store = useAgentSettingsStore()
    await store.loadProjectExtensionPaths('project-a')

    const nextLoad = store.loadProjectExtensionPaths('project-b')

    expect(store.projectExtensionPathsProjectId).toBeNull()
    expect(store.projectExtensionPaths).toEqual([])
    next.resolve(['/project-b/ext.ts'])
    await nextLoad
  })

  it('切到无项目视角时取消仍在等待的项目路径响应', async () => {
    const pending = createDeferred<string[]>()
    installCodingAgentApi({
      getProjectExtensionPaths: vi.fn().mockReturnValue(pending.promise)
    })
    const store = useAgentSettingsStore()

    const load = store.loadProjectExtensionPaths('project-a')
    await store.loadProjectExtensionPaths()
    pending.resolve(['/project-a/ext.ts'])
    await load

    expect(store.projectExtensionPathsProjectId).toBeNull()
    expect(store.projectExtensionPaths).toEqual([])
  })

  it('忽略晚到的旧项目 package 列表响应', async () => {
    const first = createDeferred<Array<{ source: string; scope: 'user'; filtered: boolean }>>()
    const second = createDeferred<Array<{ source: string; scope: 'user'; filtered: boolean }>>()
    const listResourcePackages = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    installCodingAgentApi({ listResourcePackages })
    const store = useAgentSettingsStore()

    const firstLoad = store.loadResourcePackages({ projectId: 'project-a' })
    const secondLoad = store.loadResourcePackages({ projectId: 'project-b' })
    second.resolve([{ source: 'project-b', scope: 'user', filtered: false }])
    await secondLoad
    first.resolve([{ source: 'project-a', scope: 'user', filtered: false }])
    await firstLoad

    expect(store.resourcePackages).toEqual([
      { source: 'project-b', scope: 'user', filtered: false }
    ])
  })

  it('切换项目后忽略旧 package mutation 的列表与 loading 响应', async () => {
    const mutation = createDeferred<Array<{ source: string; scope: 'user'; filtered: boolean }>>()
    const projectBLoad =
      createDeferred<Array<{ source: string; scope: 'user'; filtered: boolean }>>()
    const listResourcePackages = vi
      .fn()
      .mockResolvedValueOnce([{ source: 'project-a', scope: 'user', filtered: false }])
      .mockReturnValueOnce(projectBLoad.promise)
    const getAgentSettings = vi.fn().mockResolvedValue(createAgentSettingsSnapshot())
    installCodingAgentApi({
      addResourcePackage: vi.fn().mockReturnValue(mutation.promise),
      getAgentSettings,
      listResourcePackages
    })
    const store = useAgentSettingsStore()
    await store.loadResourcePackages({ projectId: 'project-a' })

    const pendingMutation = store.addResourcePackage({ source: 'user-package' })
    expect(store.resourcePackagesLoading).toBe(true)
    const projectBLoading = store.loadResourcePackages({ projectId: 'project-b' })
    expect(store.resourcePackages).toEqual([])
    projectBLoad.resolve([{ source: 'project-b', scope: 'user', filtered: false }])
    await projectBLoading
    expect(store.resourcePackagesLoading).toBe(false)

    mutation.resolve([{ source: 'mutation-response', scope: 'user', filtered: false }])
    await pendingMutation

    expect(store.resourcePackagesInput).toEqual({ projectId: 'project-b' })
    expect(store.resourcePackages).toEqual([
      { source: 'project-b', scope: 'user', filtered: false }
    ])
    expect(store.resourcePackagesLoading).toBe(false)
    expect(getAgentSettings).not.toHaveBeenCalled()
    expect(listResourcePackages).toHaveBeenCalledTimes(2)
  })

  it('项目视角的用户级 package mutation 完成后重新加载合并列表', async () => {
    const listResourcePackages = vi
      .fn()
      .mockResolvedValueOnce([{ source: 'before', scope: 'user', filtered: false }])
      .mockResolvedValueOnce([
        { source: 'user-package', scope: 'user', filtered: false },
        { source: 'project-package', scope: 'project', filtered: false }
      ])
    installCodingAgentApi({
      addResourcePackage: vi
        .fn()
        .mockResolvedValue([{ source: 'user-package', scope: 'user', filtered: false }]),
      getAgentSettings: vi.fn().mockResolvedValue(createAgentSettingsSnapshot()),
      getResourceSnapshot: vi.fn().mockResolvedValue(createResourceSnapshot()),
      listResourcePackages
    })
    const store = useAgentSettingsStore()
    await store.loadResourcePackages({ projectId: 'project-a' })

    await store.addResourcePackage({ source: 'user-package' })

    expect(listResourcePackages).toHaveBeenLastCalledWith({ projectId: 'project-a' })
    expect(store.resourcePackages).toEqual([
      { source: 'user-package', scope: 'user', filtered: false },
      { source: 'project-package', scope: 'project', filtered: false }
    ])
    expect(store.resourcePackagesLoading).toBe(false)
  })

  it('保存显示与交互时不提交 TUI-only 字段', async () => {
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

  it('partial save 保留未提交 section 与请求期间的新编辑', async () => {
    const initial = createAgentSettingsSnapshot()
    const response = createAgentSettingsSnapshot()
    response.safety.browserCdpAccess = 'full'
    const update = createDeferred<AgentSettingsSnapshot>()
    const updateAgentSettings = vi.fn().mockReturnValue(update.promise)
    installCodingAgentApi({
      getAgentSettings: vi.fn().mockResolvedValue(initial),
      updateAgentSettings
    })
    const store = useAgentSettingsStore()
    await store.load()

    store.draft!.safety.browserCdpAccess = 'full'
    store.draft!.display.quietStartup = true
    const saving = store.saveSafety()
    store.draft!.safety.filesystemAccess = 'full'

    update.resolve(response)
    await saving

    expect(store.snapshot?.safety).toMatchObject({
      browserCdpAccess: 'full',
      filesystemAccess: 'safe'
    })
    expect(store.draft?.safety).toMatchObject({
      browserCdpAccess: 'full',
      filesystemAccess: 'full'
    })
    expect(store.draft?.display.quietStartup).toBe(true)
  })

  it('已有保存请求完成前不启动第二个 partial save', async () => {
    const snapshot = createAgentSettingsSnapshot()
    const update = createDeferred<AgentSettingsSnapshot>()
    const updateAgentSettings = vi.fn().mockReturnValue(update.promise)
    installCodingAgentApi({
      getAgentSettings: vi.fn().mockResolvedValue(snapshot),
      updateAgentSettings
    })
    const store = useAgentSettingsStore()
    await store.load()

    const safetySave = store.saveSafety()
    store.draft!.display.quietStartup = true
    await store.saveDisplay()

    expect(updateAgentSettings).toHaveBeenCalledTimes(1)
    update.resolve(snapshot)
    await safetySave
    expect(store.draft?.display.quietStartup).toBe(true)
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

  it('保存资源和高级设置时不提交 TUI theme 或 markdown 渲染字段', async () => {
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

function createResourceSnapshot(marker = ''): ResourceSnapshot {
  return {
    resources: { extensions: [], skills: [], prompts: [], themes: [] },
    extensions: [],
    diagnostics: marker ? [{ type: 'warning' as const, message: marker }] : []
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
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
      warnAnthropicExtraUsage: true,
      browserCdpAccess: 'safe',
      browserWebPermissions: 'prompt',
      filesystemAccess: 'safe',
      extensionUrlAccess: 'safe',
      externalProtocolAccess: 'safe'
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
