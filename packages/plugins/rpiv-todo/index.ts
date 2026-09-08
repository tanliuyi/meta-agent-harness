/**
 * Desktop adaptation of @juicesharp/rpiv-todo.
 *
 * The standard `todo` tool persists its full state in tool-result details, so
 * session reload and compaction can replay the latest snapshot. Meta Agent
 * Desktop renders the list through the standard read-only `setWidget` surface.
 */

import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { registerLocalesFromDir } from "@juicesharp/rpiv-i18n/loader";
import type { TodoConfig } from "./config";
import { I18N_NAMESPACE } from "./state/i18n-bridge";
import { replayFromBranch } from "./state/replay";
import {
	clearActiveRenderSession,
	evictSession,
	getActiveRenderSession,
	getRenderState,
	replaceState,
	setActiveRenderSession,
	sid,
} from "./state/store";
import { registerTodosCommand, registerTodoTool, TOOL_NAME } from "./todo";
import { TodoOverlay } from "./todo-overlay";

interface DesktopExtensionAPI extends ExtensionAPI {
	getConfig<T = TodoConfig>(): Readonly<T>;
}

registerLocalesFromDir(I18N_NAMESPACE, import.meta.url, { label: "rpiv-todo" });

function readConfig(pi: ExtensionAPI): Readonly<TodoConfig> {
	const desktopApi = pi as Partial<DesktopExtensionAPI>;
	return typeof desktopApi.getConfig === "function" ? desktopApi.getConfig<TodoConfig>() : {};
}

function isStaleCtxError(error: unknown): boolean {
	return /stale after session replacement/.test(String(error));
}

export default function rpivTodoDesktop(pi: ExtensionAPI): void {
	let todoOverlay: TodoOverlay | undefined;
	let uiCtx: ExtensionUIContext | undefined;
	let lifecycleGeneration = 0;
	const getConfig = (): Readonly<TodoConfig> => readConfig(pi);

	async function updateTodoOverlay(
		resetCompletedDisplayState = false,
		generation = lifecycleGeneration,
	): Promise<void> {
		const hasVisibleTasks = getRenderState().tasks.some((task) => task.status !== "deleted");
		if (!uiCtx || (!todoOverlay && !hasVisibleTasks)) return;
		if (generation !== lifecycleGeneration || !uiCtx) return;

		todoOverlay ??= new TodoOverlay(getConfig);
		todoOverlay.setUICtx(uiCtx);
		if (resetCompletedDisplayState) todoOverlay.resetCompletedDisplayState();
		todoOverlay.update();
	}

	registerTodoTool(pi, getConfig());
	registerTodosCommand(pi);

	const replayAndRefresh = async (
		ctx: Parameters<typeof sid>[0] & Parameters<typeof replayFromBranch>[0],
	): Promise<void> => {
		let isForeground = false;
		try {
			const id = sid(ctx);
			replaceState(id, replayFromBranch(ctx));
			isForeground = id === getActiveRenderSession();
		} catch (error) {
			if (!isStaleCtxError(error)) throw error;
		}
		if (isForeground) await updateTodoOverlay(true);
	};

	pi.on("session_start", async (_event, ctx) => {
		let id: string;
		try {
			id = sid(ctx);
			replaceState(id, replayFromBranch(ctx));
		} catch (error) {
			if (!isStaleCtxError(error)) throw error;
			return;
		}
		if (!ctx.hasUI) return;
		if (getActiveRenderSession() === "") setActiveRenderSession(id);
		if (id !== getActiveRenderSession()) return;
		const generation = ++lifecycleGeneration;
		uiCtx = ctx.ui;
		await updateTodoOverlay(true, generation);
	});

	pi.on("session_compact", async (_event, ctx) => replayAndRefresh(ctx));
	pi.on("session_tree", async (_event, ctx) => replayAndRefresh(ctx));

	pi.on("session_shutdown", async (_event, ctx) => {
		let sessionId: string;
		try {
			sessionId = sid(ctx);
		} catch (error) {
			if (!isStaleCtxError(error)) throw error;
			sessionId = "";
		}
		evictSession(sessionId);
		if (sessionId === "" || sessionId === getActiveRenderSession()) {
			lifecycleGeneration++;
			uiCtx = undefined;
			try {
				todoOverlay?.dispose();
			} finally {
				todoOverlay = undefined;
				clearActiveRenderSession();
			}
		}
	});

	pi.on("tool_execution_end", async (event) => {
		if (event.toolName !== TOOL_NAME || event.isError) return;
		await updateTodoOverlay();
	});

	pi.on("agent_start", async () => {
		todoOverlay?.hideCompletedTasksFromPreviousTurn();
	});
}
