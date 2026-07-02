/**
 * 本文件测试 TransportWorkerClient 的请求超时、启动超时和 hang 检测。
 */

import { describe, expect, it } from 'vitest'
import { TransportWorkerClient } from '../transport-worker-client'
import type {
  WorkerEnvelope,
  WorkerHangInfo,
  WorkerResponseEnvelope,
  WorkerTransport
} from '../worker-types'

describe('TransportWorkerClient', () => {
  it('请求超时后会 reject', async () => {
    const transport = createFakeTransport()
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport,
      requestTimeoutMs: 50,
      inactivityTimeoutMs: 10000,
      now: () => 0
    })

    await expect(client.send({ type: 'test.command' })).rejects.toThrow(
      'request timed out: test.command'
    )
  })

  it('启动线程成功时返回 resolved', async () => {
    const transport = createFakeTransport()
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport,
      requestTimeoutMs: 50,
      inactivityTimeoutMs: 10000,
      now: () => 0
    })

    transport.respondTo('worker.startThread', { success: true })
    const sendPromise = client.startThread({ threadId: 'thread-a', cwd: '/tmp' })
    await expect(sendPromise).resolves.toBeUndefined()
    expect(client.threadId).toBe('thread-a')
  })

  it('未配置无消息超时时不会因 idle 关闭 worker', async () => {
    let now = 0
    const transport = createFakeTransport()
    const hangInfo: WorkerHangInfo[] = []
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport,
      requestTimeoutMs: 1000,
      now: () => now,
      onHang: (info) => hangInfo.push(info)
    })

    transport.respondTo('worker.startThread', { success: true })
    await client.startThread({ threadId: 'thread-a', cwd: '/tmp' })
    now = 60000
    await waitMs(150)

    expect(hangInfo).toHaveLength(0)
    expect(transport.isClosed()).toBe(false)
  })

  it('传输层关闭后发送命令返回 worker_exited', async () => {
    const transport = createFakeTransport()
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport,
      requestTimeoutMs: 1000,
      now: () => 0
    })

    transport.close()

    await expect(client.send({ type: 'test.command' })).resolves.toMatchObject({
      success: false,
      error: { code: 'worker_exited' }
    })
  })

  it('启动线程超时时 reject', async () => {
    const transport = createFakeTransport()
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport,
      requestTimeoutMs: 1000,
      startupTimeoutMs: 50,
      inactivityTimeoutMs: 10000,
      now: () => 0
    })

    await expect(client.startThread({ threadId: 'thread-a', cwd: '/tmp' })).rejects.toThrow(
      'startThread timed out after 50ms'
    )
  })

  it('长时间无消息时触发 onHang 并停止 worker', async () => {
    let now = 0
    const transport = createFakeTransport()
    const hangInfo: WorkerHangInfo[] = []
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport,
      requestTimeoutMs: 1000,
      inactivityTimeoutMs: 100,
      now: () => now,
      onHang: (info) => hangInfo.push(info)
    })

    transport.respondTo('worker.startThread', { success: true })
    await client.startThread({ threadId: 'thread-a', cwd: '/tmp' })
    now = 150
    await waitMs(150)

    expect(hangInfo).toHaveLength(1)
    expect(hangInfo[0]).toMatchObject({
      workerId: 'worker-1',
      threadId: 'thread-a',
      silentMs: 150
    })
    expect(transport.isClosed()).toBe(true)
  })

  it('收到任何消息后重置无消息计时器', async () => {
    let now = 0
    const transport = createFakeTransport()
    const hangInfo: WorkerHangInfo[] = []
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport,
      requestTimeoutMs: 1000,
      inactivityTimeoutMs: 100,
      now: () => now,
      onHang: (info) => hangInfo.push(info)
    })

    transport.respondTo('worker.startThread', { success: true })
    await client.startThread({ threadId: 'thread-a', cwd: '/tmp' })
    await waitMs(80)
    now = 80
    transport.emitEvent({
      kind: 'event',
      eventType: 'projection',
      event: { type: 'thread.stateChanged', status: 'running' }
    })
    await waitMs(80)
    now = 160

    expect(hangInfo).toHaveLength(0)
    expect(transport.isClosed()).toBe(false)
  })
})

/**
 * 创建 fake transport，可手动触发响应和事件。
 */
function createFakeTransport(): FakeTransport {
  const messageListeners: Array<(envelope: WorkerEnvelope) => void> = []
  const closeListeners: Array<(reason: string) => void> = []
  let closed = false
  let nextResponse: Partial<WorkerResponseEnvelope> | undefined
  let nextResponseCommand: string | undefined

  return {
    send(envelope) {
      if (closed) return
      if (envelope.kind === 'command') {
        const commandType = envelope.command.type
        if (nextResponse && nextResponseCommand === commandType) {
          const response: WorkerResponseEnvelope = {
            kind: 'response',
            id: envelope.id,
            command: commandType,
            success: nextResponse.success ?? true,
            ...nextResponse
          }
          nextResponse = undefined
          nextResponseCommand = undefined
          setTimeout(() => {
            messageListeners.forEach((listener) => listener(response))
          }, 0)
        }
      }
    },
    onMessage(listener) {
      messageListeners.push(listener)
      return () => {
        const index = messageListeners.indexOf(listener)
        if (index >= 0) {
          messageListeners.splice(index, 1)
        }
      }
    },
    onClose(listener) {
      closeListeners.push(listener)
      return () => {
        const index = closeListeners.indexOf(listener)
        if (index >= 0) {
          closeListeners.splice(index, 1)
        }
      }
    },
    close() {
      if (closed) return
      closed = true
      closeListeners.forEach((listener) => listener('transport closed'))
    },
    isClosed() {
      return closed
    },
    respondTo(command: string, response: Partial<WorkerResponseEnvelope>) {
      nextResponse = response
      nextResponseCommand = command
    },
    emitEvent(event: WorkerEnvelope) {
      setTimeout(() => {
        messageListeners.forEach((listener) => listener(event))
      }, 0)
    }
  }
}

type FakeTransport = WorkerTransport & {
  isClosed(): boolean
  respondTo(command: string, response: Partial<WorkerResponseEnvelope>): void
  emitEvent(event: WorkerEnvelope): void
}

async function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
