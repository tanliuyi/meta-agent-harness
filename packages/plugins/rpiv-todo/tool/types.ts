import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

// ---------------------------------------------------------------------------
// Tool / command identity — verbatim string boundaries.
// Desktop captures TOOL_NAME as the run_code catalog method. Replay also accepts
// historical direct-tool results with this name. DO NOT rename.
// ---------------------------------------------------------------------------

export const TOOL_NAME = "todo";
export const TOOL_LABEL = "Todo";
export const COMMAND_NAME = "todos";

// ---------------------------------------------------------------------------
// User-facing strings (kept stable for /todos UX parity).
// ---------------------------------------------------------------------------

export const ERR_REQUIRES_INTERACTIVE = "/todos requires interactive mode";
export const MSG_NO_TODOS = "No todos yet. Ask the agent to add some!";

// ---------------------------------------------------------------------------
// Public domain types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TaskStatus;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Persistence + replay snapshot. Every successful `todo` tool call returns this
 * shape under `details`; `state/replay.ts` reads the latest one from the branch
 * to reconstruct module state. Field order and field names are pinned by
 * cross-version replay compatibility.
 */
export interface TaskDetails {
	action: TaskAction;
	params: Record<string, unknown>;
	tasks: Task[];
	nextId: number;
	error?: string;
}

/**
 * Open-shape input bag the reducer accepts. Stays an interface so the index
 * signature (`[key: string]: unknown`) lets the runtime pass through TypeBox
 * `Static<typeof TodoParamsSchema>` without `as` casts.
 */
export const TODO_STATE_ENTRY_TYPE = "rpiv-todo-state";
export const MAX_TASK_COUNT = 10_000;
export const MAX_TASK_SUBJECT_LENGTH = 500;
export const MAX_TASK_DESCRIPTION_LENGTH = 4_000;
export const MAX_TASK_ACTIVE_FORM_LENGTH = 500;
export const MAX_TASK_OWNER_LENGTH = 200;
export const MAX_TASK_DEPENDENCIES = 40;
export const MAX_TASK_METADATA_PROPERTIES = 64;
export const MAX_TASK_STATE_BYTES = 1_000_000;

export interface TaskMutationParams {
	[key: string]: unknown;
	subject?: string;
	description?: string;
	activeForm?: string;
	status?: TaskStatus;
	blockedBy?: number[];
	addBlockedBy?: number[];
	removeBlockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
	id?: number;
	includeDeleted?: boolean;
}

// ---------------------------------------------------------------------------
// TypeBox parameter schema — every `description` doubles as LLM-facing prompt
// copy. Field order and wording are pinned by registration tests and the
// pre-refactor schema at `packages/rpiv-todo/todo.ts:512-573`.
// ---------------------------------------------------------------------------

export const TodoParamsSchema = Type.Object({
	action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
	subject: Type.Optional(
		Type.String({ maxLength: MAX_TASK_SUBJECT_LENGTH, description: "Task subject line (required for create)" }),
	),
	description: Type.Optional(
		Type.String({ maxLength: MAX_TASK_DESCRIPTION_LENGTH, description: "Long-form task description" }),
	),
	activeForm: Type.Optional(
		Type.String({
			maxLength: MAX_TASK_ACTIVE_FORM_LENGTH,
			description: "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
		}),
	),
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
			description:
				"Set this task's status (update): one of pending, in_progress, completed, deleted. When action is list, filters returned tasks by this status.",
		}),
	),
	blockedBy: Type.Optional(
		Type.Array(Type.Integer({ minimum: 1 }), {
			maxItems: MAX_TASK_DEPENDENCIES,
			uniqueItems: true,
			description: "Initial blockedBy ids (create only)",
		}),
	),
	addBlockedBy: Type.Optional(
		Type.Array(Type.Integer({ minimum: 1 }), {
			maxItems: MAX_TASK_DEPENDENCIES,
			uniqueItems: true,
			description: "Task ids to add to blockedBy (update only, additive merge)",
		}),
	),
	removeBlockedBy: Type.Optional(
		Type.Array(Type.Integer({ minimum: 1 }), {
			maxItems: MAX_TASK_DEPENDENCIES,
			uniqueItems: true,
			description: "Task ids to remove from blockedBy (update only, additive merge)",
		}),
	),
	owner: Type.Optional(
		Type.String({ maxLength: MAX_TASK_OWNER_LENGTH, description: "Agent/owner assigned to this task" }),
	),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			maxProperties: MAX_TASK_METADATA_PROPERTIES,
			description: "Arbitrary metadata; pass null value for a key to delete that key on update",
		}),
	),
	id: Type.Optional(
		Type.Integer({
			minimum: 1,
			description: "Task id (required for update, get, delete)",
		}),
	),
	includeDeleted: Type.Optional(
		Type.Boolean({
			description: "If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
		}),
	),
});

export type TodoParams = Static<typeof TodoParamsSchema>;
