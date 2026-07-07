/**
 * 本文件测试 ThreadManagerCore 的按需服务初始化。
 */

import { describe, expect, it, vi } from 'vitest'
import { ThreadManagerCore } from '../thread-manager-core'
import type { AgentSettingsService } from '../agent-settings-service'
import type { ModelSettingsService } from '../model-settings-service'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

describe('ThreadManagerCore lazy services', () => {
  it('按需创建 model settings service 且只创建一次', async () => {
    const service = {} as ModelSettingsService
    const createService = vi.fn(() => service)
    const manager = new ThreadManagerCore(
      createWorkerRegistry(),
      undefined,
      undefined,
      undefined,
      createService
    )

    expect(createService).not.toHaveBeenCalled()
    await expect(manager.getModelSettingsService()).resolves.toBe(service)
    await expect(manager.getModelSettingsService()).resolves.toBe(service)
    expect(createService).toHaveBeenCalledTimes(1)
  })

  it('按需创建 agent settings service 且只创建一次', async () => {
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
    await expect(manager.getAgentSettingsService()).resolves.toBe(service)
    await expect(manager.getAgentSettingsService()).resolves.toBe(service)
    expect(createService).toHaveBeenCalledTimes(1)
  })

  it('异步创建 settings service 时并发调用只创建一次', async () => {
    const service = {} as AgentSettingsService
    const createService = vi.fn(async () => service)
    const manager = new ThreadManagerCore(
      createWorkerRegistry(),
      undefined,
      undefined,
      undefined,
      undefined,
      createService
    )

    await expect(
      Promise.all([manager.getAgentSettingsService(), manager.getAgentSettingsService()])
    ).resolves.toEqual([service, service])
    expect(createService).toHaveBeenCalledTimes(1)
  })
})

function createWorkerRegistry(): ThreadWorkerRegistry {
  return {
    listLeases: () => []
  } as unknown as ThreadWorkerRegistry
}
