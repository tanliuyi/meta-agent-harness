/**
 * 本文件实现压缩、重试、命令列表和 bridge response 操作。
 */

import type {
  CommandInfo,
  CompactInput,
  CompactionResult,
  ToggleInput
} from '../../shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'

export async function compact(
  core: ThreadManagerCore,
  input: CompactInput
): Promise<CompactionResult> {
  return await core.sendData<CompactionResult>(input.threadId, {
    type: 'compact',
    customInstructions: input.customInstructions
  })
}

export async function setAutoCompaction(
  core: ThreadManagerCore,
  input: ToggleInput
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'set_auto_compaction', enabled: input.enabled })
}

export async function setAutoRetry(core: ThreadManagerCore, input: ToggleInput): Promise<void> {
  await core.sendOk(input.threadId, { type: 'set_auto_retry', enabled: input.enabled })
}

export async function abortRetry(core: ThreadManagerCore, threadId: string): Promise<void> {
  await core.sendOk(threadId, { type: 'abort_retry' })
}

export async function getCommands(
  core: ThreadManagerCore,
  threadId: string
): Promise<CommandInfo[]> {
  const result = await core.sendData<{ commands: CommandInfo[] }>(threadId, {
    type: 'get_commands'
  })
  return result.commands
}

export async function respondUi(
  core: ThreadManagerCore,
  input: { threadId: string; response: unknown }
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'ui.respond', response: input.response as never })
}

export async function respondApproval(
  core: ThreadManagerCore,
  input: { threadId: string; response: unknown }
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'approval.respond', response: input.response as never })
}
