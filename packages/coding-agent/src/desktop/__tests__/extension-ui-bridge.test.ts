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

	/** 验证 UI 状态 API 通过 projection event 投影给 renderer。 */
	it("UI 状态 API 通过 projection event 投影", () => {
		const events: WorkerEventEnvelope[] = [];
		const bridge = new ExtensionUiBridge("thread-1", (event) => events.push(event));
		const ui = bridge.createContext();

		ui.setWorkingMessage("正在索引");
		ui.setWorkingVisible(false);
		ui.setWorkingIndicator({ frames: ["-", "+"], intervalMs: 120 });
		ui.setHiddenThinkingLabel("已隐藏推理");
		ui.setToolsExpanded(true);

		const requests = events.map((event) => {
			if (event.eventType !== "projection" || event.event.type !== "extensionUi.requested") {
				throw new Error("extension UI projection event is required");
			}
			return event.event.request;
		});
		expect(requests).toEqual([
			expect.objectContaining({ type: "setWorkingMessage", message: "正在索引" }),
			expect.objectContaining({ type: "setWorkingVisible", visible: false }),
			expect.objectContaining({
				type: "setWorkingIndicator",
				options: { frames: ["-", "+"], intervalMs: 120 },
			}),
			expect.objectContaining({ type: "setHiddenThinkingLabel", label: "已隐藏推理" }),
			expect.objectContaining({ type: "setToolsExpanded", expanded: true }),
		]);
		expect(ui.getToolsExpanded()).toBe(true);
	});

	/** 验证编辑器文本同步缓存支持同步读取。 */
	it("编辑器文本同步缓存支持 getEditorText", () => {
		const bridge = new ExtensionUiBridge("thread-1", () => {});
		const ui = bridge.createContext();

		bridge.syncEditorText("from renderer");
		expect(ui.getEditorText()).toBe("from renderer");

		ui.setEditorText("from extension");
		expect(ui.getEditorText()).toBe("from extension");
	});
});
