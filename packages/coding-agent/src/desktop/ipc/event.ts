/**
 * 本文件定义 Electron preload IPC 转发给 renderer 的事件结构。
 */

import type { AgentSessionEvent } from "../../core/agent-session.ts";
import type { ThreadId } from "../protocol/identity.ts";
import type { ThreadSnapshot } from "../protocol/snapshot.ts";
import type { DesktopProjectionEvent } from "../protocol/events/projection.ts";
import type { WorkerLifecycleEvent } from "../protocol/events/worker.ts";

export type DesktopIpcEvent =
	| { type: "canonical"; threadId: ThreadId; event: AgentSessionEvent }
	| { type: "projection"; threadId: ThreadId; event: DesktopProjectionEvent }
	| { type: "worker"; threadId?: ThreadId; event: WorkerLifecycleEvent }
	| { type: "threadSnapshot"; threadId: ThreadId; snapshot: ThreadSnapshot };

