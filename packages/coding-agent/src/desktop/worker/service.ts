/**
 * 本文件定义 desktop worker 内部服务契约与 fail-first 基础实现。
 */

import { createDesktopError } from "../protocol/error.ts";
import { createWorkerErrorResponse, createWorkerResponse, type WorkerCommandEnvelope, type WorkerEventEnvelope, type WorkerResponseEnvelope } from "../protocol/envelope.ts";
import type { StartThreadInput } from "../protocol/thread.ts";

export interface DesktopWorkerService {
	setEventSink?(sink: (event: WorkerEventEnvelope) => void): void;
	startThread(input: StartThreadInput): Promise<void>;
	handle(envelope: WorkerCommandEnvelope): Promise<WorkerResponseEnvelope>;
	stop(reason: string): Promise<void>;
}

export class UnboundDesktopWorkerService implements DesktopWorkerService {
	private thread: StartThreadInput | undefined;

	async startThread(input: StartThreadInput): Promise<void> {
		if (!input.threadId) {
			throw new Error("threadId is required");
		}
		this.thread = input;
	}

	async handle(envelope: WorkerCommandEnvelope): Promise<WorkerResponseEnvelope> {
		if (!this.thread && envelope.command.type !== "worker.startThread") {
			return createWorkerErrorResponse(
				envelope.id,
				envelope.command.type,
				createDesktopError("invalid_state", "worker has no bound thread", true),
			);
		}
		if (envelope.command.type === "worker.startThread") {
			await this.startThread(envelope.command.input);
			return createWorkerResponse(envelope.id, envelope.command.type, { ok: true });
		}
		if (envelope.command.type === "worker.ping") {
			return createWorkerResponse(envelope.id, envelope.command.type, { ok: true });
		}
		return createWorkerErrorResponse(
			envelope.id,
			envelope.command.type,
			createDesktopError("runtime_error", "AgentSessionRuntime binding is required before this command", false),
		);
	}

	async stop(_reason: string): Promise<void> {
		this.thread = undefined;
	}
}
