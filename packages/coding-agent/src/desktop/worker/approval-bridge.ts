/**
 * 本文件实现 desktop approval request 与 response 的 transport 关联。
 */

import type { ApprovalRequest, ApprovalResponse } from "../protocol/approval.ts";
import type { ThreadId } from "../protocol/identity.ts";
import type { WorkerEventEnvelope } from "../protocol/envelope.ts";

interface PendingApproval {
	resolve: (response: ApprovalResponse) => void;
	reject: (error: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
}

export class ApprovalBridge {
	private readonly threadId: ThreadId;
	private readonly emit: (event: WorkerEventEnvelope) => void;
	private readonly pending = new Map<string, PendingApproval>();

	constructor(threadId: ThreadId, emit: (event: WorkerEventEnvelope) => void) {
		this.threadId = threadId;
		this.emit = emit;
	}

	request(input: Omit<ApprovalRequest, "threadId" | "createdAt">): Promise<ApprovalResponse> {
		const approval: ApprovalRequest = {
			...input,
			threadId: this.threadId,
			createdAt: new Date().toISOString(),
		};
		return new Promise<ApprovalResponse>((resolve, reject) => {
			const timer = approval.timeoutMs
				? setTimeout(() => {
						this.pending.delete(approval.approvalId);
						reject(new Error(`approval request timed out: ${approval.approvalId}`));
					}, approval.timeoutMs)
				: undefined;
			this.pending.set(approval.approvalId, { resolve, reject, timer });
			this.emit({
				kind: "event",
				eventType: "projection",
				threadId: this.threadId,
				event: { type: "approval.requested", threadId: this.threadId, approval },
			});
		});
	}

	respond(response: ApprovalResponse): void {
		const pending = this.pending.get(response.approvalId);
		if (!pending) {
			throw new Error(`approval request not found: ${response.approvalId}`);
		}
		if (pending.timer) {
			clearTimeout(pending.timer);
		}
		this.pending.delete(response.approvalId);
		pending.resolve(response);
	}

	rejectAll(reason: string): void {
		for (const [id, pending] of this.pending) {
			if (pending.timer) {
				clearTimeout(pending.timer);
			}
			this.pending.delete(id);
			pending.reject(new Error(reason));
		}
	}
}
