/**
 * desktop coding agent worker 的普通 Node sidecar 入口。
 */

import type { WorkerCommandEnvelope } from '@coding-agent-desktop-src/protocol/envelope'
import { createDesktopError } from '@coding-agent-desktop-src/protocol/error'
import { createWorkerErrorResponse } from '@coding-agent-desktop-src/protocol/envelope'
import { installCodingAgentPackageDirEnv } from './coding-agent-package-dir'
import { shouldRunCliCompatibilityMode } from './node-sidecar-worker-mode'
import { createBuiltinRuntimeForThread } from './builtin-runtime'

installCodingAgentPackageDirEnv()

const startupArgs = process.argv.slice(2)
if (shouldRunCliCompatibilityMode(startupArgs)) {
  runCliCompatibilityMode(startupArgs)
} else {
  void runIpcWorkerMode().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

function runCliCompatibilityMode(args: string[]): void {
  process.env.PI_CODING_AGENT = 'true'
  void import('@coding-agent-desktop-src/worker/print-runner').then(
    ({ runDesktopPrintMode }) => {
      void runDesktopPrintMode(args).then(
        (exitCode) => {
          if (shouldDrainSuccessfulWindowsUpdate(args, exitCode)) {
            return
          }
          process.exit(exitCode)
        },
        (error) => {
          console.error(error instanceof Error ? error.message : String(error))
          process.exit(1)
        }
      )
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  )
}

function shouldDrainSuccessfulWindowsUpdate(args: readonly string[], exitCode: number): boolean {
  return process.platform === 'win32' && exitCode === 0 && args[0] === 'update'
}

async function runIpcWorkerMode(): Promise<void> {
  const { RuntimeDesktopWorkerService } =
    await import('@coding-agent-desktop-src/worker/runtime-service')
  const service = new RuntimeDesktopWorkerService(createBuiltinRuntimeForThread)

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
}
