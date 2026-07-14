import type { PluggableList } from '@crazydos/vue-markdown'
import type { AnyClientTool } from '@tanstack/ai'
import type { ConnectionAdapter, UIMessage } from '@tanstack/ai-vue'
import type { DeepReadonly, VNodeChild } from 'vue'

export type ChatUIMessage = DeepReadonly<UIMessage<ReadonlyArray<AnyClientTool>>>
export type ChatMessagePart = ChatUIMessage['parts'][number]
export type ChatSlotContent = VNodeChild

export interface ChatProps {
  /** CSS class name for the root element */
  class?: string
  /** Connection adapter for communicating with your API */
  connection: ConnectionAdapter
  /** Initial messages to display */
  initialMessages?: Array<UIMessage>
  /** Stable client instance ID */
  id?: string
  /** AG-UI conversation thread ID */
  threadId?: string
  /** Keep a persistent subscription open for server-pushed events */
  live?: boolean
  /** Additional body data to send with requests */
  body?: Record<string, unknown>
  /** Client-side tools with execute functions */
  tools?: ReadonlyArray<AnyClientTool>
}

export interface ChatInputProps {
  /** CSS class name */
  class?: string
  /** Placeholder text */
  placeholder?: string
  /** Disable input */
  disabled?: boolean
  /** Submit on Enter (Shift+Enter for new line) */
  submitOnEnter?: boolean
}

export interface ChatInputRenderProps {
  /** Current input value (use v-model on ChatInput to control) */
  value: string
  /** Submit the message */
  onSubmit: () => void
  /** Is the chat currently loading */
  isLoading: boolean
  /** Is input disabled */
  disabled: boolean
}

export interface ThinkingPartProps {
  /** The thinking content to render */
  content: string
  /** Base class applied to thinking parts */
  class?: string
  /** Whether thinking is complete (has text content after) */
  isComplete?: boolean
}

export interface ToolCallRenderProps {
  id: string
  name: string
  arguments: string
  state: string
  approval?: {
    id: string
    needsApproval: boolean
    approved?: boolean
  }
  output?: unknown
}

export interface ChatMessageProps {
  /** The message to render (accepts readonly from useChat) */
  message: ChatUIMessage
  /** Base CSS class name */
  class?: string
  /** Additional class for user messages */
  userClass?: string
  /** Additional class for assistant messages */
  assistantClass?: string
}

export interface ChatMessagesProps {
  /** CSS class name */
  class?: string
  /** Auto-scroll to bottom on new messages */
  autoScroll?: boolean
}

export interface TextPartProps {
  /** The text content to render */
  content: string
  /** The role of the message (user, assistant, or system) - optional for standalone use */
  role?: 'user' | 'assistant' | 'system'
  /** Base class applied to all text parts */
  class?: string
  /** Additional class for user messages */
  userClass?: string
  /** Additional class for assistant messages (also used for system messages) */
  assistantClass?: string
  /** Additional remark plugins, appended after the defaults. */
  remarkPlugins?: PluggableList
  /** Additional rehype plugins, appended after the defaults. */
  rehypePlugins?: PluggableList
  /**
   * Drop the built-in plugin defaults and disable the renderer's built-in
   * sanitizer. The caller becomes responsible for sanitization.
   */
  disableDefaultPlugins?: boolean
}

export interface ToolApprovalProps {
  /** Tool call ID */
  toolCallId: string
  /** Tool name */
  toolName: string
  /** Parsed tool arguments/input */
  input: unknown
  /** Approval metadata */
  approval: {
    id: string
    needsApproval: boolean
    approved?: boolean
  }
  /** CSS class name */
  class?: string
}

export interface ToolApprovalRenderProps {
  /** Tool name */
  toolName: string
  /** Parsed input */
  input: unknown
  /** Approve the tool call */
  onApprove: () => void
  /** Deny the tool call */
  onDeny: () => void
  /** Whether user has responded */
  hasResponded: boolean
  /** User's decision (if responded) */
  approved?: boolean
}
