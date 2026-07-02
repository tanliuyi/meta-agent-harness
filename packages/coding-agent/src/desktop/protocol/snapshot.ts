/**
 * 定义 thread snapshot 与 worker snapshot。
 */

import type { DesktopDiagnostic } from "./diagnostic.ts";
import type { CwdPath, SessionFile, ThreadId, WorkerId } from "./identity.ts";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelIdentity } from "./model.ts";
import type { ApprovalRequest } from "./approval.ts";
import type { DesktopFileChange, DesktopToolCall } from "./tool.ts";
import type { ThreadRuntimeState } from "./thread.ts";

/** Desktop 消息。 */
export interface DesktopMessage {
	/** 消息 ID。 */
	id: string;
	/** 消息角色。 */
	role: "user" | "assistant" | "tool" | "system";
	/** 派生文本内容，仅供简化 UI 展示。 */
	text?: string;
	/** 原始 Agent message，供 renderer 消费非文本结构。 */
	raw: AgentMessage;
	/** 创建时间（ISO 8601）。 */
	createdAt?: string;
}

/** Thread snapshot。 */
export interface ThreadSnapshot {
	/** 线程 ID。 */
	threadId: ThreadId;
	/** 当前工作目录。 */
	cwd: CwdPath;
	/** Session 文件路径（可选）。 */
	sessionFile?: SessionFile;
	/** 线程标题。 */
	title?: string;
	/** 线程运行时状态。 */
	status: ThreadRuntimeState;
	/** 当前模型身份（可选）。 */
	model?: ModelIdentity;
	/** 当前 thinking 级别。 */
	thinkingLevel: ThinkingLevel;
	/** 消息列表。 */
	messages: DesktopMessage[];
	/** 工具调用列表。 */
	toolCalls: DesktopToolCall[];
	/** 文件变更列表。 */
	fileChanges: DesktopFileChange[];
	/** 待审批请求列表。 */
	approvals: ApprovalRequest[];
	/** 队列信息。 */
	queue: {
		/** Steering 队列。 */
		steering: string[];
		/** Follow-up 队列。 */
		followUp: string[];
	};
	/** 上下文使用情况。 */
	context?: {
		/** 已使用 token 数。 */
		tokens?: number;
		/** 上下文窗口大小。 */
		contextWindow?: number;
		/** 使用百分比。 */
		percent?: number;
	};
	/** 成本信息。 */
	cost?: {
		/** 总成本。 */
		total: number;
	};
	/** 诊断信息列表。 */
	diagnostics: DesktopDiagnostic[];
}

/** Worker snapshot。 */
export interface WorkerSnapshot {
	/** Worker ID。 */
	workerId: WorkerId;
	/** 关联线程 ID（可选）。 */
	threadId?: ThreadId;
	/** Worker 状态。 */
	state: "starting" | "ready" | "bound" | "busy" | "idle" | "stopping" | "exited" | "crashed";
	/** 进程 ID（可选）。 */
	pid?: number;
	/** 启动时间（ISO 8601）。 */
	startedAt?: string;
	/** 最后活跃时间（ISO 8601）。 */
	lastActiveAt?: string;
	/** 关联线程快照（可选）。 */
	thread?: ThreadSnapshot;
	/** 诊断信息列表。 */
	diagnostics: DesktopDiagnostic[];
}
