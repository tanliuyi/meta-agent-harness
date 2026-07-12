/**
 * 定义 desktop worker control command。
 */

import type { ApprovalResponse } from '../approval.ts'
import type {
  DesktopExtensionPanelLifecycle,
  DesktopExtensionPanelRestore
} from '../extension-panel.ts'
import type { ExtensionUiResponse } from '../extension-ui.ts'
import type { StartThreadInput } from '../thread.ts'
import type { KeyId } from '@earendil-works/pi-coding-agent'

/** Desktop worker 控制命令联合类型。 */
export type DesktopControlCommand =
  | {
      /** 命令类型：启动线程。 */
      type: 'worker.startThread'
      /** 启动线程的输入参数。 */
      input: StartThreadInput
    }
  | {
      /** 命令类型：心跳检测。 */
      type: 'worker.ping'
    }
  | {
      /** 命令类型：响应扩展 UI 请求。 */
      type: 'ui.respond'
      /** 扩展 UI 响应。 */
      response: ExtensionUiResponse
    }
  | {
      /** 命令类型：响应审批请求。 */
      type: 'approval.respond'
      /** 审批响应。 */
      response: ApprovalResponse
    }
  | {
      /** 命令类型：同步 renderer 编辑器文本到扩展 UI 缓存。 */
      type: 'ui.editorTextChanged'
      /** 当前编辑器文本。 */
      text: string
    }
  | {
      /** 命令类型：同步 renderer 工具展开状态到扩展 UI 缓存。 */
      type: 'ui.toolsExpandedChanged'
      /** 是否展开。 */
      expanded: boolean
    }
  | {
      /** 命令类型：向扩展派发 desktop panel 消息。 */
      type: 'desktop.panelMessage'
      /** Panel ID。 */
      panelId: string
      /** 消息内容。 */
      message: unknown
    }
  | {
      /** 命令类型：向扩展派发 desktop panel 生命周期事件。 */
      type: 'desktop.panelLifecycle'
      /** 生命周期事件。 */
      event: DesktopExtensionPanelLifecycle
    }
  | {
      /** 命令类型：请求扩展恢复 desktop panel。 */
      type: 'desktop.panelRestore'
      /** Restore 请求。 */
      restore: DesktopExtensionPanelRestore
    }
  | {
      /** 命令类型：触发扩展快捷键。 */
      type: 'shortcut.dispatch'
      /** 快捷键 ID。 */
      shortcut: KeyId
    }

/**
 * 判断给定命令是否为 desktop control command。
 * @param command - 要判断的命令。
 * @returns 是否为 desktop control command。
 */
export function isDesktopControlCommand(command: {
  type: string
}): command is DesktopControlCommand {
  return controlCommandTypes.has(command.type)
}

/** 预定义的 control 命令类型集合。 */
const controlCommandTypes = new Set<string>([
  'worker.startThread',
  'worker.ping',
  'ui.respond',
  'approval.respond',
  'ui.editorTextChanged',
  'ui.toolsExpandedChanged',
  'desktop.panelMessage',
  'desktop.panelLifecycle',
  'desktop.panelRestore',
  'shortcut.dispatch'
])
