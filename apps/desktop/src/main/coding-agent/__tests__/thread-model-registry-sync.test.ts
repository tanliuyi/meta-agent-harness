/**
 * 本文件测试全局模型配置变更向活动 thread worker 的同步。
 */

import type { ModelSettingsSnapshot } from '@shared/coding-agent/types'
import { describe, expect, it, vi } from 'vitest'
import type { ModelSettingsService } from '../model-settings-service'
import { CodingThreadManager } from '../thread-manager'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

const snapshot = {} as ModelSettingsSnapshot

describe('active thread model registry sync', () => {
  it('读取模型设置不依赖活动 thread worker', async () => {
    const send = vi.fn()
    const workers = {
      listLeases: () => [{ threadId: 'thread-a' }],
      send
    } as unknown as ThreadWorkerRegistry
    const service = {
      getModelSettings: vi.fn().mockResolvedValue(snapshot)
    } as unknown as ModelSettingsService
    const manager = new CodingThreadManager(workers, undefined, undefined, undefined, service)

    await expect(manager.getModelSettings()).resolves.toBe(snapshot)

    expect(send).not.toHaveBeenCalled()
  })

  it('保存 API key 后刷新所有活动 thread 的 auth 和模型 registry', async () => {
    const send = vi.fn().mockResolvedValue({
      kind: 'response',
      id: 'response',
      command: 'refresh_model_registry',
      success: true
    })
    const workers = {
      listLeases: () => [{ threadId: 'thread-a' }, { threadId: 'thread-b' }],
      send
    } as unknown as ThreadWorkerRegistry
    const service = {
      setProviderApiKey: vi.fn().mockResolvedValue(snapshot)
    } as unknown as ModelSettingsService
    const manager = new CodingThreadManager(workers, undefined, undefined, undefined, service)

    await expect(manager.setProviderApiKey({ provider: 'custom', key: 'secret' })).resolves.toBe(
      snapshot
    )

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith('thread-a', { type: 'refresh_model_registry' })
    expect(send).toHaveBeenCalledWith('thread-b', { type: 'refresh_model_registry' })
  })

  it('worker 刷新挂起时设置保存仍立即完成', async () => {
    const send = vi.fn(() => new Promise(() => undefined))
    const workers = {
      listLeases: () => [{ threadId: 'thread-a' }],
      send
    } as unknown as ThreadWorkerRegistry
    const service = {
      setProviderApiKey: vi.fn().mockResolvedValue(snapshot)
    } as unknown as ModelSettingsService
    const manager = new CodingThreadManager(workers, undefined, undefined, undefined, service)

    await expect(manager.setProviderApiKey({ provider: 'custom', key: 'secret' })).resolves.toBe(
      snapshot
    )
    expect(send).toHaveBeenCalledOnce()
  })

  it('新增自定义 modelId 后刷新活动 thread', async () => {
    const send = vi.fn().mockResolvedValue({
      kind: 'response',
      id: 'response',
      command: 'refresh_model_registry',
      success: true
    })
    const workers = {
      listLeases: () => [{ threadId: 'thread-a' }],
      send
    } as unknown as ThreadWorkerRegistry
    const service = {
      upsertCustomProvider: vi.fn().mockResolvedValue(snapshot)
    } as unknown as ModelSettingsService
    const manager = new CodingThreadManager(workers, undefined, undefined, undefined, service)
    const input = {
      provider: 'custom',
      baseUrl: 'http://localhost:8080/v1',
      api: 'openai-completions' as const,
      models: [{ id: 'new-model' }]
    }

    await expect(manager.upsertCustomProvider(input)).resolves.toBe(snapshot)

    expect(service.upsertCustomProvider).toHaveBeenCalledWith(input)
    expect(send).toHaveBeenCalledWith('thread-a', { type: 'refresh_model_registry' })
  })

  it('没有活动 thread 时模型配置刷新不启动 inactive worker', async () => {
    const send = vi.fn()
    const workers = {
      listLeases: () => [],
      send
    } as unknown as ThreadWorkerRegistry
    const service = {
      refreshModelRegistry: vi.fn().mockResolvedValue(snapshot)
    } as unknown as ModelSettingsService
    const manager = new CodingThreadManager(workers, undefined, undefined, undefined, service)

    await expect(manager.refreshModelRegistry()).resolves.toBe(snapshot)

    expect(send).not.toHaveBeenCalled()
  })
})
