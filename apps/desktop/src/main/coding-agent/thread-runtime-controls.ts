/**
 * 本文件实现压缩、重试、命令列表和 bridge response 操作。
 */

import type {
  CommandInfo,
  CompactInput,
  CompactionResult,
  ToggleInput
} from '@shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'

/**
 * 压缩线程上下文。
 * @param core - thread 管理核心。
 * @param input - 压缩输入。
 * @returns 压缩结果。
 */
export async function compact(
  core: ThreadManagerCore,
  input: CompactInput
): Promise<CompactionResult> {
  return await core.sendData<CompactionResult>(input.threadId, {
    type: 'compact',
    customInstructions: input.customInstructions
  })
}

/**
 * 设置自动压缩开关。
 * @param core - thread 管理核心。
 * @param input - 开关输入。
 */
export async function setAutoCompaction(
  core: ThreadManagerCore,
  input: ToggleInput
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'set_auto_compaction', enabled: input.enabled })
}

/**
 * 设置自动重试开关。
 * @param core - thread 管理核心。
 * @param input - 开关输入。
 */
export async function setAutoRetry(core: ThreadManagerCore, input: ToggleInput): Promise<void> {
  await core.sendOk(input.threadId, { type: 'set_auto_retry', enabled: input.enabled })
}

/**
 * 中止当前重试。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 */
export async function abortRetry(core: ThreadManagerCore, threadId: string): Promise<void> {
  await core.sendOk(threadId, { type: 'abort_retry' })
}

/**
 * 获取线程可用命令列表。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 * @returns 命令信息列表。
 */
export async function getCommands(
  core: ThreadManagerCore,
  threadId: string
): Promise<CommandInfo[]> {
  const result = await core.sendData<{ commands: CommandInfo[] }>(threadId, {
    type: 'get_commands'
  })
  return result.commands
}

/**
 * 响应 UI 交互。
 * @param core - thread 管理核心。
 * @param input - 包含 threadId 与 response 的输入。
 */
export async function respondUi(
  core: ThreadManagerCore,
  input: { threadId: string; response: unknown }
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'ui.respond', response: input.response as never })
}

/**
 * 响应审批交互。
 * @param core - thread 管理核心。
 * @param input - 包含 threadId 与 response 的输入。
 */
export async function respondApproval(
  core: ThreadManagerCore,
  input: { threadId: string; response: unknown }
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'approval.respond', response: input.response as never })
}
