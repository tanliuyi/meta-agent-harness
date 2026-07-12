/**
 * 本文件测试 desktop worker service 的 fail-first 行为。
 */

import { describe, expect, it } from 'vitest'
import { UnboundDesktopWorkerService } from '../worker/service.ts'

/** UnboundDesktopWorkerService 测试套件。 */
describe('UnboundDesktopWorkerService', () => {
  /** 验证未绑定 thread 时拒绝 agent 命令。 */
  it('未绑定 thread 时拒绝 agent 命令', async () => {
    const service = new UnboundDesktopWorkerService()

    const response = await service.handle({
      kind: 'command',
      id: '1',
      command: { type: 'prompt', message: 'hello' }
    })

    expect(response.success).toBe(false)
    expect(response.error?.code).toBe('invalid_state')
  })

  /** 验证可以绑定 thread 并响应 ping。 */
  it('可以绑定 thread 并响应 ping', async () => {
    const service = new UnboundDesktopWorkerService()

    const start = await service.handle({
      kind: 'command',
      id: '1',
      command: { type: 'worker.startThread', input: { threadId: 'thread-1', cwd: 'H:/repo' } }
    })
    const ping = await service.handle({
      kind: 'command',
      id: '2',
      command: { type: 'worker.ping' }
    })

    expect(start.success).toBe(true)
    expect(ping.success).toBe(true)
  })

  /** 验证绑定后仍拒绝未接入 Runtime 的 agent 命令。 */
  it('绑定后仍拒绝未接入 Runtime 的 agent 命令', async () => {
    const service = new UnboundDesktopWorkerService()
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    const response = await service.handle({
      kind: 'command',
      id: '1',
      command: { type: 'abort' }
    })

    expect(response.success).toBe(false)
    expect(response.error?.code).toBe('runtime_error')
  })
})
