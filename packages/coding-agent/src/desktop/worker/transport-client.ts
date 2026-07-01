/**
 * 本文件实现基于 transport 的 worker client。
 */

import { createDesktopError } from "../protocol/error.ts";
import type { WorkerCommand, WorkerCommandEnvelope, WorkerEnvelope, WorkerResponseEnvelope } from "../protocol/envelope.ts";
import type { ThreadId, WorkerId } from "../protocol/identity.ts";
import type { StartThreadInput } from "../protocol/thread.ts";
import type { WorkerSnapshot } from "../protocol/snapshot.ts";
import type { WorkerTransport } from "../transport/transport.ts";
import type { WorkerClient } from "./client.ts";

export interface TransportWorkerClientOptions {
	workerId: WorkerId;
	transport: WorkerTransport;
	requestTimeoutMs?: number;
	createRequestId?: () => string;
}

interface PendingRequest {
	command: string;
	resolve: (response: WorkerResponseEnvelope) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class TransportWorkerClient implements WorkerClient {
	readonly workerId: WorkerId;
	threadId?: ThreadId;
	private readonly transport: WorkerTransport;
	private readonly requestTimeoutMs: number;
	private readonly createRequestId: () => string;
	private readonly pending = new Map<string, PendingRequest>();
	private stopped = false;

	constructor(options: TransportWorkerClientOptions) {
		this.workerId = options.workerId;
		this.transport = options.transport;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
		this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
		this.transport.onMessage((envelope) => this.handleEnvelope(envelope));
		this.transport.onClose((reason) => this.rejectAll(new Error(reason)));
	}

	async startThread(input: StartThreadInput): Promise<void> {
		const response = await this.send({ type: "worker.startThread", input });
		if (!response.success) {
			throw new Error(response.error?.message ?? "failed to start thread");
		}
		this.threadId = input.threadId;
	}

	send(command: WorkerCommand): Promise<WorkerResponseEnvelope> {
		if (this.stopped) {
			return Promise.resolve({
				kind: "response",
				id: "stopped",
				command: command.type,
				success: false,
				error: createDesktopError("worker_exited", "worker is stopped", true),
			});
		}
		const id = this.createRequestId();
		const envelope: WorkerCommandEnvelope = { kind: "command", id, command };
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`request timed out: ${command.type}`));
			}, this.requestTimeoutMs);
			this.pending.set(id, { command: command.type, resolve, reject, timer });
			this.transport.send(envelope);
		});
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
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.rejectAll(new Error(reason));
		this.transport.close();
	}

	private handleEnvelope(envelope: WorkerEnvelope): void {
		if (envelope.kind !== "response") {
			return;
		}
		const pending = this.pending.get(envelope.id);
		if (!pending) {
			return;
		}
		clearTimeout(pending.timer);
		this.pending.delete(envelope.id);
		pending.resolve(envelope);
	}

	private rejectAll(error: Error): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			this.pending.delete(id);
			pending.reject(error);
		}
	}
}

