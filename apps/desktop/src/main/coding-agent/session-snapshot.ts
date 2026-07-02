/**
 * 本文件从 Pi-compatible canonical JSONL session 重建 desktop 最小 snapshot。
 */

import { readFileSync } from 'node:fs'
import type { ThreadMessage, ThreadSnapshot, ThreadSummary } from '../../shared/coding-agent/types'

/** 构建 snapshot 输入。 */
export interface BuildSnapshotFromSessionInput {
  /** Thread 摘要。 */
  thread: ThreadSummary
  /** runtime cwd。 */
  cwd: string
  /** session JSONL 文件路径。 */
  sessionFile: string
}

/**
 * 从 canonical session 文件构建最小 snapshot。
 * @param input - 输入。
 * @returns Thread snapshot。
 */
export function buildSnapshotFromSession(input: BuildSnapshotFromSessionInput): ThreadSnapshot {
  const entries = readSessionEntries(input.sessionFile)
  const title = findLastString(entries, 'session_info', 'name') ?? input.thread.title
  const thinkingLevel =
    normalizeThinkingLevel(findLastString(entries, 'thinking_level_change', 'thinkingLevel')) ??
    'off'
  return {
    threadId: input.thread.threadId,
    projectId: input.thread.projectId,
    cwd: input.cwd,
    sessionFile: input.sessionFile,
    title,
    status: input.thread.status,
    thinkingLevel,
    messages: entries.flatMap(toThreadMessage),
    toolCalls: [],
    fileChanges: [],
    approvals: [],
    queue: { steering: [], followUp: [] },
    diagnostics: []
  }
}

/**
 * 读取 JSONL session entries。
 * @param sessionFile - session 文件。
 * @returns entries。
 */
function readSessionEntries(sessionFile: string): unknown[] {
  return readFileSync(sessionFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown)
}

/**
 * 将 session entry 转换为 thread message。
 * @param entry - session entry。
 * @param index - entry 索引。
 * @returns thread message 或空数组。
 */
function toThreadMessage(entry: unknown, index: number): ThreadMessage[] {
  if (!isRecord(entry) || entry.type !== 'message' || !isRecord(entry.message)) {
    return []
  }
  const role = normalizeRole(entry.message.role)
  if (!role) {
    return []
  }
  return [
    {
      id: typeof entry.id === 'string' ? entry.id : `message-${index}`,
      role,
      text: extractText(entry.message.content),
      createdAt: normalizeTimestamp(entry.timestamp ?? entry.message.timestamp)
    }
  ]
}

/**
 * 查找最后一个指定类型 entry 的字符串字段。
 * @param entries - entries。
 * @param type - entry type。
 * @param key - 字段名。
 * @returns 字符串值或 undefined。
 */
function findLastString(entries: unknown[], type: string, key: string): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!isRecord(entry) || entry.type !== type || typeof entry[key] !== 'string') {
      continue
    }
    return entry[key]
  }
  return undefined
}

/**
 * 归一化消息角色。
 * @param role - 原始角色。
 * @returns ThreadMessage role 或 undefined。
 */
function normalizeRole(role: unknown): ThreadMessage['role'] | undefined {
  switch (role) {
    case 'user':
    case 'assistant':
    case 'tool':
    case 'system':
      return role
    case 'toolResult':
      return 'tool'
    case 'bashExecution':
    case 'custom':
    case 'branchSummary':
    case 'compactionSummary':
      return 'user'
    default:
      return undefined
  }
}

/**
 * 归一化 thinking level。
 * @param value - 原始值。
 * @returns ThinkingLevel 或 undefined。
 */
function normalizeThinkingLevel(
  value: string | undefined
): ThreadSnapshot['thinkingLevel'] | undefined {
  switch (value) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'off':
      return value
    default:
      return undefined
  }
}

/**
 * 提取消息文本。
 * @param content - message content。
 * @returns 文本。
 */
function extractText(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return undefined
  }
  const text = content
    .filter((part): part is { type: string; text: string } => {
      return isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    })
    .map((part) => part.text)
    .join('')
  return text || undefined
}

/**
 * 归一化 timestamp。
 * @param value - timestamp。
 * @returns ISO 字符串。
 */
function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString()
  }
  return undefined
}

/**
 * 判断是否普通对象。
 * @param value - 值。
 * @returns 是否对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
