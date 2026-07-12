/**
 * 本文件测试 worker service 与抽象 transport 的绑定。
 */

import { describe, expect, it } from 'vitest'
import { MemoryTransport } from '../transport/memory-transport.ts'
import { UnboundDesktopWorkerService } from '../worker/service.ts'
import { bindWorkerServiceTransport } from '../worker/transport-server.ts'
import { TransportWorkerClient } from '../worker/transport-client.ts'

/** bindWorkerServiceTransport 测试套件。 */
describe('bindWorkerServiceTransport', () => {
  /** 验证通过 transport 驱动 worker service 的完整流程。 */
  it('通过 transport 驱动 worker service', async () => {
    const [clientTransport, serverTransport] = MemoryTransport.pair()
    bindWorkerServiceTransport(new UnboundDesktopWorkerService(), serverTransport)
    const client = new TransportWorkerClient({
      workerId: 'worker-1',
      transport: clientTransport,
      createRequestId: () => 'req-1'
    })

    await client.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })
    const response = await client.send({ type: 'worker.ping' })

    expect(response.success).toBe(true)
  })
})
