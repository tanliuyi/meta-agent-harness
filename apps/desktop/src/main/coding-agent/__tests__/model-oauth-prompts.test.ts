import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelOAuthPromptCoordinator } from '../model-oauth-prompts'

describe('ModelOAuthPromptCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('只接受创建 prompt 的 renderer owner 响应', async () => {
    const coordinator = new ModelOAuthPromptCoordinator()
    const onEvent = vi.fn()
    const result = coordinator.request({
      loginId: 'login-a',
      provider: 'openai-codex',
      ownerId: 7,
      prompt: { message: '输入授权码', allowEmpty: false },
      onEvent
    })
    const requestId = onEvent.mock.calls[0]?.[0].requestId as string

    expect(() =>
      coordinator.respond({ provider: 'openai-codex', requestId, value: 'secret' }, 8)
    ).toThrow('owner mismatch')
    coordinator.respond({ provider: 'openai-codex', requestId, value: 'secret' }, 7)

    await expect(result).resolves.toBe('secret')
    expect(onEvent).toHaveBeenLastCalledWith({
      type: 'promptResolved',
      provider: 'openai-codex',
      requestId
    })
  })

  it('owner 生命周期 abort 时拒绝并清理 pending prompt', async () => {
    const coordinator = new ModelOAuthPromptCoordinator()
    const lifetime = new AbortController()
    const onEvent = vi.fn()
    const result = coordinator.request({
      loginId: 'login-a',
      provider: 'openai-codex',
      ownerId: 7,
      prompt: { message: '输入授权码' },
      signal: lifetime.signal,
      onEvent
    })
    const requestId = onEvent.mock.calls[0]?.[0].requestId as string

    lifetime.abort()

    await expect(result).rejects.toThrow('OAuth 输入请求已取消')
    expect(() =>
      coordinator.respond({ provider: 'openai-codex', requestId, value: 'late' }, 7)
    ).toThrow('not found')
  })

  it('超过截止时间后自动拒绝 prompt', async () => {
    vi.useFakeTimers()
    const coordinator = new ModelOAuthPromptCoordinator()
    const result = coordinator.request({
      loginId: 'login-a',
      provider: 'openai-codex',
      prompt: { message: '输入授权码' },
      timeoutMs: 100
    })

    const expectation = expect(result).rejects.toThrow('OAuth 输入请求已超时')
    await vi.advanceTimersByTimeAsync(100)
    await expectation
  })

  it('结束一次 login 只清理本次 prompt，不影响同 provider 的并发 login', async () => {
    const coordinator = new ModelOAuthPromptCoordinator()
    const firstEvent = vi.fn()
    const secondEvent = vi.fn()
    const first = coordinator.request({
      loginId: 'login-a',
      provider: 'openai-codex',
      ownerId: 7,
      prompt: { message: '第一次登录' },
      onEvent: firstEvent
    })
    const second = coordinator.request({
      loginId: 'login-b',
      provider: 'openai-codex',
      ownerId: 8,
      prompt: { message: '第二次登录' },
      onEvent: secondEvent
    })
    const secondRequestId = secondEvent.mock.calls[0]?.[0].requestId as string
    const firstExpectation = expect(first).rejects.toThrow('OAuth 登录已结束')

    coordinator.rejectLogin('login-a')
    coordinator.respond(
      { provider: 'openai-codex', requestId: secondRequestId, value: 'second-secret' },
      8
    )

    await firstExpectation
    await expect(second).resolves.toBe('second-secret')
  })
})
