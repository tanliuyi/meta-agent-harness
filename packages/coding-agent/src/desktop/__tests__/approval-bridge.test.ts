/**
 * 本文件测试 approval bridge 的 request/response 关联。
 */

import { describe, expect, it } from "vitest";
import { ApprovalBridge } from "../worker/approval-bridge.ts";
import type { WorkerEventEnvelope } from "../protocol/envelope.ts";

/** ApprovalBridge 测试套件。 */
describe("ApprovalBridge", () => {
	/** 验证 bridge 发出审批投影事件后能正确解析响应。 */
	it("发出 approval projection event 并解析 response", async () => {
		const events: WorkerEventEnvelope[] = [];
		const bridge = new ApprovalBridge("thread-1", (event) => events.push(event));
		const pending = bridge.request({
			approvalId: "approval-1",
			action: "bash",
			risk: "medium",
			scope: "once",
			defaultAction: "deny",
		});

		bridge.respond({ approvalId: "approval-1", allow: true, scope: "once" });

		await expect(pending).resolves.toEqual({ approvalId: "approval-1", allow: true, scope: "once" });
		expect(events[0]).toMatchObject({
			kind: "event",
			eventType: "projection",
			threadId: "thread-1",
			event: {
				type: "approval.requested",
				threadId: "thread-1",
				approval: { approvalId: "approval-1", action: "bash" },
			},
		});
	});

	/** 验证对未知审批响应会 fail-first。 */
	it("未知 approval response fail-first", () => {
		const bridge = new ApprovalBridge("thread-1", () => {});

		expect(() => bridge.respond({ approvalId: "missing", allow: false, scope: "once" })).toThrow(
			"approval request not found",
		);
	});
});
