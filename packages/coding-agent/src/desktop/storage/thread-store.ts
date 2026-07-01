/**
 * 本文件定义 desktop 状态层的 thread 索引接口。
 */

import type { ThreadId } from "../protocol/identity.ts";
import type { ThreadSnapshot } from "../protocol/snapshot.ts";
import type { ThreadSummary } from "../protocol/thread.ts";

export interface ThreadStore {
	saveThread(summary: ThreadSummary): void;
	saveSnapshot(snapshot: ThreadSnapshot): void;
	getThread(threadId: ThreadId): ThreadSummary | undefined;
	getSnapshot(threadId: ThreadId): ThreadSnapshot | undefined;
	listThreads(): ThreadSummary[];
	deleteThread(threadId: ThreadId): void;
}

