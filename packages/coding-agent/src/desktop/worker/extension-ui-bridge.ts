/**
 * 实现 Pi extension UI context 与 desktop transport event 的桥接。
 */

import type { ExtensionUIContext, ExtensionUIDialogOptions } from "../../core/extensions/index.ts";
import type { ExtensionUiRequest, ExtensionUiResponse } from "../protocol/extension-ui.ts";
import type { ThreadId } from "../protocol/identity.ts";
import type { WorkerEventEnvelope } from "../protocol/envelope.ts";

/** 等待中的 UI 请求。 */
interface PendingUiRequest<T> {
	resolve: (value: T) => void;
	reject: (error: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
}

/**
 * Extension UI 桥接，实现 ExtensionUIContext 并通过 transport 事件与 renderer 交互。
 */
export class ExtensionUiBridge {
	private readonly threadId: ThreadId;
	private readonly emit: (event: WorkerEventEnvelope) => void;
	private readonly pending = new Map<string, PendingUiRequest<unknown>>();

	/**
	 * 创建 ExtensionUiBridge 实例。
	 * @param threadId - 关联的 thread ID。
	 * @param emit - 发送事件 envelope 的函数。
	 */
	constructor(threadId: ThreadId, emit: (event: WorkerEventEnvelope) => void) {
		this.threadId = threadId;
		this.emit = emit;
	}

	/**
	 * 创建 Pi ExtensionUIContext 实例。
	 * @returns ExtensionUIContext 对象。
	 */
	createContext(): ExtensionUIContext {
		return {
			select: (title, options, opts) =>
				this.requestDialog<string | undefined>(
					{ type: "select", id: crypto.randomUUID(), title, options, timeoutMs: opts?.timeout },
					opts,
					(response) => ("cancelled" in response ? undefined : "value" in response ? response.value : undefined),
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
					(response) => ("cancelled" in response ? undefined : "value" in response ? response.value : undefined),
				),
			notify: (message, notifyType) => this.emitUi({ type: "notify", id: crypto.randomUUID(), message, notifyType }),
			setStatus: (statusKey, statusText) =>
				this.emitUi({ type: "setStatus", id: crypto.randomUUID(), statusKey, statusText }),
			setWorkingMessage: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: (widgetKey, widgetLines, options) => {
				if (widgetLines !== undefined && !Array.isArray(widgetLines)) {
					throw new Error("desktop extension UI setWidget only accepts string arrays");
				}
				this.emitUi({
					type: "setWidget",
					id: crypto.randomUUID(),
					widgetKey,
					widgetLines,
					widgetPlacement: options?.placement,
				});
			},
			setTitle: (title) => this.emitUi({ type: "setTitle", id: crypto.randomUUID(), title }),
			pasteToEditor: (text) => this.emitUi({ type: "setEditorText", id: crypto.randomUUID(), text }),
			setEditorText: (text) => this.emitUi({ type: "setEditorText", id: crypto.randomUUID(), text }),
			getEditorText: () => "",
			editor: (title, prefill) =>
				this.requestDialog<string | undefined>(
					{ type: "editor", id: crypto.randomUUID(), title, prefill },
					undefined,
					(response) => ("cancelled" in response ? undefined : "value" in response ? response.value : undefined),
				),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
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
		this.emit({
			kind: "event",
			eventType: "projection",
			threadId: this.threadId,
			event: { type: "extensionUi.requested", threadId: this.threadId, request },
		});
	}
}
