/**
 * 本文件测试 SQLite thread store 的索引持久化能力。
 */

import { describe, expect, it } from "vitest";
import { SqliteThreadStore } from "../storage/sqlite-thread-store.ts";
import type { ThreadSnapshot } from "../protocol/snapshot.ts";
import type { ThreadSummary } from "../protocol/thread.ts";

describe("SqliteThreadStore", () => {
	it("保存、读取、列出和删除 thread 索引", () => {
		const store = new SqliteThreadStore(":memory:");
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

		store.deleteThread("thread-1");
		expect(store.getThread("thread-1")).toBeUndefined();
		expect(store.getSnapshot("thread-1")).toBeUndefined();
		store.close();
	});
});
