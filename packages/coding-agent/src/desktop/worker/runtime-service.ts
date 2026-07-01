/**
 * 本文件实现接入 Pi AgentSessionRuntime 的 desktop worker service。
 */

import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import { createDesktopError } from "../protocol/error.ts";
import { createWorkerErrorResponse, createWorkerResponse, type WorkerCommandEnvelope, type WorkerEventEnvelope, type WorkerResponseEnvelope } from "../protocol/envelope.ts";
import type { ThreadId } from "../protocol/identity.ts";
import type { StartThreadInput } from "../protocol/thread.ts";
import type { DesktopWorkerService } from "./service.ts";
import { ApprovalBridge } from "./approval-bridge.ts";
import { createRuntimeForThread } from "./runtime-factory.ts";
import { ExtensionUiBridge } from "./extension-ui-bridge.ts";
import { handleRuntimeCommand } from "./runtime-command-handler.ts";

export type CreateRuntimeForThread = (
	input: StartThreadInput,
	options: { approvalBridge: ApprovalBridge; hasUI: boolean },
) => Promise<AgentSessionRuntime>;

export class RuntimeDesktopWorkerService implements DesktopWorkerService {
	private runtime: AgentSessionRuntime | undefined;
	private readonly createRuntime: CreateRuntimeForThread;
	private eventSink: ((event: WorkerEventEnvelope) => void) | undefined;
	private unsubscribeSession: (() => void) | undefined;
	private approvalBridge: ApprovalBridge | undefined;
	private uiBridge: ExtensionUiBridge | undefined;
	private threadId: ThreadId | undefined;
	private started = false;

	constructor(createRuntime: CreateRuntimeForThread = createRuntimeForThread) {
		this.createRuntime = createRuntime;
	}

	setEventSink(sink: (event: WorkerEventEnvelope) => void): void {
		this.eventSink = sink;
	}

	async startThread(input: StartThreadInput): Promise<void> {
		if (!input.threadId) {
			throw new Error("threadId is required");
		}
		if (this.started) {
			throw new Error("worker already has a bound thread");
		}
		this.threadId = input.threadId;
		this.approvalBridge = new ApprovalBridge(input.threadId, (event) => this.eventSink?.(event));
		this.runtime = await this.createRuntime(input, { approvalBridge: this.approvalBridge, hasUI: true });
		this.uiBridge = new ExtensionUiBridge(input.threadId, (event) => this.eventSink?.(event));
		await this.runtime.session.bindExtensions({ uiContext: this.uiBridge.createContext(), mode: "rpc" });
		this.bindSessionEvents();
		this.started = true;
		this.eventSink?.({
			kind: "event",
			eventType: "projection",
			threadId: input.threadId,
			event: { type: "thread.stateChanged", threadId: input.threadId, status: "idle" },
		});
	}

	async handle(envelope: WorkerCommandEnvelope): Promise<WorkerResponseEnvelope> {
		if (envelope.command.type === "worker.startThread") {
			try {
				await this.startThread(envelope.command.input);
				return createWorkerResponse(envelope.id, envelope.command.type, { ok: true });
			} catch (error) {
				return createWorkerErrorResponse(
					envelope.id,
					envelope.command.type,
					createDesktopError("runtime_error", error instanceof Error ? error.message : String(error), false),
				);
			}
		}
		if (envelope.command.type === "worker.ping") {
			return createWorkerResponse(envelope.id, envelope.command.type, { ok: true });
		}
		if (envelope.command.type === "ui.respond") {
			try {
				this.uiBridge?.respond(envelope.command.response);
				return createWorkerResponse(envelope.id, envelope.command.type, { ok: true });
			} catch (error) {
				return createWorkerErrorResponse(
					envelope.id,
					envelope.command.type,
					createDesktopError("invalid_state", error instanceof Error ? error.message : String(error), true),
				);
			}
		}
		if (envelope.command.type === "approval.respond") {
			try {
				this.approvalBridge?.respond(envelope.command.response);
				return createWorkerResponse(envelope.id, envelope.command.type, { ok: true });
			} catch (error) {
				return createWorkerErrorResponse(
					envelope.id,
					envelope.command.type,
					createDesktopError("invalid_state", error instanceof Error ? error.message : String(error), true),
				);
			}
		}
		if (!this.started) {
			return createWorkerErrorResponse(
				envelope.id,
				envelope.command.type,
				createDesktopError("invalid_state", "worker has no bound thread", true),
			);
		}
		if (!this.runtime) {
			return createWorkerErrorResponse(
				envelope.id,
				envelope.command.type,
				createDesktopError("invalid_state", "worker runtime is missing", false),
			);
		}
		const response = await handleRuntimeCommand(
			{
				runtime: this.runtime,
				rebindSession: async () => {
					this.bindSessionEvents();
				},
			},
			envelope,
		);
		if (response) {
			return response;
		}
		return createWorkerErrorResponse(
			envelope.id,
			envelope.command.type,
			createDesktopError("invalid_command", `Unsupported worker command: ${envelope.command.type}`, true),
		);
	}

	async stop(_reason: string): Promise<void> {
		this.unsubscribeSession?.();
		this.unsubscribeSession = undefined;
		this.approvalBridge?.rejectAll("worker stopped");
		await this.runtime?.dispose();
		this.runtime = undefined;
		this.approvalBridge = undefined;
		this.uiBridge = undefined;
		this.threadId = undefined;
		this.started = false;
	}

	private bindSessionEvents(): void {
		this.unsubscribeSession?.();
		const threadId = this.threadId;
		const runtime = this.runtime;
		if (!threadId || !runtime) {
			return;
		}
		this.unsubscribeSession = runtime.session.subscribe((event) => {
			this.eventSink?.({ kind: "event", eventType: "canonical", threadId, event });
			if (event.type === "thinking_level_changed") {
				this.eventSink?.({
					kind: "event",
					eventType: "projection",
					threadId,
					event: { type: "thinking.changed", threadId, level: event.level },
				});
			}
			if (event.type === "queue_update") {
				this.eventSink?.({
					kind: "event",
					eventType: "projection",
					threadId,
					event: {
						type: "queue.changed",
						threadId,
						steering: [...event.steering],
						followUp: [...event.followUp],
					},
				});
			}
		});
	}
}
