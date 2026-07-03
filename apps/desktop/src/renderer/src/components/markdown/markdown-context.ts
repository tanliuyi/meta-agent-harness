import type { InjectionKey, Ref } from 'vue'

/**
 * StreamingMarkdown 组件向内部自定义节点组件注入的上下文。
 */
export interface StreamingMarkdownContext {
  /** 所属消息 ID。 */
  messageId: string
  /** 当前消息渲染版本号。 */
  revision: number
  /** 是否仍在流式中。 */
  isStreaming: boolean
  /** 是否处于深色主题。 */
  isDark: boolean
  /** 当前 Shiki 主题名。 */
  theme: string
}

export const MarkdownContextKey: InjectionKey<Ref<StreamingMarkdownContext>> = Symbol('markdown-context')
