/**
 * 本文件测试统一 diagnostics store 的来源汇总。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import useAgentSettingsStore from '../agent-settings'
import useDiagnosticsStore from '../diagnostics'
import useModelSettingsStore from '../model-settings'

vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn()
  })
}))

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('diagnostics store', () => {
  it('汇总 thread、model 和 agent 诊断信息', async () => {
    const listDiagnostics = vi.fn().mockResolvedValue([
      {
        id: 'worker-a',
        threadId: 'thread-a',
        source: 'worker',
        severity: 'warning',
        message: 'worker stderr',
        details: { tail: 'stderr tail' },
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
    installCodingAgentApi({ listDiagnostics })

    const modelSettings = useModelSettingsStore()
    const agentSettings = useAgentSettingsStore()
    modelSettings.snapshot = {
      diagnostics: [
        {
          id: 'auth-missing',
          severity: 'error',
          source: 'auth',
          message: '缺少 API key'
        }
      ]
    } as typeof modelSettings.snapshot
    agentSettings.snapshot = {
      diagnostics: [
        {
          id: 'settings-load',
          severity: 'info',
          source: 'settings',
          message: 'settings.json 已加载'
        }
      ]
    } as typeof agentSettings.snapshot

    const diagnostics = useDiagnosticsStore()
    await diagnostics.load()

    expect(listDiagnostics).toHaveBeenCalledWith()
    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        id: 'model-auth-missing',
        domain: 'model',
        severity: 'error',
        message: '缺少 API key'
      }),
      expect.objectContaining({
        id: 'worker-a',
        domain: 'thread',
        severity: 'warning',
        details: '{"tail":"stderr tail"}',
        threadId: 'thread-a'
      }),
      expect.objectContaining({
        id: 'agent-settings-load',
        domain: 'agent',
        severity: 'info',
        message: 'settings.json 已加载'
      })
    ])
    expect(diagnostics.counts).toMatchObject({
      total: 3,
      error: 1,
      warning: 1,
      info: 1,
      thread: 1,
      model: 1,
      agent: 1
    })
  })
})

function installCodingAgentApi(overrides: Record<string, unknown>): void {
  vi.stubGlobal('window', {
    api: {
      codingAgent: {
        listDiagnostics: vi.fn().mockResolvedValue([]),
        getModelSettings: vi.fn(),
        getAgentSettings: vi.fn(),
        onEvent: vi.fn(() => vi.fn()),
        ...overrides
      }
    }
  })
}
