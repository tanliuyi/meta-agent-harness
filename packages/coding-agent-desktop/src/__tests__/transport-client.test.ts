/**
 * 本文件测试 transport worker client 的 request/response 行为。
 */

import { describe, expect, it, vi } from 'vitest'
import { createWorkerResponse, type WorkerCommandEnvelope } from '../protocol/envelope.ts'
import { MemoryTransport } from '../transport/memory-transport.ts'
import { TransportWorkerClient } from '../worker/transport-client.ts'

/** TransportWorkerClient 测试套件。 */
describe('TransportWorkerClient', () => {
  /** 验证按 request id 关联响应。 */
  it('按 request id 关联响应', async () => {
    const [clientTransport, workerTransport] = MemoryTransport.pair()
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport: clientTransport,
      createRequestId: () => 'req-1'
    })
    workerTransport.onMessage((envelope) => {
      const command = envelope as WorkerCommandEnvelope
      workerTransport.send(createWorkerResponse(command.id, command.command.type, { ok: true }))
    })

    const response = await client.send({ type: 'worker.ping' })

    expect(response.success).toBe(true)
    expect(response.data).toEqual({ ok: true })
  })

  /** 验证 startThread 成功后记录 threadId。 */
  it('startThread 成功后记录 threadId', async () => {
    const [clientTransport, workerTransport] = MemoryTransport.pair()
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport: clientTransport,
      createRequestId: () => 'req-1'
    })
    workerTransport.onMessage((envelope) => {
      const command = envelope as WorkerCommandEnvelope
      workerTransport.send(createWorkerResponse(command.id, command.command.type, { ok: true }))
    })

    await client.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    expect(client.snapshot().threadId).toBe('thread-1')
  })

  /** 验证请求超时会 reject。 */
  it('请求超时会 reject', async () => {
    vi.useFakeTimers()
    const [clientTransport] = MemoryTransport.pair()
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport: clientTransport,
      requestTimeoutMs: 10,
      createRequestId: () => 'req-1'
    })

    const request = client.send({ type: 'worker.ping' })
    vi.advanceTimersByTime(10)

    await expect(request).rejects.toThrow('request timed out')
    vi.useRealTimers()
  })

  /** 验证 transport close 会 reject pending request。 */
  it('transport close 会 reject pending request', async () => {
    const [clientTransport] = MemoryTransport.pair()
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport: clientTransport,
      createRequestId: () => 'req-1'
    })

    const request = client.send({ type: 'worker.ping' })
    clientTransport.close()

    await expect(request).rejects.toThrow('transport closed')
  })
})
