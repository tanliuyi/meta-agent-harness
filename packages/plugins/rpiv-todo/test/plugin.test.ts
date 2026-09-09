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
	const persistedEntries: Array<{ customType: string; data: unknown }> = [];
	let widgetUpdates = 0;
	let throwWidgetError = false;
	let notification = "";

	const pi = {
		getConfig: () => ({ maxWidgetLines: 4 }),
		registerTool: (tool: RegisteredTool) => tools.push(tool),
		appendEntry: (customType: string, data: unknown) => persistedEntries.push({ customType, data }),
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
			if (throwWidgetError) throw new Error("disposed widget host");
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
	assert.equal(widgetOptions?.placement, "aboveEditor");
	const nativeContent = widgetOptions?.nativeContent;
	assert.equal(nativeContent?.type, "todo");
	assert.deepEqual(nativeContent?.summary, { total: 1, completed: 0, pending: 1, inProgress: 0 });
	assert.ok(nativeContent?.labels.heading);
	assert.ok(nativeContent?.labels.more);
	assert.ok(nativeContent?.labels.statuses.pending);
	assert.deepEqual(nativeContent?.tasks, [{ id: 1, subject: "Ship Desktop todo panel", status: "pending" }]);
	assert.equal(nativeContent?.hiddenTaskCount, 0);
	assert.deepEqual(widgetContent, [
		`${nativeContent?.labels.heading} (0/1)`,
		"○ Ship Desktop todo panel",
	]);
	assert.equal(widgetUpdates, 1);
	assert.equal(persistedEntries.length, 1);
	assert.equal(persistedEntries[0]?.customType, "rpiv-todo-state");

	await tools[0]?.execute(
		"call-2",
		{ action: "list" },
		new AbortController().signal,
		undefined,
		ctx,
	);
	assert.equal(widgetUpdates, 1);
	assert.equal(persistedEntries.length, 1);

	throwWidgetError = true;
	const presentationFailureResult = await tools[0]?.execute(
		"call-3",
		{ action: "create", subject: "Persist despite presentation failure" },
		new AbortController().signal,
		undefined,
		ctx,
	);
	assert.match(JSON.stringify(presentationFailureResult), /Persist despite presentation failure/);
	assert.equal(persistedEntries.length, 2);
	throwWidgetError = false;

	await commands.get("todos")?.("", ctx as unknown as ExtensionCommandContext);
	assert.match(notification, /Ship Desktop todo panel/);

	await events.get("session_shutdown")?.({}, ctx);
	assert.equal(widgetContent, undefined);
});

test("does not clear the replacement session when stale shutdown arrives late", async () => {
	__resetState();
	function createHarness(sessionId: string) {
		const tools: RegisteredTool[] = [];
		const events = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
		let stale = false;
		let widgetContent: unknown;
		const pi = {
			getConfig: () => ({}),
			registerTool: (tool: RegisteredTool) => tools.push(tool),
			registerCommand() {},
			appendEntry() {},
			on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => {
				events.set(event, handler);
			},
		} as unknown as ExtensionAPI;
		const ctx = {
			hasUI: true,
			ui: {
				setWidget: (_key: string, content: unknown) => {
					widgetContent = content;
				},
				notify() {},
			},
			sessionManager: {
				getSessionId: () => {
					if (stale) throw new Error("stale after session replacement");
					return sessionId;
				},
				getBranch: () => [],
			},
		} as unknown as ExtensionContext;
		rpivTodoDesktop(pi);
		return {
			tools,
			events,
			ctx,
			setStale: () => {
				stale = true;
			},
			widgetContent: () => widgetContent,
		};
	}

	const oldSession = createHarness("old-session");
	await oldSession.events.get("session_start")?.({}, oldSession.ctx);
	await oldSession.tools[0]?.execute(
		"old-call",
		{ action: "create", subject: "Old task" },
		new AbortController().signal,
		undefined,
		oldSession.ctx,
	);

	const replacement = createHarness("new-session");
	await replacement.events.get("session_start")?.({}, replacement.ctx);
	await replacement.tools[0]?.execute(
		"new-call",
		{ action: "create", subject: "Replacement task" },
		new AbortController().signal,
		undefined,
		replacement.ctx,
	);
	const replacementWidget = replacement.widgetContent();
	assert.ok(replacementWidget);

	oldSession.setStale();
	await oldSession.events.get("session_shutdown")?.({}, oldSession.ctx);
	assert.equal(replacement.widgetContent(), replacementWidget);

	await replacement.events.get("session_shutdown")?.({}, replacement.ctx);
});
