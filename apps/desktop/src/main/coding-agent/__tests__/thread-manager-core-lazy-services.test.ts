/**
 * 本文件测试 ThreadManagerCore 的按需服务初始化。
 */

import { describe, expect, it, vi } from 'vitest'
import { ThreadManagerCore } from '../thread-manager-core'
import type { AgentSettingsService } from '../agent-settings-service'
import type { ModelSettingsService } from '../model-settings-service'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

describe('ThreadManagerCore lazy services', () => {
  it('按需创建 model settings service 且只创建一次', () => {
    const service = {} as ModelSettingsService
    const createService = vi.fn(() => service)
    const manager = new ThreadManagerCore(createWorkerRegistry(), undefined, undefined, undefined, createService)

    expect(createService).not.toHaveBeenCalled()
    expect(manager.getModelSettingsService()).toBe(service)
    expect(manager.getModelSettingsService()).toBe(service)
    expect(createService).toHaveBeenCalledTimes(1)
  })

  it('按需创建 agent settings service 且只创建一次', () => {
    const service = {} as AgentSettingsService
    const createService = vi.fn(() => service)
    const manager = new ThreadManagerCore(
      createWorkerRegistry(),
      undefined,
      undefined,
      undefined,
      undefined,
      createService
    )

    expect(createService).not.toHaveBeenCalled()
    expect(manager.getAgentSettingsService()).toBe(service)
    expect(manager.getAgentSettingsService()).toBe(service)
    expect(createService).toHaveBeenCalledTimes(1)
  })
})

function createWorkerRegistry(): ThreadWorkerRegistry {
  return {
    listLeases: () => []
  } as unknown as ThreadWorkerRegistry
}
