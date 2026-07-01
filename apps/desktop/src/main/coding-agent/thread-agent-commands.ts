/**
 * 本文件实现 prompt、steer、followUp 和 abort 操作。
 */

import type { PromptInput, TextInput } from '../../shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'

export async function prompt(core: ThreadManagerCore, input: PromptInput): Promise<void> {
  core.updateThread(input.threadId, { status: 'running' })
  await core.sendOk(input.threadId, {
    type: 'prompt',
    message: input.message,
    images: input.images as never,
    streamingBehavior: input.streamingBehavior
  })
}

export async function steer(core: ThreadManagerCore, input: TextInput): Promise<void> {
  await core.sendOk(input.threadId, {
    type: 'steer',
    message: input.message,
    images: input.images as never
  })
}

export async function followUp(core: ThreadManagerCore, input: TextInput): Promise<void> {
  await core.sendOk(input.threadId, {
    type: 'follow_up',
    message: input.message,
    images: input.images as never
  })
}

export async function abort(core: ThreadManagerCore, threadId: string): Promise<void> {
  await core.sendOk(threadId, { type: 'abort' })
  core.updateThread(threadId, { status: 'idle' })
}

export async function runCommand(
  core: ThreadManagerCore,
  input: { threadId: string; command: string }
): Promise<void> {
  await prompt(core, { threadId: input.threadId, message: `/${input.command}` })
}
