/**
 * 处理模型、thinking、压缩、重试和 bash 等 runtime control command。
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
import { buildThinkingLevelCycleResult } from './runtime-state.ts'

/**
 * 处理 runtime control 命令。
 * @param host - runtime 命令 host。
 * @param envelope - 命令 envelope。
 * @param command - canonical agent 命令。
 * @returns worker 响应 envelope，或 undefined 表示不处理该命令。
 */
export async function handleRuntimeControlCommand(
  host: RuntimeCommandHandlerHost,
  envelope: WorkerCommandEnvelope,
  command: CanonicalAgentCommand
): Promise<WorkerResponseEnvelope | undefined> {
  const session = host.runtime.session
  switch (command.type) {
    case 'refresh_model_registry':
      session.modelRegistry.authStorage.reload()
      session.modelRegistry.refresh()
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'set_model': {
      session.modelRegistry.authStorage.reload()
      session.modelRegistry.refresh()
      const models = await session.modelRegistry.getAvailable()
      const model = models.find(
        (item) => item.provider === command.provider && item.id === command.modelId
      )
      if (!model) {
        return createWorkerErrorResponse(
          envelope.id,
          command.type,
          createDesktopError(
            'runtime_error',
            `Model not found: ${command.provider}/${command.modelId}`,
            true
          )
        )
      }
      await session.setModel(model)
      return createWorkerResponse(envelope.id, command.type, model)
    }
    case 'cycle_model':
      return createWorkerResponse(envelope.id, command.type, await session.cycleModel())
    case 'get_available_models':
      session.modelRegistry.authStorage.reload()
      session.modelRegistry.refresh()
      return createWorkerResponse(envelope.id, command.type, {
        models: await session.modelRegistry.getAvailable()
      })
    case 'set_thinking_level':
      session.setThinkingLevel(command.level)
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'cycle_thinking_level':
      return createWorkerResponse(
        envelope.id,
        command.type,
        buildThinkingLevelCycleResult(session.cycleThinkingLevel())
      )
    case 'set_steering_mode':
      session.setSteeringMode(command.mode)
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'set_follow_up_mode':
      session.setFollowUpMode(command.mode)
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'compact': {
      const result = await session.compact(command.customInstructions)
      // fix: Desktop 手动压缩期间允许 steer/follow-up 入队；压缩结束后必须按 Pi 语义继续交付队列。
      if (session.agent.hasQueuedMessages()) {
        await session.agent.continue()
      }
      return createWorkerResponse(envelope.id, command.type, result)
    }
    case 'set_auto_compaction':
      session.setAutoCompactionEnabled(command.enabled)
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'set_auto_retry':
      session.setAutoRetryEnabled(command.enabled)
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'abort_retry':
      session.abortRetry()
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'reload':
      await session.reload()
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'bash':
      return createWorkerResponse(
        envelope.id,
        command.type,
        await session.executeBash(command.command, undefined, {
          excludeFromContext: command.excludeFromContext
        })
      )
    case 'abort_bash':
      session.abortBash()
      return createWorkerResponse(envelope.id, command.type, undefined)
    default:
      return undefined
  }
}
