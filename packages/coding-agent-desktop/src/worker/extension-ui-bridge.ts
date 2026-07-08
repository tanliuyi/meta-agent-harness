/**
 * 实现 Pi extension UI context 与 desktop transport event 的桥接。
 */

import type { ExtensionTheme, ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import type { DesktopProjectionEvent } from "../protocol/events/projection.ts";
import type { ExtensionUiRequest, ExtensionUiResponse } from "../protocol/extension-ui.ts";
import type { ThreadId } from "../protocol/identity.ts";
import type { WorkerEventEnvelope } from "../protocol/envelope.ts";
import {
	asDesktopWebviewUri,
	resolveDesktopWebviewPanelOptions,
	resolveDesktopWebviewPanelPatch,
	type DesktopWebviewPanelOptions,
	type DesktopWebviewResourceReference,
	type DesktopWebviewUriOptions,
} from "./extension-webview-source.ts";

/** 等待中的 UI 请求。 */
interface PendingUiRequest<T> {
	resolve: (value: T) => void;
	reject: (error: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
}

interface DesktopThemeDefinition {
	name: string;
	colors: Record<string, string>;
}

interface ExtensionDesktopContext {
	readonly cspSource: string;
	registerWebviewPanel(id: string, options: DesktopWebviewPanelOptions): void;
	updateWebviewPanel(id: string, patch: Partial<DesktopWebviewPanelOptions>): void;
	asWebviewUri(resourcePath: string, options?: DesktopWebviewUriOptions): string;
	postPanelMessage(panelId: string, message: unknown): void;
	removePanel(id: string): void;
}

const desktopThemes: DesktopThemeDefinition[] = [
	{
		name: "default",
		colors: {
			pageBg: "#18181e",
			cardBg: "#1e1e24",
			infoBg: "#3c3728",
			userMessageBg: "#343541",
			text: "#f4f4f5",
			muted: "#a1a1aa",
			accent: "#7dd3fc",
			border: "#3f3f46",
			success: "#86efac",
			error: "#fca5a5",
			warning: "#fde68a",
		},
	},
];

function createDesktopTheme(definition: DesktopThemeDefinition): ExtensionTheme {
	return {
		fg: (_color, text) => text,
		bg: (_color, text) => text,
		bold: (text) => text,
		italic: (text) => text,
		underline: (text) => text,
		inverse: (text) => text,
		strikethrough: (text) => text,
		getFgAnsi: (color) => definition.colors[color] ?? "",
		getBgAnsi: (color) => definition.colors[color] ?? "",
		getColorMode: () => "dark",
		getThinkingBorderColor: () => (text) => text,
		getBashModeColor: () => (text) => text,
	};
}

function getDesktopTheme(name: string): DesktopThemeDefinition | undefined {
	return desktopThemes.find((theme) => theme.name === name);
}

type DesktopExtensionUIContext = Omit<
	ExtensionUIContext,
	"setWidget" | "custom" | "getEditorComponent" | "getAllThemes" | "getTheme" | "setTheme"
> & {
	onTerminalInput(handler: unknown): () => void;
	setWidget(widgetKey: string, widgetLines: unknown, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
	setFooter(factory: unknown): void;
	setHeader(factory: unknown): void;
	custom(factory: unknown, options?: unknown): Promise<unknown>;
	addAutocompleteProvider(factory: unknown): void;
	setEditorComponent(factory: unknown): void;
	getEditorComponent(): unknown;
	readonly theme: ExtensionTheme;
	getAllThemes(): Array<{ name: string }>;
	getTheme(name: string): DesktopThemeDefinition | undefined;
	setTheme(theme: unknown): { success: boolean; error?: string };
};

/**
 * Extension UI 桥接，实现 ExtensionUIContext 并通过 transport 事件与 renderer 交互。
 */
export class ExtensionUiBridge {
	private readonly threadId: ThreadId;
	private readonly emit: (event: WorkerEventEnvelope) => void;
	private readonly pending = new Map<string, PendingUiRequest<unknown>>();
	private readonly terminalInputHandlers = new Set<(data: string) => unknown>();
	private activeTheme = desktopThemes[0];
	private cwd: string;
	private editorText = "";
	private toolsExpanded = false;

	/**
	 * 创建 ExtensionUiBridge 实例。
	 * @param threadId - 关联的 thread ID。
	 * @param emit - 发送事件 envelope 的函数。
	 * @param cwd - 用于解析 desktop webview 相对路径的当前工作目录。
	 */
	constructor(threadId: ThreadId, emit: (event: WorkerEventEnvelope) => void, cwd = process.cwd()) {
		this.threadId = threadId;
		this.emit = emit;
		this.cwd = cwd;
	}

	/**
	 * 创建 Pi ExtensionUIContext 实例。
	 * @returns ExtensionUIContext 对象。
	 */
	createDesktopContext(): ExtensionDesktopContext {
		return {
			cspSource: "pi-webview-resource:",
			registerWebviewPanel: (id, options) => {
					const resolvedOptions = resolveDesktopWebviewPanelOptions(options, this.cwd, (resource) => this.registerWebviewResource(resource));
					this.emitUiProjection({
						type: "extensionPanel.registered",
						threadId: this.threadId,
					panel: { id, viewType: resolvedOptions.viewType ?? id, ...resolvedOptions },
				});
				},
				updateWebviewPanel: (panelId, patch) => {
					const resolvedPatch = resolveDesktopWebviewPanelPatch(patch, this.cwd, (resource) => this.registerWebviewResource(resource));
					this.emitUiProjection({
						type: "extensionPanel.updated",
						threadId: this.threadId,
					panelId,
					patch: resolvedPatch,
				});
			},
			asWebviewUri: (resourcePath, options) => {
				const token = crypto.randomUUID();
				const resource = asDesktopWebviewUri(resourcePath, options, this.cwd, token);
				this.emitUiProjection({
					type: "extensionPanel.resourceRegistered",
					threadId: this.threadId,
					resource: { ...resource, threadId: this.threadId },
				});
				return `pi-webview-resource://${token}`;
			},
			postPanelMessage: (panelId, message) => {
				this.emitUiProjection({
					type: "extensionPanel.message",
					threadId: this.threadId,
					panelId,
					message,
				});
			},
			removePanel: (panelId) => {
				this.emitUiProjection({
					type: "extensionPanel.removed",
					threadId: this.threadId,
					panelId,
				});
			},
			};
		}

	private registerWebviewResource(resource: DesktopWebviewResourceReference): string {
		const token = crypto.randomUUID();
		this.emitUiProjection({
			type: "extensionPanel.resourceRegistered",
			threadId: this.threadId,
			resource: { ...resource, token, threadId: this.threadId },
		});
		return `pi-webview-resource://${token}`;
	}

	syncCwd(cwd: string): void {
		this.cwd = cwd;
	}

	createContext(): ExtensionUIContext {
		const bridge = this;
		const context: DesktopExtensionUIContext = {
			select: (title, options, opts) =>
				this.requestDialog<string | undefined>(
					{ type: "select", id: crypto.randomUUID(), title, options, timeoutMs: opts?.timeout },
					opts,
					(response) =>
						"cancelled" in response ? undefined : "value" in response && typeof response.value === "string" ? response.value : undefined,
				),
			confirm: (title, message, opts) =>
				this.requestDialog<boolean>(
					{ type: "confirm", id: crypto.randomUUID(), title, message, timeoutMs: opts?.timeout },
					opts,
					(response) => ("cancelled" in response ? false : "confirmed" in response ? response.confirmed : false),
				),
			input: (title, placeholder, opts) =>
				this.requestDialog<string | undefined>(
					{ type: "input", id: crypto.randomUUID(), title, placeholder, timeoutMs: opts?.timeout },
					opts,
					(response) =>
						"cancelled" in response ? undefined : "value" in response && typeof response.value === "string" ? response.value : undefined,
				),
			notify: (message, notifyType) => this.emitUi({ type: "notify", id: crypto.randomUUID(), message, notifyType }),
			onTerminalInput: (handler) => {
				this.terminalInputHandlers.add(handler as (data: string) => unknown);
				this.emitUi({
					type: "setStatus",
					id: crypto.randomUUID(),
					statusKey: "terminalInput",
					statusText: `${this.terminalInputHandlers.size} listener(s)`,
				});
				return () => {
					this.terminalInputHandlers.delete(handler as (data: string) => unknown);
					this.emitUi({
						type: "setStatus",
						id: crypto.randomUUID(),
						statusKey: "terminalInput",
						statusText: this.terminalInputHandlers.size ? `${this.terminalInputHandlers.size} listener(s)` : undefined,
					});
				};
			},
			setStatus: (statusKey, statusText) =>
				this.emitUi({ type: "setStatus", id: crypto.randomUUID(), statusKey, statusText }),
			setWorkingMessage: (message) => this.emitUi({ type: "setWorkingMessage", id: crypto.randomUUID(), message }),
			setWorkingVisible: (visible) => this.emitUi({ type: "setWorkingVisible", id: crypto.randomUUID(), visible }),
			setWorkingIndicator: (options) =>
				this.emitUi({ type: "setWorkingIndicator", id: crypto.randomUUID(), options }),
			setHiddenThinkingLabel: (label) =>
				this.emitUi({ type: "setHiddenThinkingLabel", id: crypto.randomUUID(), label }),
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: (title) => this.emitUi({ type: "setTitle", id: crypto.randomUUID(), title }),
			pasteToEditor: (text) => {
				this.editorText = text;
				this.emitUi({ type: "setEditorText", id: crypto.randomUUID(), text });
			},
			setEditorText: (text) => {
				this.editorText = text;
				this.emitUi({ type: "setEditorText", id: crypto.randomUUID(), text });
			},
			getEditorText: () => this.editorText,
			editor: (title, prefill) =>
				this.requestDialog<string | undefined>(
					{ type: "editor", id: crypto.randomUUID(), title, prefill },
					undefined,
					(response) =>
						"cancelled" in response ? undefined : "value" in response && typeof response.value === "string" ? response.value : undefined,
				),
			custom: async () => undefined,
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			get theme() {
				return createDesktopTheme(bridge.activeTheme);
			},
			getAllThemes: () => desktopThemes.map((theme) => ({ name: theme.name })),
			getTheme: (name) => getDesktopTheme(name),
			setTheme: (theme) => {
				const themeName = typeof theme === "string" ? theme : typeof theme === "object" && theme !== null && "name" in theme ? String(theme.name) : undefined;
				if (!themeName) {
					return { success: false, error: "Theme name is required" };
				}
				const nextTheme = getDesktopTheme(themeName);
				if (!nextTheme) {
					return { success: false, error: `Theme not found: ${themeName}` };
				}
				this.activeTheme = nextTheme;
				this.emitUi({ type: "setStatus", id: crypto.randomUUID(), statusKey: "theme", statusText: nextTheme.name });
				return { success: true };
			},
			getToolsExpanded: () => this.toolsExpanded,
			setToolsExpanded: (expanded) => {
				this.toolsExpanded = expanded;
				this.emitUi({ type: "setToolsExpanded", id: crypto.randomUUID(), expanded });
			},
		};

		return context as ExtensionUIContext;
	}

	syncEditorText(text: string): void {
		this.editorText = text;
	}

	syncToolsExpanded(expanded: boolean): void {
		this.toolsExpanded = expanded;
	}

	handleTerminalInput(data: string): { consumed: boolean; data: string } {
		let current = data;
		for (const handler of this.terminalInputHandlers) {
			const result = handler(current) as { consume?: boolean; data?: string } | undefined;
			if (typeof result?.data === "string") {
				current = result.data;
			}
			if (result?.consume) {
				return { consumed: true, data: current };
			}
		}
		return { consumed: false, data: current };
	}

	/**
	 * 响应指定的 extension UI 请求。
	 * @param response - UI 响应。
	 */
	respond(response: ExtensionUiResponse): void {
		const pending = this.pending.get(response.id);
		if (!pending) {
			throw new Error(`extension UI request not found: ${response.id}`);
		}
		if (pending.timer) {
			clearTimeout(pending.timer);
		}
		this.pending.delete(response.id);
		pending.resolve(response);
	}

	private requestDialog<T>(
		request: ExtensionUiRequest,
		options: ExtensionUIDialogOptions | undefined,
		parse: (response: ExtensionUiResponse) => T,
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = options?.timeout
				? setTimeout(() => {
						this.pending.delete(request.id);
						reject(new Error(`extension UI request timed out: ${request.id}`));
					}, options.timeout)
				: undefined;
			this.pending.set(request.id, {
				resolve: (value) => resolve(parse(value as ExtensionUiResponse)),
				reject,
				timer,
			});
			this.emitUi(request);
		});
	}

	private emitUi(request: ExtensionUiRequest): void {
		this.emitUiProjection({ type: "extensionUi.requested", threadId: this.threadId, request });
	}

	private emitUiProjection(event: DesktopProjectionEvent): void {
		this.emit({
			kind: "event",
			eventType: "projection",
			threadId: this.threadId,
			event,
		});
	}
}
