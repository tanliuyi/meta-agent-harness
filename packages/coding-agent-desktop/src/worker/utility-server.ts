/**
 * 本文件提供 Electron utilityProcess 使用的 worker 服务入口工具。
 */

import type { WorkerCommandEnvelope } from '../protocol/envelope.ts'
import { createDesktopError } from '../protocol/error.ts'
import { createWorkerErrorResponse } from '../protocol/envelope.ts'
import type { DesktopWorkerService } from './service.ts'

interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  off(event: 'message', listener: (event: { data: unknown }) => void): void
}

/**
 * 启动基于 Electron parentPort 的 worker 服务。
 * @param service - desktop worker service 实例。
 * @returns 停止服务并清理的函数。
 */
export function runUtilityWorkerServer(service: DesktopWorkerService): () => void {
  const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
  if (!parentPort) {
    throw new Error('coding agent utility worker requires process.parentPort')
  }
  service.setEventSink?.((event) => parentPort.postMessage(event))
  const onMessage = (event: { data: unknown }): void => {
    void handleMessage(parentPort, service, event.data)
  }
  parentPort.on('message', onMessage)
  return () => {
    parentPort.off('message', onMessage)
  }
}

/**
 * 处理来自 main 进程的结构化消息。
 * @param parentPort - Electron utility process parent port。
 * @param service - desktop worker service 实例。
 * @param message - 收到的消息。
 */
async function handleMessage(
  parentPort: ParentPort,
  service: DesktopWorkerService,
  message: unknown
): Promise<void> {
  const envelope = message as Partial<WorkerCommandEnvelope>
  if (envelope.kind !== 'command' || typeof envelope.id !== 'string' || !envelope.command) {
    parentPort.postMessage(
      createWorkerErrorResponse(
        'protocol',
        'protocol',
        createDesktopError('protocol_error', 'invalid worker command envelope', true)
      )
    )
    return
  }
  try {
    const response = await service.handle(envelope as WorkerCommandEnvelope)
    parentPort.postMessage(response)
  } catch (error) {
    parentPort.postMessage(
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
