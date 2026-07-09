/**
 * 本文件实现压缩、重试、命令列表和 bridge response 操作。
 */

import type {
  CommandInfo,
  CompactInput,
  CompactionResult,
  ExtensionEditorTextInput,
  ExtensionPanelLifecycleInput,
  ExtensionPanelMessageInput,
  ExtensionShortcutInput,
  ExtensionShortcutResult,
  ExtensionUiResponseInput,
  ApprovalResponseInput,
  ToggleInput
} from '@shared/coding-agent/types'
import { getBuiltinCommandInfos } from '@shared/coding-agent/builtin-commands'
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
  return [...getBuiltinCommandInfos(), ...result.commands]
}

/**
 * 同步 renderer 编辑器文本给 worker 内的扩展 UI 上下文缓存。
 * @param core - thread 管理核心。
 * @param input - 编辑器文本输入。
 */
export async function syncExtensionEditorText(
  core: ThreadManagerCore,
  input: ExtensionEditorTextInput
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'ui.editorTextChanged', text: input.text })
}

/**
 * 触发 Pi extension 注册的快捷键。
 * @param core - thread 管理核心。
 * @param input - 快捷键输入。
 */
export async function dispatchExtensionShortcut(
  core: ThreadManagerCore,
  input: ExtensionShortcutInput
): Promise<boolean> {
  const result = await core.sendData<ExtensionShortcutResult>(input.threadId, {
    type: 'shortcut.dispatch',
    shortcut: input.shortcut
  })
  return result.handled
}

/**
 * 响应 UI 交互。
 * @param core - thread 管理核心。
 * @param input - 包含 threadId 与 response 的输入。
 */
export async function respondUi(
  core: ThreadManagerCore,
  input: ExtensionUiResponseInput
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'ui.respond', response: input.response })
}

/**
 * 向扩展派发 desktop panel 消息。
 * @param core - thread 管理核心。
 * @param input - panel 消息输入。
 */
export async function sendExtensionPanelMessage(
  core: ThreadManagerCore,
  input: ExtensionPanelMessageInput
): Promise<void> {
  await sendOptionalExtensionPanelCommand(() =>
    core.sendOk(input.threadId, {
      type: 'desktop.panelMessage',
      panelId: input.panelId,
      message: input.message
    })
  )
}

/**
 * 向扩展派发 desktop panel 生命周期事件。
 * @param core - thread 管理核心。
 * @param input - panel 生命周期输入。
 */
export async function sendExtensionPanelLifecycleEvent(
  core: ThreadManagerCore,
  input: ExtensionPanelLifecycleInput
): Promise<void> {
  await sendOptionalExtensionPanelCommand(() =>
    core.sendOk(input.threadId, {
      type: 'desktop.panelLifecycle',
      event: input.event
    })
  )
}

async function sendOptionalExtensionPanelCommand(send: () => Promise<void>): Promise<void> {
  try {
    await send()
  } catch (error) {
    if (error instanceof Error && error.message === 'worker has no bound thread') {
      return
    }
    throw error
  }
}

/**
 * 响应审批交互。
 * @param core - thread 管理核心。
 * @param input - 包含 threadId 与 response 的输入。
 */
export async function respondApproval(
  core: ThreadManagerCore,
  input: ApprovalResponseInput
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'approval.respond', response: input.response })
}
