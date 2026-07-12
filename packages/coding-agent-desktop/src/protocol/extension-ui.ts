/**
 * 定义 extension UI request 在 desktop transport 中的结构。
 */

import type { WorkingIndicatorOptions } from '@earendil-works/pi-coding-agent'

/** Extension UI 请求联合类型。 */
export type ExtensionUiRequest =
  | {
      /** 请求类型：单选。 */
      type: 'select'
      /** 请求 ID。 */
      id: string
      /** 标题。 */
      title: string
      /** 选项列表。 */
      options: string[]
      /** 超时时间，单位毫秒。 */
      timeoutMs?: number
    }
  | {
      /** 请求类型：确认。 */
      type: 'confirm'
      /** 请求 ID。 */
      id: string
      /** 标题。 */
      title: string
      /** 消息内容。 */
      message: string
      /** 超时时间，单位毫秒。 */
      timeoutMs?: number
    }
  | {
      /** 请求类型：输入。 */
      type: 'input'
      /** 请求 ID。 */
      id: string
      /** 标题。 */
      title: string
      /** 占位提示文本。 */
      placeholder?: string
      /** 超时时间，单位毫秒。 */
      timeoutMs?: number
    }
  | {
      /** 请求类型：编辑器。 */
      type: 'editor'
      /** 请求 ID。 */
      id: string
      /** 标题。 */
      title: string
      /** 预填充文本。 */
      prefill?: string
    }
  | {
      /** 请求类型：通知。 */
      type: 'notify'
      /** 请求 ID。 */
      id: string
      /** 通知消息。 */
      message: string
      /** 通知类型。 */
      notifyType?: 'info' | 'warning' | 'error'
    }
  | {
      /** 请求类型：设置状态。 */
      type: 'setStatus'
      /** 请求 ID。 */
      id: string
      /** 状态键。 */
      statusKey: string
      /** 状态文本。 */
      statusText?: string
    }
  | {
      /** 请求类型：设置标题。 */
      type: 'setTitle'
      /** 请求 ID。 */
      id: string
      /** 标题。 */
      title: string
    }
  | {
      /** 请求类型：设置编辑器文本。 */
      type: 'setEditorText'
      /** 请求 ID。 */
      id: string
      /** 文本内容。 */
      text: string
    }
  | {
      /** 请求类型：读取编辑器文本。 */
      type: 'getEditorText'
      /** 请求 ID。 */
      id: string
    }
  | {
      /** 请求类型：设置工作消息。 */
      type: 'setWorkingMessage'
      /** 请求 ID。 */
      id: string
      /** 工作消息；未传表示恢复默认。 */
      message?: string
    }
  | {
      /** 请求类型：设置工作行可见性。 */
      type: 'setWorkingVisible'
      /** 请求 ID。 */
      id: string
      /** 是否可见。 */
      visible: boolean
    }
  | {
      /** 请求类型：设置工作指示器。 */
      type: 'setWorkingIndicator'
      /** 请求 ID。 */
      id: string
      /** 指示器选项；未传表示恢复默认。 */
      options?: WorkingIndicatorOptions
    }
  | {
      /** 请求类型：设置隐藏 thinking 标签。 */
      type: 'setHiddenThinkingLabel'
      /** 请求 ID。 */
      id: string
      /** 标签；未传表示恢复默认。 */
      label?: string
    }
  | {
      /** 请求类型：读取工具展开状态。 */
      type: 'getToolsExpanded'
      /** 请求 ID。 */
      id: string
    }
  | {
      /** 请求类型：设置工具展开状态。 */
      type: 'setToolsExpanded'
      /** 请求 ID。 */
      id: string
      /** 是否展开。 */
      expanded: boolean
    }

/** 需要 renderer 展示并等待用户响应的交互请求。 */
export type ExtensionDialogRequest = Extract<
  ExtensionUiRequest,
  { type: 'select' | 'confirm' | 'input' | 'editor' }
>

/** 从 desktop worker 的同步缓存读取宿主状态的查询。 */
export type ExtensionHostStateQuery = Extract<
  ExtensionUiRequest,
  { type: 'getEditorText' | 'getToolsExpanded' }
>

/** 无需用户响应、由 renderer 直接应用的 UI effect。 */
export type ExtensionUiEffect = Exclude<
  ExtensionUiRequest,
  ExtensionDialogRequest | ExtensionHostStateQuery
>

/** Extension UI 响应联合类型。 */
export type ExtensionUiResponse =
  | {
      /** 请求 ID。 */
      id: string
      /** 输入或选择值。 */
      value: string
    }
  | {
      /** 请求 ID。 */
      id: string
      /** 是否确认。 */
      confirmed: boolean
    }
  | {
      /** 请求 ID。 */
      id: string
      /** 是否取消。 */
      cancelled: true
    }
  | {
      /** 请求 ID。 */
      id: string
      /** 布尔返回值。 */
      value: boolean
    }
