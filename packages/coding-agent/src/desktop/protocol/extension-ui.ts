/**
 * 本文件定义 extension UI request 在 desktop transport 中的结构。
 */

export type ExtensionUiRequest =
	| { type: "select"; id: string; title: string; options: string[]; timeoutMs?: number }
	| { type: "confirm"; id: string; title: string; message: string; timeoutMs?: number }
	| { type: "input"; id: string; title: string; placeholder?: string; timeoutMs?: number }
	| { type: "editor"; id: string; title: string; prefill?: string }
	| { type: "notify"; id: string; message: string; notifyType?: "info" | "warning" | "error" }
	| { type: "setStatus"; id: string; statusKey: string; statusText?: string }
	| { type: "setWidget"; id: string; widgetKey: string; widgetLines?: string[]; widgetPlacement?: "aboveEditor" | "belowEditor" }
	| { type: "setTitle"; id: string; title: string }
	| { type: "setEditorText"; id: string; text: string };

export type ExtensionUiResponse =
	| { id: string; value: string }
	| { id: string; confirmed: boolean }
	| { id: string; cancelled: true };

