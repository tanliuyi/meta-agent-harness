/**
 * 本文件测试 Agent settings store 的加载边界。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
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
})

function installCodingAgentApi(overrides: Record<string, unknown>): void {
  vi.stubGlobal('window', {
    api: {
      codingAgent: {
        getAgentSettings: vi.fn(),
        getResourceSnapshot: vi.fn(),
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
