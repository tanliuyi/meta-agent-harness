/**
 * 本文件只做 Desktop Project-aware snapshot 适配。
 * JSONL 读取和 Pi message 转换复用 packages/coding-agent 的 desktop storage 逻辑。
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  toDesktopFileChanges,
  toDesktopMessages,
  toDesktopToolCalls
} from '@coding-agent-desktop-src/protocol/message'
import { buildSnapshotFromSession as buildPackageSnapshotFromSession } from '@coding-agent-desktop-src/storage/session-snapshot'
import { readCanonicalSessionMessages as readPackageCanonicalSessionMessages } from '@coding-agent-desktop-src/storage/session-snapshot'
import type { CanonicalSessionMessages } from '@coding-agent-desktop-src/storage/session-snapshot'
import type { ThreadMessage, ThreadSnapshot, ThreadSummary } from '@shared/coding-agent/types'

/** 构建 snapshot 输入。 */
export interface BuildSnapshotFromSessionInput {
  /** Thread 摘要。 */
  thread: ThreadSummary
  /** runtime cwd fallback。 */
  cwd: string
  /** session JSONL 文件路径。 */
  sessionFile: string
  /** 可选 cwd 覆盖；未设置时使用 JSONL session header cwd。 */
  cwdOverride?: string
  /** 可选当前 leaf 覆盖；用于 live runtime 尚未写回 JSONL leaf 的场景。 */
  currentEntryId?: string | null
  /** 已知模型上下文窗口，key 为 provider/modelId。 */
  modelContextWindows?: Record<string, number>
}

/**
 * 从 canonical session 文件构建 Desktop Project-aware snapshot。
 * @param input - 输入。
 * @returns Thread snapshot。
 */
export function buildSnapshotFromSession(input: BuildSnapshotFromSessionInput): ThreadSnapshot {
  const snapshot = buildPackageSnapshotFromSession({
    thread: {
      threadId: input.thread.threadId,
      cwd: input.cwd,
      sessionFile: input.thread.sessionFile,
      title: input.thread.title,
      status: input.thread.status,
      createdAt: input.thread.createdAt,
      updatedAt: input.thread.updatedAt
    },
    sessionFile: input.sessionFile,
    cwdOverride: input.cwdOverride,
    currentEntryId: input.currentEntryId,
    modelContextWindows: input.modelContextWindows
  })
  return {
    ...snapshot,
    projectId: input.thread.projectId
  }
}

/** 直接读取 Pi JSONL 当前 branch 的 canonical messages。 */
export function readCanonicalSessionMessages(input: {
  sessionFile: string
  cwdOverride?: string
  currentEntryId?: string | null
}): CanonicalSessionMessages {
  return readPackageCanonicalSessionMessages(input)
}

/**
 * 将 Pi AgentMessage 列表转换为 desktop thread messages。
 * @param messages - Pi live/context messages。
 * @returns desktop messages。
 */
export function toThreadMessages(
  messages: AgentMessage[],
  sessionEntryIds: string[] = []
): ThreadMessage[] {
  return toDesktopMessages(messages, sessionEntryIds)
}

/**
 * 将 Pi AgentMessage 列表转换为 desktop tool calls。
 * @param messages - Pi live/context messages。
 * @param threadId - 线程 ID。
 * @returns desktop tool calls。
 */
export function toThreadToolCalls(
  messages: AgentMessage[],
  threadId: string
): ThreadSnapshot['toolCalls'] {
  return toDesktopToolCalls(messages, threadId)
}

/**
 * 将 Pi AgentMessage 列表转换为 desktop file changes。
 * @param messages - Pi live/context messages。
 * @param threadId - 线程 ID。
 * @param cwd - edit 工具运行目录。
 * @returns desktop file changes。
 */
export function toThreadFileChanges(
  messages: AgentMessage[],
  threadId: string,
  cwd?: string
): ThreadSnapshot['fileChanges'] {
  return toDesktopFileChanges(messages, threadId, cwd)
}
