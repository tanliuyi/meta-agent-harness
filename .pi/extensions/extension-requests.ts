import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PANEL_ID = "extension-requests";
const PANEL_VIEW_TYPE = "pi.extensionRequests";
const panelRoot = fileURLToPath(new URL("./extension-requests-panel", import.meta.url));

type RequestState = {
	clicks: number;
	lastAction?: string;
	lastResult?: string;
	updatedAt: string;
};

type PanelMessage = {
	type?: string;
	action?: string;
	value?: unknown;
};

function createState(): RequestState {
	return {
		clicks: 0,
		updatedAt: new Date().toISOString(),
	};
}

function postState(ctx: ExtensionContext, state: RequestState): void {
	ctx.desktop.postPanelMessage(PANEL_ID, {
		type: "extension-requests-state",
		...state,
	});
}

function registerPanel(ctx: ExtensionContext, state: RequestState): void {
	ctx.desktop.registerWebviewPanel(PANEL_ID, {
		viewType: PANEL_VIEW_TYPE,
		title: "请求",
		icon: "mouse-pointer-click",
		order: 45,
		source: {
			type: "file",
			path: "index.html",
			basePath: panelRoot,
			localResourceRoots: [panelRoot],
			permissions: { enableScripts: true, forms: true },
		},
	});
	postState(ctx, state);
}

function formatAction(action: string, value: unknown): string {
	const labels: Record<string, string> = {
		"notify-info": "信息通知",
		"clicked-secondary": "次要按钮",
		"clicked-subtle": "弱化按钮",
		"notify-error": "错误通知",
		confirm: "确认请求",
		select: "选择请求",
		input: "输入请求",
		editor: "编辑器请求",
		paste: "粘贴到编辑器",
		"set-editor-text": "设置编辑器文本",
		"icon-add": "添加图标按钮",
		"icon-run": "运行图标按钮",
		"icon-stop": "停止图标按钮",
		"icon-delete": "删除图标按钮",
		segment: `分段按钮：${String(value || "-")}`,
		toggle: `切换按钮：${value === "on" ? "开启" : "关闭"}`,
		"notify-warning": "警告通知",
		status: "设置状态",
		"clear-status": "清除状态",
		"menu-copy": "菜单复制",
		"menu-export": "菜单导出",
		"menu-delete": "菜单删除",
	};
	return labels[action] ?? action;
}

async function handleAction(action: string, value: unknown, ctx: ExtensionContext): Promise<string> {
	switch (action) {
		case "notify-info":
			ctx.ui.notify("来自 extension-requests 的信息通知", "info");
			return "已发送信息通知";
		case "notify-warning":
			ctx.ui.notify("来自 extension-requests 的警告通知", "warning");
			return "已发送警告通知";
		case "notify-error":
			ctx.ui.notify("来自 extension-requests 的错误通知", "error");
			return "已发送错误通知";
		case "confirm": {
			const confirmed = await ctx.ui.confirm("拓展请求", "确认这个按钮请求？");
			return confirmed ? "已确认" : "已取消确认";
		}
		case "select": {
			const selected = await ctx.ui.select("拓展请求", ["主要", "次要", "危险"]);
			return selected ? `已选择 ${selected}` : "已取消选择";
		}
		case "input": {
			const input = await ctx.ui.input("拓展请求", "输入测试值");
			return input ? `输入：${input}` : "已取消输入";
		}
		case "editor": {
			const text = await ctx.ui.editor("拓展请求", "可编辑的测试文本");
			return text ? `编辑器返回 ${text.length} 个字符` : "已取消编辑";
		}
		case "paste":
			ctx.ui.pasteToEditor("由拓展请求面板粘贴的文本");
			return "已请求粘贴到编辑器";
		case "set-editor-text":
			ctx.ui.setEditorText("由拓展请求面板设置的编辑器文本");
			return "已请求替换编辑器文本";
		case "status":
			ctx.ui.setStatus("extension-requests", String(value || "按钮测试中"));
			return "已更新拓展状态";
		case "clear-status":
			ctx.ui.setStatus("extension-requests", undefined);
			return "已清除拓展状态";
		default:
			return `已点击 ${action}`;
	}
}

export default function extensionRequests(pi: ExtensionAPI) {
	const state = createState();

	pi.on("session_start", (_event, ctx) => {
		registerPanel(ctx, state);
	});

	pi.on("desktop_panel_restore", (event, ctx) => {
		if (event.viewType !== PANEL_VIEW_TYPE && event.panelId !== PANEL_ID) return;
		registerPanel(ctx, state);
	});

	pi.on("desktop_panel_view_state_changed", (event, ctx) => {
		if (event.panelId !== PANEL_ID || !event.visible) return;
		postState(ctx, state);
	});

	pi.on("desktop_panel_message", async (event, ctx) => {
		if (event.panelId !== PANEL_ID) return;
		const message = event.message as PanelMessage;

		if (message.type === "ready" || message.type === "refresh") {
			postState(ctx, state);
			return;
		}

		if (message.type !== "button" || !message.action) {
			postState(ctx, state);
			return;
		}

		state.clicks += 1;
		state.lastAction = formatAction(message.action, message.value);
		state.updatedAt = new Date().toISOString();
		state.lastResult = await handleAction(message.action, message.value, ctx);
		postState(ctx, state);
	});

	pi.registerCommand("extension-requests", {
		description: "显示拓展请求按钮测试面板",
		handler: async (_args, ctx) => {
			registerPanel(ctx, state);
			ctx.ui.notify("拓展请求按钮面板已可用", "info");
		},
	});
}
