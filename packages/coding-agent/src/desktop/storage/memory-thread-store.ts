/**
 * 本文件提供用于测试和早期 main 进程集成的内存 thread store。
 */

import type { ThreadId } from "../protocol/identity.ts";
import type { ThreadSnapshot } from "../protocol/snapshot.ts";
import type { ThreadSummary } from "../protocol/thread.ts";
import type { ThreadStore } from "./thread-store.ts";

export class MemoryThreadStore implements ThreadStore {
	private readonly threads = new Map<ThreadId, ThreadSummary>();
	private readonly snapshots = new Map<ThreadId, ThreadSnapshot>();

	saveThread(summary: ThreadSummary): void {
		this.threads.set(summary.threadId, summary);
	}

	saveSnapshot(snapshot: ThreadSnapshot): void {
		this.snapshots.set(snapshot.threadId, snapshot);
	}

	getThread(threadId: ThreadId): ThreadSummary | undefined {
		return this.threads.get(threadId);
	}

	getSnapshot(threadId: ThreadId): ThreadSnapshot | undefined {
		return this.snapshots.get(threadId);
	}

	listThreads(): ThreadSummary[] {
		return [...this.threads.values()];
	}

	deleteThread(threadId: ThreadId): void {
		this.threads.delete(threadId);
		this.snapshots.delete(threadId);
	}
}

