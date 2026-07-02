import type { ThreadMessage } from '@shared/coding-agent/types'

/**
 * 格式化消息时间。
 * @param value - ISO 时间。
 * @returns 本地时间。
 */
export function formatMessageTime(value: string | undefined): string {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

/**
 * 获取消息文本，优先使用派生 text，随后回退到 raw content。
 * @param message - Thread message。
 * @returns 文本。
 */
export function getMessageText(message: ThreadMessage): string | undefined {
  if (message.text) {
    return message.text
  }
  const raw = getMessageRawRecord(message)
  const content = raw.content
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return undefined
  }
  const text = content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('')
  return text || undefined
}

/**
 * 获取消息 raw 的对象视图。
 * @param message - Thread message。
 * @returns raw 对象。
 */
export function getMessageRawRecord(message: ThreadMessage): Record<string, unknown> {
  return isRecord(message.raw) ? message.raw : {}
}

/**
 * 把未知结构转成适合 UI 展示的短 JSON。
 * @param value - 未知值。
 * @returns 展示文本。
 */
export function formatUnknown(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * 判断普通对象。
 * @param value - 值。
 * @returns 是否普通对象。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
