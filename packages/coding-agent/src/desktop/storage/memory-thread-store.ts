/**
 * 提供用于测试和早期 main 进程集成的内存 thread store。
 */

import type { ThreadId } from "../protocol/identity.ts";
import type { ThreadSnapshot } from "../protocol/snapshot.ts";
import type { ThreadSummary } from "../protocol/thread.ts";
import type { ThreadStore } from "./thread-store.ts";

/**
 * 基于内存的 ThreadStore 实现，适用于测试与进程内集成。
 */
export class MemoryThreadStore implements ThreadStore {
	private readonly threads = new Map<ThreadId, ThreadSummary>();
	private readonly snapshots = new Map<ThreadId, ThreadSnapshot>();

	/** 保存 thread 摘要。 */
	saveThread(summary: ThreadSummary): void {
		this.threads.set(summary.threadId, summary);
	}

	/** 保存 thread snapshot。 */
	saveSnapshot(snapshot: ThreadSnapshot): void {
		this.snapshots.set(snapshot.threadId, snapshot);
	}

	/** 获取指定 thread 摘要。 */
	getThread(threadId: ThreadId): ThreadSummary | undefined {
		return this.threads.get(threadId);
	}

	/** 获取指定 thread snapshot。 */
	getSnapshot(threadId: ThreadId): ThreadSnapshot | undefined {
		return this.snapshots.get(threadId);
	}

	/** 列出所有 thread 摘要。 */
	listThreads(): ThreadSummary[] {
		return [...this.threads.values()];
	}

	/** 删除指定 thread 及其 snapshot。 */
	deleteThread(threadId: ThreadId): void {
		this.threads.delete(threadId);
		this.snapshots.delete(threadId);
	}
}
