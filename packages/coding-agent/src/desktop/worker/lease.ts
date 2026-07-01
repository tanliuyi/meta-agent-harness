/**
 * 本文件定义 worker pool 分配给 thread 的 lease。
 */

import type { CwdPath, SessionFile, ThreadId, WorkerId } from "../protocol/identity.ts";

export interface WorkerLease {
	workerId: WorkerId;
	threadId: ThreadId;
	cwd: CwdPath;
	sessionFile?: SessionFile;
	acquiredAt: number;
	lastActiveAt: number;
}

