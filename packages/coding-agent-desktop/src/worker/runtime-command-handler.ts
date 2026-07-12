/**
 * 分发 desktop worker command 到 Pi 同构 runtime/session handler。
 */

import { createDesktopError } from '../protocol/error.ts'
import {
  createWorkerErrorResponse,
  createWorkerResponse,
  type WorkerCommandEnvelope,
  type WorkerResponseEnvelope
} from '../protocol/envelope.ts'
import type { CanonicalAgentCommand } from '../protocol/commands/canonical.ts'
import { isRenderableConversationMessage } from '../protocol/message.ts'
import type { ThreadMessagesResponse } from '../protocol/thread.ts'
import { getRuntimeCommands } from './runtime-command-list.ts'
import { type RuntimeCommandHandlerHost } from './runtime-command-host.ts'
import { handleRuntimeControlCommand } from './runtime-control-command.ts'
import { startPromptAndWaitForPreflight } from './runtime-prompt-command.ts'
import { handleRuntimeSessionCommand } from './runtime-session-command.ts'
import { buildRuntimeState } from './runtime-state.ts'

export type { RuntimeCommandHandlerHost } from './runtime-command-host.ts'

/**
 * 处理 runtime 命令。
 * @param host - runtime 命令 host。
 * @param envelope - 命令 envelope。
 * @returns worker 响应 envelope，或 undefined 表示非 runtime 命令。
 */
export async function handleRuntimeCommand(
  host: RuntimeCommandHandlerHost,
  envelope: WorkerCommandEnvelope
): Promise<WorkerResponseEnvelope | undefined> {
  const command = envelope.command
  if (
    command.type.startsWith('worker.') ||
    command.type === 'ui.respond' ||
    command.type === 'approval.respond'
  ) {
    return undefined
  }
  return await handleCanonicalCommand(host, envelope, command as CanonicalAgentCommand)
}

async function handleCanonicalCommand(
  host: RuntimeCommandHandlerHost,
  envelope: WorkerCommandEnvelope,
  command: CanonicalAgentCommand
): Promise<WorkerResponseEnvelope> {
  const session = host.runtime.session
  if (command.type === 'prompt') {
    return await startPromptAndWaitForPreflight(host, envelope, command)
  }
  if (command.type === 'get_state') {
    return createWorkerResponse(
      envelope.id,
      command.type,
      buildRuntimeState(session, host.getPendingApprovals?.(), host.getPendingExtensionDialogs?.())
    )
  }
  if (command.type === 'get_session_stats') {
    return createWorkerResponse(envelope.id, command.type, session.getSessionStats())
  }
  if (command.type === 'export_html') {
    return createWorkerResponse(envelope.id, command.type, {
      path: await session.exportToHtml(command.outputPath)
    })
  }
  if (command.type === 'get_messages') {
    return createWorkerResponse<ThreadMessagesResponse>(envelope.id, command.type, {
      messages: session.messages,
      messageEntryIds: session.sessionManager
        .getBranch()
        .flatMap((entry) =>
          entry.type === 'message' && isRenderableConversationMessage(entry.message)
            ? [entry.id]
            : []
        )
    })
  }
  if (command.type === 'get_commands') {
    return createWorkerResponse(envelope.id, command.type, {
      commands: getRuntimeCommands(session)
    })
  }
  const response =
    (await handleRuntimeControlCommand(host, envelope, command)) ??
    (await handleRuntimeSessionCommand(host, envelope, command)) ??
    (await handlePromptControlCommand(host, envelope, command))
  if (response) {
    return response
  }
  return createWorkerErrorResponse(
    envelope.id,
    command.type,
    createDesktopError('invalid_command', `Unknown command: ${command.type}`, true)
  )
}

async function handlePromptControlCommand(
  host: RuntimeCommandHandlerHost,
  envelope: WorkerCommandEnvelope,
  command: CanonicalAgentCommand
): Promise<WorkerResponseEnvelope | undefined> {
  const session = host.runtime.session
  switch (command.type) {
    case 'steer':
      await session.steer(command.message, command.images)
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'follow_up':
      await session.followUp(command.message, command.images)
      return createWorkerResponse(envelope.id, command.type, undefined)
    case 'abort':
      // fix: Desktop 的 Escape/取消按钮应和 Pi 一样能中止正在进行的手动/自动压缩。
      session.abortCompaction()
      await session.abort()
      return createWorkerResponse(envelope.id, command.type, undefined)
    default:
      return undefined
  }
}
