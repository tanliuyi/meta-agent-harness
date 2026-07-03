import type { ComputedRef, InjectionKey } from 'vue'
import type { ToolCall } from './tool-group'

export type ToolCallsById = ComputedRef<Record<string, ToolCall | undefined>>

export const toolCallsByIdKey: InjectionKey<ToolCallsById> = Symbol('toolCallsById')
