import type { ThreadMessage } from '@shared/coding-agent/types'

/**
 * 渲染侧消息对象，在 ThreadMessage 基础上增加渲染版本号与流式状态。
 */
export interface RenderableThreadMessage extends ThreadMessage {
  /** 渲染版本号，流式更新时递增。 */
  revision: number
  /** 当前渲染状态。 */
  renderState: 'streaming' | 'complete'
}

/**
 * 将 ThreadMessage 与渲染状态合并为 RenderableThreadMessage。
 * @param message - 原始消息。
 * @param state - 渲染状态。
 * @returns 可渲染消息。
 */
export function toRenderableMessage(
  message: ThreadMessage,
  state: { revision: number; renderState: 'streaming' | 'complete' }
): RenderableThreadMessage {
  return {
    ...message,
    revision: state.revision,
    renderState: state.renderState
  }
}
