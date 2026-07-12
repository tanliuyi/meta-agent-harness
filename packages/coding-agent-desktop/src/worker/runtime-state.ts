/**
 * 本文件从 Pi AgentSession 构建 desktop runtime state 响应。
 */

import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { toDesktopSessionTree } from '../storage/session-snapshot.ts'
import type { ThreadLiveState } from '../protocol/thread.ts'
import type { ApprovalRequest } from '../protocol/approval.ts'
import type { ExtensionDialogRequest } from '../protocol/extension-ui.ts'

/**
 * 根据 AgentSession 构建 desktop runtime 状态对象。
 * @param session - 当前 agent session 实例。
 * @returns 包含状态字段的 plain 对象。
 */
export function buildRuntimeState(
  session: AgentSession,
  approvals: ApprovalRequest[] = [],
  extensionDialogs: ExtensionDialogRequest[] = []
): ThreadLiveState {
  return {
    cwd: session.sessionManager.getCwd(),
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    isStreaming: session.isStreaming,
    isCompacting: session.isCompacting,
    steeringMode: session.steeringMode,
    followUpMode: session.followUpMode,
    sessionFile: session.sessionFile,
    sessionId: session.sessionId,
    sessionName: session.sessionName,
    sessionTree: toDesktopSessionTree(session.sessionManager.getTree()),
    currentEntryId: session.sessionManager.getLeafId(),
    autoCompactionEnabled: session.autoCompactionEnabled,
    autoRetryEnabled: session.autoRetryEnabled,
    messageCount: session.messages.length,
    pendingMessageCount: session.pendingMessageCount,
    queue: {
      steering: [...session.getSteeringMessages()],
      followUp: [...session.getFollowUpMessages()]
    },
    approvals,
    extensionDialogs,
    contextUsage: session.getContextUsage()
  }
}

/**
 * 根据 thinking level 构建 cycle 结果对象。
 * @param level - session 的 thinking level，未设置时为 undefined。
 * @returns 包含 level 的对象；若未设置则返回 null。
 */
export function buildThinkingLevelCycleResult(
  level: AgentSession['thinkingLevel'] | undefined
): { level: AgentSession['thinkingLevel'] } | null {
  if (!level) {
    return null
  }
  return { level }
}
