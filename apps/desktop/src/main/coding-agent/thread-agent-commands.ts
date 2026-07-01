/**
 * 本文件实现 prompt、steer、followUp 和 abort 操作。
 */

import type { PromptInput, TextInput } from '../../shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'

/**
 * 向线程发送 prompt 消息。
 * @param core - thread 管理核心。
 * @param input - prompt 输入。
 */
export async function prompt(core: ThreadManagerCore, input: PromptInput): Promise<void> {
  core.updateThread(input.threadId, { status: 'running' })
  await core.sendOk(input.threadId, {
    type: 'prompt',
    message: input.message,
    images: input.images as never,
    streamingBehavior: input.streamingBehavior
  })
}

/**
 * 向线程发送 steer 指令。
 * @param core - thread 管理核心。
 * @param input - 文本输入。
 */
export async function steer(core: ThreadManagerCore, input: TextInput): Promise<void> {
  await core.sendOk(input.threadId, {
    type: 'steer',
    message: input.message,
    images: input.images as never
  })
}

/**
 * 向线程发送 follow up 消息。
 * @param core - thread 管理核心。
 * @param input - 文本输入。
 */
export async function followUp(core: ThreadManagerCore, input: TextInput): Promise<void> {
  await core.sendOk(input.threadId, {
    type: 'follow_up',
    message: input.message,
    images: input.images as never
  })
}

/**
 * 中止线程当前任务。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 */
export async function abort(core: ThreadManagerCore, threadId: string): Promise<void> {
  await core.sendOk(threadId, { type: 'abort' })
  core.updateThread(threadId, { status: 'idle' })
}

/**
 * 通过命令形式触发 prompt。
 * @param core - thread 管理核心。
 * @param input - 包含 threadId 与 command 的输入。
 */
export async function runCommand(
  core: ThreadManagerCore,
  input: { threadId: string; command: string }
): Promise<void> {
  await prompt(core, { threadId: input.threadId, message: `/${input.command}` })
}
