/**
 * 本文件测试 desktop 状态索引 store。
 */

import { describe, expect, it } from "vitest";
import { MemoryThreadStore } from "../storage/memory-thread-store.ts";
import type { ThreadSnapshot } from "../protocol/snapshot.ts";
import type { ThreadSummary } from "../protocol/thread.ts";

/** MemoryThreadStore 测试套件。 */
describe("MemoryThreadStore", () => {
	/** 验证保存 thread summary 和 snapshot 后能正确读取。 */
	it("保存 thread summary 和 snapshot", () => {
		const store = new MemoryThreadStore();
		const summary: ThreadSummary = {
			threadId: "thread-1",
			cwd: "H:/repo",
			status: "idle",
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
		};
		const snapshot: ThreadSnapshot = {
			threadId: "thread-1",
			cwd: "H:/repo",
			status: "idle",
			thinkingLevel: "off",
			messages: [],
			toolCalls: [],
			fileChanges: [],
			approvals: [],
			queue: { steering: [], followUp: [] },
			diagnostics: [],
		};

		store.saveThread(summary);
		store.saveSnapshot(snapshot);

		expect(store.getThread("thread-1")).toEqual(summary);
		expect(store.getSnapshot("thread-1")).toEqual(snapshot);
		expect(store.listThreads()).toEqual([summary]);
	});

	/** 验证删除 thread 时同时删除 snapshot 索引。 */
	it("删除 thread 时同时删除 snapshot 索引", () => {
		const store = new MemoryThreadStore();
		store.saveThread({
			threadId: "thread-1",
			cwd: "H:/repo",
			status: "idle",
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
		});
		store.saveSnapshot({
			threadId: "thread-1",
			cwd: "H:/repo",
			status: "idle",
			thinkingLevel: "off",
			messages: [],
			toolCalls: [],
			fileChanges: [],
			approvals: [],
			queue: { steering: [], followUp: [] },
			diagnostics: [],
		});

		store.deleteThread("thread-1");

		expect(store.getThread("thread-1")).toBeUndefined();
		expect(store.getSnapshot("thread-1")).toBeUndefined();
	});
});
