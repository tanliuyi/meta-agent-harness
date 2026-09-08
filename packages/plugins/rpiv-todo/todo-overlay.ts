import type { ExtensionUIContext, ExtensionWidgetOptions } from "@earendil-works/pi-coding-agent";
import { resolveMaxWidgetLines, type TodoConfig } from "./config";
import { formatStatusLabel, t } from "./state/i18n-bridge";
import { selectOverlayLayout, selectShowTaskIds, selectTodoCounts } from "./state/selectors";
import { getRenderState } from "./state/store";
import { sanitizeTerminalText } from "./tool/sanitize";
import type { Task, TaskStatus } from "./tool/types";

const WIDGET_KEY = "rpiv-todos";
const OVERLAY_HEADING = "Todos";
const OVERLAY_MORE = "more";

interface DesktopTodoWidgetContent {
	type: "todo";
	version: 1;
	summary: {
		total: number;
		completed: number;
		pending: number;
		inProgress: number;
	};
	labels: {
		heading: string;
		more: string;
		statuses: {
			pending: string;
			inProgress: string;
			completed: string;
		};
	};
	tasks: Array<{
		id: number;
		subject: string;
		status: Exclude<TaskStatus, "deleted">;
		activeForm?: string;
		blockedBy?: number[];
	}>;
	hiddenTaskCount: number;
}

interface DesktopTodoWidgetOptions extends ExtensionWidgetOptions {
	nativeContent: DesktopTodoWidgetContent;
}

export class TodoOverlay {
	private uiCtx: ExtensionUIContext | undefined;
	private widgetRegistered = false;
	private completedTaskIdsPendingHide = new Set<number>();
	private hiddenCompletedTaskIds = new Set<number>();
	private lastNextId: number | undefined;
	private lastWidgetSignature: string | undefined;
	private readonly getConfig: () => Readonly<TodoConfig>;

	constructor(getConfig: () => Readonly<TodoConfig>) {
		this.getConfig = getConfig;
	}

	setUICtx(ctx: ExtensionUIContext): void {
		if (ctx !== this.uiCtx) {
			this.uiCtx = ctx;
			this.widgetRegistered = false;
			this.lastWidgetSignature = undefined;
		}
	}

	update(): void {
		if (!this.uiCtx) return;
		const snapshot = this.getSnapshot();
		const visible = this.selectOverlayTasks(snapshot);
		if (visible.length === 0) {
			if (this.widgetRegistered) this.uiCtx.setWidget(WIDGET_KEY, undefined);
			this.widgetRegistered = false;
			this.lastWidgetSignature = undefined;
			return;
		}

		const overlayState = { tasks: visible, nextId: snapshot.nextId };
		const counts = selectTodoCounts(overlayState);
		const layout = selectOverlayLayout(overlayState, resolveMaxWidgetLines(this.getConfig()) - 1);
		const showIds = selectShowTaskIds(overlayState);
		const hiddenTaskCount = layout.hiddenCompleted + layout.truncatedTail;
		const nativeContent: DesktopTodoWidgetContent = {
			type: "todo",
			version: 1,
			summary: counts,
			labels: {
				heading: t("overlay.heading", OVERLAY_HEADING),
				more: t("overlay.more", OVERLAY_MORE),
				statuses: {
					pending: formatStatusLabel("pending"),
					inProgress: formatStatusLabel("in_progress"),
					completed: formatStatusLabel("completed"),
				},
			},
			tasks: layout.visible.map((task) => this.toNativeTask(task)),
			hiddenTaskCount,
		};
		const fallbackLines = this.renderFallbackLines(nativeContent, showIds);
		const signature = JSON.stringify([fallbackLines, nativeContent]);
		if (signature === this.lastWidgetSignature) return;
		const options: DesktopTodoWidgetOptions = { placement: "aboveEditor", nativeContent };
		this.uiCtx.setWidget(WIDGET_KEY, fallbackLines, options);
		this.widgetRegistered = true;
		this.lastWidgetSignature = signature;
		this.trackDisplayedCompletedTasks(visible);
	}

	resetCompletedDisplayState(): void {
		this.completedTaskIdsPendingHide.clear();
		this.hiddenCompletedTaskIds.clear();
		this.lastNextId = undefined;
	}

	hideCompletedTasksFromPreviousTurn(): void {
		if (this.completedTaskIdsPendingHide.size === 0) return;
		for (const taskId of this.completedTaskIdsPendingHide) this.hiddenCompletedTaskIds.add(taskId);
		this.completedTaskIdsPendingHide.clear();
		this.update();
	}

	isRegistered(): boolean {
		return this.widgetRegistered;
	}

	private getSnapshot() {
		const state = getRenderState();
		if (this.lastNextId !== undefined && state.nextId < this.lastNextId) this.resetCompletedDisplayState();
		this.lastNextId = state.nextId;
		const completedTaskIds = new Set(
			state.tasks.filter((task) => task.status === "completed").map((task) => task.id),
		);
		for (const taskId of this.completedTaskIdsPendingHide) {
			if (!completedTaskIds.has(taskId)) this.completedTaskIdsPendingHide.delete(taskId);
		}
		for (const taskId of this.hiddenCompletedTaskIds) {
			if (!completedTaskIds.has(taskId)) this.hiddenCompletedTaskIds.delete(taskId);
		}
		return { tasks: [...state.tasks], nextId: state.nextId };
	}

	private selectOverlayTasks(snapshot: ReturnType<TodoOverlay["getSnapshot"]>): Task[] {
		return snapshot.tasks.filter(
			(task) => task.status !== "deleted" && !(task.status === "completed" && this.hiddenCompletedTaskIds.has(task.id)),
		);
	}

	private toNativeTask(task: Task): DesktopTodoWidgetContent["tasks"][number] {
		if (task.status === "deleted") throw new Error("Deleted tasks cannot be rendered in the todo widget");
		return {
			id: task.id,
			subject: sanitizeTerminalText(task.subject),
			status: task.status,
			...(task.activeForm ? { activeForm: sanitizeTerminalText(task.activeForm) } : {}),
			...(task.blockedBy?.length ? { blockedBy: [...task.blockedBy] } : {}),
		};
	}

	private renderFallbackLines(content: DesktopTodoWidgetContent, showIds: boolean): string[] {
		const lines = [`${content.labels.heading} (${content.summary.completed}/${content.summary.total})`];
		for (const task of content.tasks) {
			const glyph = task.status === "completed" ? "✓" : task.status === "in_progress" ? "◐" : "○";
			const id = showIds ? ` #${task.id}` : "";
			const activeForm = task.status === "in_progress" && task.activeForm ? ` (${task.activeForm})` : "";
			const blockedBy = task.blockedBy?.length ? ` ⛓ ${task.blockedBy.map((value) => `#${value}`).join(",")}` : "";
			lines.push(`${glyph}${id} ${task.subject}${activeForm}${blockedBy}`);
		}
		if (content.hiddenTaskCount > 0) lines.push(`+${content.hiddenTaskCount} ${content.labels.more}`);
		return lines;
	}

	private trackDisplayedCompletedTasks(tasks: readonly Task[]): void {
		for (const task of tasks) {
			if (
				task.status === "completed" &&
				!this.completedTaskIdsPendingHide.has(task.id) &&
				!this.hiddenCompletedTaskIds.has(task.id)
			) {
				this.completedTaskIdsPendingHide.add(task.id);
			}
		}
	}

	dispose(): void {
		if (this.uiCtx) this.uiCtx.setWidget(WIDGET_KEY, undefined);
		this.widgetRegistered = false;
		this.lastWidgetSignature = undefined;
		this.uiCtx = undefined;
		this.resetCompletedDisplayState();
	}
}
