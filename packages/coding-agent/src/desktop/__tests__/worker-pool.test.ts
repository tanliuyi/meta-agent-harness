/**
 * 本文件测试 desktop worker pool 的调度、排队和清理行为。
 */

import { describe, expect, it, vi } from "vitest";
import { WorkerPool } from "../pool/worker-pool.ts";
import type { WorkerCommand, WorkerResponseEnvelope } from "../protocol/envelope.ts";
import type { WorkerSnapshot } from "../protocol/snapshot.ts";
import type { StartThreadInput } from "../protocol/thread.ts";
import type { WorkerClient } from "../worker/client.ts";

class FakeWorkerClient implements WorkerClient {
	readonly workerId: string;
	threadId?: string;
	stoppedWith: string | undefined;

	constructor(workerId: string) {
		this.workerId = workerId;
	}

	async startThread(input: StartThreadInput): Promise<void> {
		this.threadId = input.threadId;
	}

	async send(command: WorkerCommand): Promise<WorkerResponseEnvelope> {
		return {
			kind: "response",
			id: "fake",
			command: command.type,
			success: true,
			data: { workerId: this.workerId },
		};
	}

	snapshot(): WorkerSnapshot {
		return {
			workerId: this.workerId,
			threadId: this.threadId,
			state: this.threadId ? "bound" : "ready",
			diagnostics: [],
		};
	}

	async stop(reason: string): Promise<void> {
		this.stoppedWith = reason;
	}
}

/** WorkerPool 测试套件。 */
describe("WorkerPool", () => {
	/** 验证限制并发并排队等待 release。 */
	it("限制并发并排队等待 release", async () => {
		let count = 0;
		const workers: FakeWorkerClient[] = [];
		const pool = new WorkerPool({
			maxWorkers: 1,
			createWorker: async () => {
				const worker = new FakeWorkerClient(`worker-${++count}`);
				workers.push(worker);
				return worker;
			},
			now: () => 1000,
		});

		const first = await pool.acquireThreadWorker({ threadId: "thread-1", cwd: "H:/repo" });
		const secondPromise = pool.acquireThreadWorker({ threadId: "thread-2", cwd: "H:/repo" });

		expect(first.workerId).toBe("worker-1");
		expect(pool.getQueuedCount()).toBe(1);
		expect(pool.listLeases()).toHaveLength(1);

		await pool.releaseThreadWorker("thread-1", "idle");
		const second = await secondPromise;

		expect(second.workerId).toBe("worker-2");
		expect(workers[0].stoppedWith).toBe("idle");
		expect(pool.getQueuedCount()).toBe(0);
		expect(pool.listLeases()).toHaveLength(1);
	});

	/** 验证 send 在 thread 没有 lease 时 fail first。 */
	it("send 在 thread 没有 lease 时 fail first", async () => {
		const pool = new WorkerPool({
			maxWorkers: 1,
			createWorker: async () => new FakeWorkerClient("worker-1"),
		});

		const response = await pool.send("missing", { type: "abort" });

		expect(response.success).toBe(false);
		expect(response.error?.code).toBe("thread_not_found");
	});

	/** 验证 worker crash 会清理 lease 并继续调度队列。 */
	it("worker crash 会清理 lease 并继续调度队列", async () => {
		let count = 0;
		const pool = new WorkerPool({
			maxWorkers: 1,
			createWorker: async () => new FakeWorkerClient(`worker-${++count}`),
		});

		const first = await pool.acquireThreadWorker({ threadId: "thread-1", cwd: "H:/repo" });
		const secondPromise = pool.acquireThreadWorker({ threadId: "thread-2", cwd: "H:/repo" });

		await pool.markWorkerCrashed(first.workerId);
		const second = await secondPromise;

		expect(second.threadId).toBe("thread-2");
		expect(pool.listLeases().map((lease) => lease.threadId)).toEqual(["thread-2"]);
	});

	/** 验证 shutdown 停止全部 worker 并拒绝队列。 */
	it("shutdown 停止全部 worker 并拒绝队列", async () => {
		let count = 0;
		const worker = new FakeWorkerClient("worker-1");
		const pool = new WorkerPool({
			maxWorkers: 1,
			createWorker: async () => {
				count += 1;
				return count === 1 ? worker : new FakeWorkerClient(`worker-${count}`);
			},
		});

		await pool.acquireThreadWorker({ threadId: "thread-1", cwd: "H:/repo" });
		const queued = pool.acquireThreadWorker({ threadId: "thread-2", cwd: "H:/repo" });
		const rejected = vi.fn();
		queued.catch(rejected);

		await pool.shutdown();
		await Promise.resolve();

		expect(worker.stoppedWith).toBe("shutdown");
		expect(pool.listLeases()).toEqual([]);
		expect(rejected).toHaveBeenCalled();
	});
});
