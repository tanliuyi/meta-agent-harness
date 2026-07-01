/**
 * 定义 desktop 状态层的 thread 索引接口。
 */

import type { ThreadId } from "../protocol/identity.ts";
import type { ThreadSnapshot } from "../protocol/snapshot.ts";
import type { ThreadSummary } from "../protocol/thread.ts";

/**
 * Thread 索引存储接口，负责 thread 摘要与 snapshot 的持久化。
 */
export interface ThreadStore {
	/** 保存 thread 摘要。 */
	saveThread(summary: ThreadSummary): void;
	/** 保存 thread snapshot。 */
	saveSnapshot(snapshot: ThreadSnapshot): void;
	/** 获取指定 thread 摘要。 */
	getThread(threadId: ThreadId): ThreadSummary | undefined;
	/** 获取指定 thread snapshot。 */
	getSnapshot(threadId: ThreadId): ThreadSnapshot | undefined;
	/** 列出所有 thread 摘要。 */
	listThreads(): ThreadSummary[];
	/** 删除指定 thread 及其 snapshot。 */
	deleteThread(threadId: ThreadId): void;
}
