/**
 * 本文件定义 desktop UI projection event。
 */

import type { ApprovalRequest } from "../approval.ts";
import type { DesktopDiagnostic } from "../diagnostic.ts";
import type { ExtensionUiRequest } from "../extension-ui.ts";
import type { ThreadId } from "../identity.ts";
import type { DesktopThinkingLevel, ModelIdentity } from "../model.ts";
import type { ThreadSnapshot } from "../snapshot.ts";
import type { DesktopFileChange, DesktopToolCall } from "../tool.ts";
import type { ThreadRuntimeState } from "../thread.ts";

export type DesktopProjectionEvent =
	| { type: "thread.started"; threadId: ThreadId; snapshot: ThreadSnapshot }
	| { type: "thread.stateChanged"; threadId: ThreadId; status: ThreadRuntimeState }
	| { type: "thread.exited"; threadId: ThreadId; reason: string }
	| { type: "thread.error"; threadId: ThreadId; diagnostic: DesktopDiagnostic }
	| { type: "message.added"; threadId: ThreadId; messageId: string }
	| { type: "message.delta"; threadId: ThreadId; messageId: string; delta: string }
	| { type: "message.finished"; threadId: ThreadId; messageId: string }
	| { type: "tool.started"; threadId: ThreadId; toolCall: DesktopToolCall }
	| { type: "tool.updated"; threadId: ThreadId; toolCall: DesktopToolCall }
	| { type: "tool.finished"; threadId: ThreadId; toolCall: DesktopToolCall }
	| { type: "file.changed"; threadId: ThreadId; change: DesktopFileChange }
	| { type: "approval.requested"; threadId: ThreadId; approval: ApprovalRequest }
	| { type: "extensionUi.requested"; threadId: ThreadId; request: ExtensionUiRequest }
	| { type: "compaction.started"; threadId: ThreadId; reason: "manual" | "threshold" | "overflow" }
	| { type: "compaction.finished"; threadId: ThreadId; aborted: boolean }
	| { type: "model.changed"; threadId: ThreadId; model?: ModelIdentity }
	| { type: "thinking.changed"; threadId: ThreadId; level: DesktopThinkingLevel }
	| { type: "queue.changed"; threadId: ThreadId; steering: string[]; followUp: string[] }
	| { type: "snapshot.updated"; threadId: ThreadId; snapshot: ThreadSnapshot };
