/**
 * 本文件测试 extension UI bridge 的 transport request/response 关联。
 */

import { describe, expect, it } from "vitest";
import { ExtensionUiBridge } from "../worker/extension-ui-bridge.ts";
import type { WorkerEventEnvelope } from "../protocol/envelope.ts";

function getProjectionRequests(events: WorkerEventEnvelope[]) {
	return events.map((event) => {
		if (event.eventType !== "projection" || event.event.type !== "extensionUi.requested") {
			throw new Error("extension UI projection event is required");
		}
		return event.event.request;
	});
}

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

	/** 验证组件 factory widget 在 desktop 下投影为可见占位 widget。 */
	it("组件 factory widget 投影为可见占位 widget", () => {
		const events: WorkerEventEnvelope[] = [];
		const bridge = new ExtensionUiBridge("thread-1", (event) => events.push(event));
		const ui = bridge.createContext();

		expect(() => {
			ui.setWidget("factory-widget", (() => undefined) as never);
		}).not.toThrow();
		expect(getProjectionRequests(events)).toEqual([
			expect.objectContaining({
				type: "setWidget",
				widgetKey: "factory-widget",
				widgetLines: ["组件工厂已注册"],
			}),
		]);
	});

	/** 验证扩展 UI API 在 desktop 下保存状态并投影可见结果。 */
	it("扩展 UI API 保存状态并投影可见结果", async () => {
		const events: WorkerEventEnvelope[] = [];
		const bridge = new ExtensionUiBridge("thread-1", (event) => events.push(event));
		const ui = bridge.createContext() as ReturnType<ExtensionUiBridge["createContext"]> & Record<string, any>;
		const editorComponent = () => undefined;

		const unsubscribe = ui.onTerminalInput((data: string) => ({ data: `${data}!` }));
		expect(bridge.handleTerminalInput("go")).toEqual({ consumed: false, data: "go!" });
		unsubscribe();
		expect(() => ui.setFooter(() => undefined)).not.toThrow();
		expect(() => ui.setHeader(() => undefined)).not.toThrow();
		await expect(ui.custom(() => undefined, { title: "测试" })).resolves.toBeUndefined();
		expect(() => ui.addAutocompleteProvider((current: unknown) => current)).not.toThrow();
		expect(() => ui.setEditorComponent(editorComponent)).not.toThrow();
		expect(ui.getEditorComponent()).toBe(editorComponent);
		expect(ui.theme.fg("accent", "text")).toBe("text");
		expect(ui.theme.bg("customMessageBg", "text")).toBe("text");
		expect(ui.theme.bold("text")).toBe("text");
		expect(ui.theme.getFgAnsi("accent")).toBe("#7dd3fc");
		expect(ui.getAllThemes()).toEqual([{ name: "default" }]);
		expect(ui.getTheme("default")).toEqual(expect.objectContaining({ name: "default" }));
		expect(ui.getTheme("dark")).toBeUndefined();
		expect(ui.setTheme("default")).toEqual({ success: true });
		expect(ui.setTheme("dark")).toEqual({ success: false, error: "Theme not found: dark" });
		expect(getProjectionRequests(events)).toEqual([
			expect.objectContaining({ type: "setStatus", statusKey: "terminalInput", statusText: "1 listener(s)" }),
			expect.objectContaining({ type: "setStatus", statusKey: "terminalInput", statusText: undefined }),
			expect.objectContaining({ type: "setStatus", statusKey: "extensionFooter", statusText: "页脚组件已注册" }),
			expect.objectContaining({ type: "setStatus", statusKey: "extensionHeader", statusText: "页头组件已注册" }),
			expect.objectContaining({ type: "setStatus", statusKey: "extensionCustom", statusText: '自定义组件 {"title":"测试"}已注册' }),
			expect.objectContaining({ type: "setStatus", statusKey: "autocomplete", statusText: "1 provider(s)" }),
			expect.objectContaining({ type: "setStatus", statusKey: "extensionEditorComponent", statusText: "编辑器组件已注册" }),
			expect.objectContaining({ type: "setStatus", statusKey: "theme", statusText: "default" }),
		]);
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
