/**
 * 本文件实现 desktop 后端 worker 池的纯调度逻辑。
 */

import { createDesktopError } from "../protocol/error.ts";
import type { WorkerCommand, WorkerResponseEnvelope } from "../protocol/envelope.ts";
import type { ThreadId, WorkerId } from "../protocol/identity.ts";
import type { StartThreadInput } from "../protocol/thread.ts";
import type { WorkerSnapshot } from "../protocol/snapshot.ts";
import type { WorkerClient, WorkerClientFactory } from "../worker/client.ts";
import type { WorkerLease } from "../worker/lease.ts";

export interface WorkerPoolOptions {
	maxWorkers: number;
	createWorker: WorkerClientFactory;
	now?: () => number;
}

interface QueueItem {
	input: StartThreadInput;
	resolve: (lease: WorkerLease) => void;
	reject: (error: Error) => void;
}

export class WorkerPool {
	private readonly maxWorkers: number;
	private readonly createWorker: WorkerClientFactory;
	private readonly now: () => number;
	private readonly workers = new Map<WorkerId, WorkerClient>();
	private readonly leases = new Map<ThreadId, WorkerLease>();
	private readonly queue: QueueItem[] = [];
	private active = 0;
	private closed = false;

	constructor(options: WorkerPoolOptions) {
		if (options.maxWorkers < 1) {
			throw new Error("maxWorkers must be at least 1");
		}
		this.maxWorkers = options.maxWorkers;
		this.createWorker = options.createWorker;
		this.now = options.now ?? Date.now;
	}

	acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease> {
		this.assertOpen();
		if (!input.threadId) {
			throw new Error("threadId is required");
		}
		if (this.leases.has(input.threadId)) {
			throw new Error(`thread already has a worker: ${input.threadId}`);
		}
		return new Promise((resolve, reject) => {
			this.queue.push({ input, resolve, reject });
			void this.drain();
		});
	}

	async releaseThreadWorker(threadId: ThreadId, reason: "idle" | "stop" | "archive" | "crash"): Promise<void> {
		const lease = this.leases.get(threadId);
		if (!lease) {
			throw new Error(`thread has no worker: ${threadId}`);
		}
		const worker = this.workers.get(lease.workerId);
		this.leases.delete(threadId);
		if (worker) {
			this.workers.delete(worker.workerId);
			await worker.stop(reason);
		}
		this.active -= 1;
		void this.drain();
	}

	async send(threadId: ThreadId, command: WorkerCommand): Promise<WorkerResponseEnvelope> {
		const lease = this.leases.get(threadId);
		if (!lease) {
			return {
				kind: "response",
				id: "pool",
				command: command.type,
				success: false,
				error: createDesktopError("thread_not_found", `thread has no worker: ${threadId}`, true),
			};
		}
		const worker = this.workers.get(lease.workerId);
		if (!worker) {
			return {
				kind: "response",
				id: "pool",
				command: command.type,
				success: false,
				error: createDesktopError("worker_not_found", `worker not found: ${lease.workerId}`, true),
			};
		}
		lease.lastActiveAt = this.now();
		return worker.send(command);
	}

	getWorker(workerId: WorkerId): WorkerSnapshot | undefined {
		return this.workers.get(workerId)?.snapshot();
	}

	listWorkers(): WorkerSnapshot[] {
		return [...this.workers.values()].map((worker) => worker.snapshot());
	}

	listLeases(): WorkerLease[] {
		return [...this.leases.values()];
	}

	getQueuedCount(): number {
		return this.queue.length;
	}

	async markWorkerCrashed(workerId: WorkerId): Promise<void> {
		const worker = this.workers.get(workerId);
		if (!worker) {
			throw new Error(`worker not found: ${workerId}`);
		}
		const lease = [...this.leases.values()].find((item) => item.workerId === workerId);
		if (lease) {
			this.leases.delete(lease.threadId);
		}
		this.workers.delete(workerId);
		this.active -= 1;
		void this.drain();
	}

	async shutdown(): Promise<void> {
		this.closed = true;
		const workers = [...this.workers.values()];
		this.queue.splice(0).forEach((item) => item.reject(new Error("worker pool is closed")));
		this.workers.clear();
		this.leases.clear();
		this.active = 0;
		await Promise.all(workers.map((worker) => worker.stop("shutdown")));
	}

	private async drain(): Promise<void> {
		while (!this.closed && this.active < this.maxWorkers && this.queue.length > 0) {
			const item = this.queue.shift();
			if (!item) {
				return;
			}
			this.active += 1;
			try {
				const worker = await this.createWorker();
				await worker.startThread(item.input);
				if (!item.input.threadId) {
					throw new Error("threadId is required");
				}
				const time = this.now();
				const lease: WorkerLease = {
					workerId: worker.workerId,
					threadId: item.input.threadId,
					cwd: item.input.cwd,
					sessionFile: item.input.sessionFile,
					acquiredAt: time,
					lastActiveAt: time,
				};
				this.workers.set(worker.workerId, worker);
				this.leases.set(item.input.threadId, lease);
				item.resolve(lease);
			} catch (error) {
				this.active -= 1;
				item.reject(error instanceof Error ? error : new Error(String(error)));
			}
		}
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new Error("worker pool is closed");
		}
	}
}

