/**
 * 本文件定义 worker lifecycle event。
 */

import type { DesktopError } from "../error.ts";
import type { ThreadId, WorkerId } from "../identity.ts";

export type WorkerLifecycleEvent =
	| { type: "worker.ready"; workerId: WorkerId }
	| { type: "worker.bound"; workerId: WorkerId; threadId: ThreadId }
	| { type: "worker.released"; workerId: WorkerId; threadId: ThreadId; reason: string }
	| { type: "worker.exited"; workerId: WorkerId; threadId?: ThreadId; exitCode: number | null; signal: string | null }
	| { type: "worker.crashed"; workerId: WorkerId; threadId?: ThreadId; error: DesktopError }
	| { type: "worker.protocolError"; workerId: WorkerId; error: DesktopError }
	| { type: "worker.heartbeatMissed"; workerId: WorkerId };

