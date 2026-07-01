/**
 * 本文件从 Pi AgentSession 构建 desktop runtime state 响应。
 */

import type { AgentSession } from "../../core/agent-session.ts";

export function buildRuntimeState(session: AgentSession): Record<string, unknown> {
	return {
		model: session.model,
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		isCompacting: session.isCompacting,
		steeringMode: session.steeringMode,
		followUpMode: session.followUpMode,
		sessionFile: session.sessionFile,
		sessionId: session.sessionId,
		sessionName: session.sessionName,
		autoCompactionEnabled: session.autoCompactionEnabled,
		messageCount: session.messages.length,
		pendingMessageCount: session.pendingMessageCount,
	};
}

export function buildThinkingLevelCycleResult(
	level: AgentSession["thinkingLevel"] | undefined,
): { level: AgentSession["thinkingLevel"] } | null {
	if (!level) {
		return null;
	}
	return { level };
}
