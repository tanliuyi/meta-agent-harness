/**
 * desktop coding agent worker 的普通 Node sidecar 入口。
 */

import type { WorkerCommandEnvelope } from '../../../../../packages/coding-agent/src/desktop/protocol/envelope'
import { createDesktopError } from '../../../../../packages/coding-agent/src/desktop/protocol/error'
import { createWorkerErrorResponse } from '../../../../../packages/coding-agent/src/desktop/protocol/envelope'
import { RuntimeDesktopWorkerService } from '../../../../../packages/coding-agent/src/desktop/worker/runtime-service'

const service = new RuntimeDesktopWorkerService()

service.setEventSink?.((event) => {
  process.send?.(event)
})

process.on('message', (message) => {
  void handleMessage(message)
})

process.once('disconnect', () => {
  void service.stop('disconnect').finally(() => {
    process.exit(0)
  })
})

async function handleMessage(message: unknown): Promise<void> {
  const envelope = message as Partial<WorkerCommandEnvelope>
  if (envelope.kind !== 'command' || typeof envelope.id !== 'string' || !envelope.command) {
    process.send?.(
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
    process.send?.(response)
  } catch (error) {
    process.send?.(
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
