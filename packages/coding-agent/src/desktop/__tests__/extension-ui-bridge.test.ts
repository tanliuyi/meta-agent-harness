/**
 * 本文件测试 extension UI bridge 的 transport request/response 关联。
 */

import { describe, expect, it } from "vitest";
import { ExtensionUiBridge } from "../worker/extension-ui-bridge.ts";
import type { WorkerEventEnvelope } from "../protocol/envelope.ts";

/** ExtensionUiBridge 测试套件。 */
describe("ExtensionUiBridge", () => {
	/** 验证 select 请求通过投影事件发出并可用 UI 响应解析结果。 */
	it("select 通过 projection event 请求并用 ui response 解析结果", async () => {
		const events: WorkerEventEnvelope[] = [];
		const bridge = new ExtensionUiBridge("thread-1", (event) => events.push(event));
		const pending = bridge.createContext().select("选择", ["a", "b"]);

		const request = events[0];
		if (request?.eventType !== "projection" || request.event.type !== "extensionUi.requested") {
			throw new Error("extension UI request event is required");
		}
		bridge.respond({ id: request.event.request.id, value: "b" });

		await expect(pending).resolves.toBe("b");
		expect(request.event.request).toMatchObject({
			type: "select",
			title: "选择",
			options: ["a", "b"],
		});
	});

	/** 验证对未知 response id 会 fail-first。 */
	it("未知 response id fail-first", () => {
		const bridge = new ExtensionUiBridge("thread-1", () => {});

		expect(() => bridge.respond({ id: "missing", cancelled: true })).toThrow("extension UI request not found");
	});
});
