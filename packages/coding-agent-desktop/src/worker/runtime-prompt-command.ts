/**
 * 本文件处理 Pi 同构 prompt command 的 preflight 响应时机。
 */

import { createDesktopError } from '../protocol/error.ts'
import {
  createWorkerErrorResponse,
  createWorkerResponse,
  type WorkerCommandEnvelope,
  type WorkerResponseEnvelope
} from '../protocol/envelope.ts'
import type { CanonicalAgentCommand } from '../protocol/commands/canonical.ts'
import type { RuntimeCommandHandlerHost } from './runtime-command-host.ts'

export async function startPromptAndWaitForPreflight(
  host: RuntimeCommandHandlerHost,
  envelope: WorkerCommandEnvelope,
  command: Extract<CanonicalAgentCommand, { type: 'prompt' }>
): Promise<WorkerResponseEnvelope> {
  const session = host.runtime.session
  return await new Promise<WorkerResponseEnvelope>((resolve) => {
    let settled = false
    const settle = (response: WorkerResponseEnvelope): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(response)
    }

    void session
      .prompt(command.message, {
        images: command.images,
        streamingBehavior: command.streamingBehavior,
        source: 'rpc',
        preflightResult: (didSucceed) => {
          if (didSucceed) {
            settle(createWorkerResponse(envelope.id, command.type, undefined))
          }
        }
      })
      .catch((error) => {
        settle(
          createWorkerErrorResponse(
            envelope.id,
            command.type,
            createDesktopError(
              'runtime_error',
              error instanceof Error ? error.message : String(error),
              false
            )
          )
        )
      })
  })
}
