import assert from "node:assert/strict";
import test from "node:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import rpivTodoDesktop from "../index";
import { __resetState } from "../state/store";

interface RegisteredTool {
	name: string;
	execute: (...args: unknown[]) => Promise<unknown>;
}

interface WidgetOptions {
	placement?: "aboveEditor" | "belowEditor";
	nativeContent?: {
		type: "todo";
		version: 1;
		summary: { total: number; completed: number; pending: number; inProgress: number };
		labels: {
			heading: string;
			more: string;
			statuses: { pending: string; inProgress: string; completed: string };
		};
		tasks: Array<{ id: number; subject: string; status: string }>; 
		hiddenTaskCount: number;
	};
}

test("registers the todo surface and renders a compact Desktop widget", async () => {
	__resetState();
	const tools: RegisteredTool[] = [];
	const commands = new Map<string, (args: string, ctx: ExtensionCommandContext) => Promise<void>>();
	const events = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
	let widgetContent: unknown;
	let widgetOptions: WidgetOptions | undefined;
	let widgetUpdates = 0;
	let notification = "";

	const pi = {
		getConfig: () => ({ maxWidgetLines: 4 }),
		registerTool: (tool: RegisteredTool) => tools.push(tool),
		registerCommand: (
			name: string,
			definition: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
		) => commands.set(name, definition.handler),
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => {
			events.set(event, handler);
		},
	} as unknown as ExtensionAPI;

	const ui = {
		setWidget: (_key: string, content: unknown, options?: WidgetOptions) => {
			widgetUpdates++;
			widgetContent = content;
			widgetOptions = options;
		},
		notify: (message: string) => {
			notification = message;
		},
	} as unknown as ExtensionUIContext;
	const ctx = {
		hasUI: true,
		ui,
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => [],
		},
	} as unknown as ExtensionContext;

	rpivTodoDesktop(pi);
	assert.deepEqual(tools.map((tool) => tool.name), ["todo"]);
	assert.deepEqual([...commands.keys()], ["todos"]);
	assert.deepEqual(
		[...events.keys()].sort(),
		[
			"agent_start",
			"session_compact",
			"session_shutdown",
			"session_start",
			"session_tree",
			"tool_execution_end",
		].sort(),
	);

	await events.get("session_start")?.({}, ctx);
	assert.equal(widgetContent, undefined);

	await tools[0]?.execute(
		"call-1",
		{ action: "create", subject: "Ship Desktop todo panel" },
		new AbortController().signal,
		undefined,
		ctx,
	);
	await events.get("tool_execution_end")?.({ toolName: "todo", isError: false }, ctx);
	assert.deepEqual(widgetContent, ["Todos (0/1)", "○ Ship Desktop todo panel"]);
	assert.equal(widgetOptions?.placement, "aboveEditor");
	assert.deepEqual(widgetOptions?.nativeContent, {
		type: "todo",
		version: 1,
		summary: { total: 1, completed: 0, pending: 1, inProgress: 0 },
		labels: {
			heading: "Todos",
			more: "more",
			statuses: { pending: "pending", inProgress: "in progress", completed: "completed" },
		},
		tasks: [{ id: 1, subject: "Ship Desktop todo panel", status: "pending" }],
		hiddenTaskCount: 0,
	});
	assert.equal(widgetUpdates, 1);
	await events.get("tool_execution_end")?.({ toolName: "todo", isError: false }, ctx);
	assert.equal(widgetUpdates, 1);

	await commands.get("todos")?.("", ctx as unknown as ExtensionCommandContext);
	assert.match(notification, /Ship Desktop todo panel/);

	await events.get("session_shutdown")?.({}, ctx);
	assert.equal(widgetContent, undefined);
});
