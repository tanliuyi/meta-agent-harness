import { MAX_TASK_COUNT, MAX_TASK_STATE_BYTES, TODO_STATE_ENTRY_TYPE, type TaskDetails } from "../tool/types";
import { EMPTY_STATE, type TaskState } from "./state";

/**
 * Discriminator for `details` envelopes that match the persisted `TaskDetails`
 * shape. Defensive — branch entries from older or corrupt sessions are
 * skipped silently.
 */
export function isTaskDetails(value: unknown): value is TaskDetails {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (!Array.isArray(v.tasks) || v.tasks.length > MAX_TASK_COUNT || typeof v.nextId !== "number") return false;
	try {
		return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_TASK_STATE_BYTES;
	} catch {
		return false;
	}
}

/**
 * Walk the current branch in chronological order; the last valid run_code
 * persistence entry or historical direct `todo` tool result wins. When no
 * matching entry exists, returns `EMPTY_STATE`.
 *
 * Pure of module state — `index.ts` writes the returned snapshot into the
 * store after this returns. The function explicitly does NOT touch the store
 * cell.
 */
export function replayFromBranch(ctx: { sessionManager: { getBranch(): Iterable<unknown> } }): TaskState {
	let latest: TaskDetails | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		const e = entry as {
			type?: string;
			customType?: string;
			data?: unknown;
			message?: { role?: string; toolName?: string; details?: unknown };
		};
		const details =
			e.type === "custom" && e.customType === TODO_STATE_ENTRY_TYPE
				? e.data
				: e.type === "message" && e.message?.role === "toolResult" && e.message.toolName === "todo"
					? e.message.details
					: undefined;
		if (isTaskDetails(details)) latest = details;
	}
	return latest
		? { tasks: latest.tasks.map((task) => ({ ...task })), nextId: latest.nextId }
		: { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
}
