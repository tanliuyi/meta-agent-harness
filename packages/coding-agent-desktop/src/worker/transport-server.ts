/**
 * 本文件把 worker service 绑定到抽象 transport。
 */

import { createDesktopError } from '../protocol/error.ts'
import { createWorkerErrorResponse, type WorkerCommandEnvelope } from '../protocol/envelope.ts'
import type { WorkerTransport } from '../transport/transport.ts'
import type { DesktopWorkerService } from './service.ts'

/**
 * 将 worker service 绑定到抽象 transport。
 * 设置事件下沉，并监听命令消息进行分发。
 * @param service - desktop worker service 实例。
 * @param transport - worker transport 实例。
 * @returns 取消订阅并清理的函数。
 */
export function bindWorkerServiceTransport(
  service: DesktopWorkerService,
  transport: WorkerTransport
): () => void {
  service.setEventSink?.((event) => transport.send(event))
  return transport.onMessage((envelope) => {
    if (envelope.kind !== 'command') {
      transport.send(
        createWorkerErrorResponse(
          'protocol',
          'protocol',
          createDesktopError(
            'protocol_error',
            'worker service only accepts command envelopes',
            true
          )
        )
      )
      return
    }
    void handleCommand(service, transport, envelope)
  })
}

/**
 * 处理从 transport 收到的命令信封。
 * 调用 service.handle 并将响应写出；若发生异常则写出 runtime_error 响应。
 * @param service - desktop worker service 实例。
 * @param transport - worker transport 实例。
 * @param envelope - 收到的命令信封。
 */
async function handleCommand(
  service: DesktopWorkerService,
  transport: WorkerTransport,
  envelope: WorkerCommandEnvelope
): Promise<void> {
  try {
    transport.send(await service.handle(envelope))
  } catch (error) {
    transport.send(
      createWorkerErrorResponse(
        envelope.id,
        envelope.command.type,
        createDesktopError(
          'runtime_error',
          error instanceof Error ? error.message : String(error),
          false
        )
      )
    )
  }
}
