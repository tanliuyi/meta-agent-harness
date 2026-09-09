import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type EditorComponent, isKeyRelease, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { snapshotExternalRuns } from "../api/external-runs.ts";
import { formatModelThinking } from "../shared/formatters.ts";
import type { AsyncJobState, AsyncJobStep, FleetViewPlacement, HerdrProjectPaneSnapshot, HostStepState, HostStepVerdict, NestedRunSummary, NestedStepSummary, SubagentState } from "../shared/types.ts";
import { projectAsyncWorkflowRows, type AsyncStatusWorkflowRow } from "../runs/shared/async-status-projection.ts";
import { contextModeLabel } from "../runs/shared/context-mode.ts";
import { formatWorkflowJsonPreview } from "../workflows/scripted-workflow.ts";
import { hostStepReportName, hostStepVerdictLabel } from "../runs/shared/host-step-status.ts";
import { isStaleExtensionContextError } from "../shared/extension-context.ts";
import { formatWorkflowChecklistBottleneck, formatWorkflowChecklistPhase, formatWorkflowChecklistSummary, projectWorkflowChecklist, type WorkflowChecklistPhase, type WorkflowChecklistProjection } from "../workflows/workflow-checklist.ts";
import { previewDisplayText } from "../shared/display-text.ts";
import {
	DESKTOP_SUBAGENT_CHILD_LIMIT,
	DESKTOP_SUBAGENT_DEPTH_LIMIT,
	DESKTOP_SUBAGENT_NODE_LIMIT,
	type DesktopSubagentNode,
	type DesktopSubagentWidgetContent,
	type DesktopSubagentWidgetOptions,
	supportsDesktopNativeWidgets,
} from "./desktop-native-status.ts";

export const FLEET_STATUS_WIDGET_KEY = "subagent-fleet-status";

// Six rows fit the accepted collapsed hierarchy: one owner, four visible descendants, and overflow.
const MAX_AGENT_ROWS = 6;
const REFRESH_MS = 500;

type Theme = ExtensionContext["ui"]["theme"];
type FleetStatusTui = {
	requestRender(): void;
};
export type FleetStatusEntry = {
	key: string;
	surface?: "project-pane";
	parentKey?: string;
	workflowWrapper?: boolean;
	runId?: string;
	agent: string;
	modelThinking?: string;
	description?: string;
	activity?: string;
	startedAt: number;
	updatedAt?: number;
	tokens: number;
	window?: number;
	toolCount?: number;
	turnCount?: number;
	state: string;
	external?: true;
	projectPane?: HerdrProjectPaneSnapshot;
	nestedChildren?: NestedRunSummary[];
	workflowRows?: AsyncStatusWorkflowRow[];
	workflowChecklist?: WorkflowChecklistProjection;
};

type FleetNestedRow = {
	name: string;
	state: NestedRunSummary["state"] | NestedStepSummary["status"];
	modelThinking?: string;
	activity?: string;
	startedAt?: number;
	depth: number;
	overflow?: number;
};

type FleetTreeRow =
	| { kind: "owner"; entry: FleetStatusEntry }
	| { kind: "child"; entry: FleetStatusEntry; last: boolean }
	| { kind: "workflow-phase"; ownerKey: string; phase: WorkflowChecklistPhase; last: boolean }
	| { kind: "workflow"; ownerKey: string; row: AsyncStatusWorkflowRow; last: boolean }
	| { kind: "nested"; ownerKey: string; row: FleetNestedRow; last: boolean };

export interface FleetStatusOptions {
	refreshMs?: number;
	maxAgentRows?: number;
	placement?: FleetViewPlacement;
}

export function resolveFleetViewPlacement(value: unknown): FleetViewPlacement {
	return value === "aboveEditor" ? "aboveEditor" : "belowEditor";
}

export function formatFleetElapsed(ms: number): string {
	return `${Math.max(0, Math.round(ms / 1000))}s`;
}

export function formatFleetTokens(count: number, window?: number): string {
	const compact = (value: number): string => value >= 1_000_000
		? `${(value / 1_000_000).toFixed(1)}M`
		: value >= 1_000
			? `${(value / 1_000).toFixed(1)}k`
			: `${Math.max(0, Math.round(value))}`;
	return window !== undefined
		? `↓ ${compact(window)} window · ${compact(count)} spent`
		: `↓ ${compact(count)} tokens`;
}

function rightAlign(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	const maxLeftWidth = Math.max(0, width - rightWidth - 1);
	const leftClamped = truncateToWidth(left, maxLeftWidth);
	const gap = Math.max(1, width - visibleWidth(leftClamped) - rightWidth);
	return truncateToWidth(`${leftClamped}${" ".repeat(gap)}${right}`, width);
}

function isActiveState(value: string): boolean {
	return value === "running" || value === "queued" || value === "pending";
}

function nestedRunLabel(run: NestedRunSummary): string {
	if (run.agent) return run.agent;
	if (run.agents?.length) return run.agents.length === 1 ? run.agents[0]! : `${run.agents.slice(0, 2).join(", ")}${run.agents.length > 2 ? ` +${run.agents.length - 2}` : ""}`;
	return run.id;
}

function nestedActivity(node: {
	currentTool?: string;
	currentPath?: string;
	activityState?: string;
}): string | undefined {
	if (node.currentTool) return `tool ${node.currentTool}`;
	if (node.currentPath) return node.currentPath.split(/[\\/]/).at(-1);
	if (node.activityState === "needs_attention") return "needs attention";
	if (node.activityState === "active_long_running") return "long-running";
	return undefined;
}

function visibleWorkflowRows(rows: AsyncStatusWorkflowRow[] | undefined, visibleLimit: number): AsyncStatusWorkflowRow[] {
	if (!rows?.length) return [];
	if (rows.length <= visibleLimit) return rows;
	const selected = new Set<number>();
	for (const [index, row] of rows.entries()) {
		if (!isWorkflowRowTerminal(row)) selected.add(index);
		if (selected.size >= visibleLimit) break;
	}
	for (let index = rows.length - 1; index >= 0 && selected.size < visibleLimit; index--) selected.add(index);
	const visible = [...selected].sort((left, right) => left - right).map((index) => rows[index]!);
	return [{ name: `… +${rows.length - visible.length} hidden workflow steps`, state: "complete", overflow: rows.length - visible.length }, ...visible];
}

function visibleWorkflowPhases(checklist: WorkflowChecklistProjection | undefined, visibleLimit: number): WorkflowChecklistPhase[] {
	const phases = checklist?.phases ?? [];
	if (phases.length <= visibleLimit) return phases;
	const selected = new Set<number>();
	for (const [index, phase] of phases.entries()) {
		if (phase.state !== "complete") selected.add(index);
		if (selected.size >= visibleLimit) break;
	}
	for (let index = phases.length - 1; index >= 0 && selected.size < visibleLimit; index--) selected.add(index);
	return [...selected].sort((left, right) => left - right).map((index) => phases[index]!);
}

function isWorkflowRowTerminal(row: AsyncStatusWorkflowRow): boolean {
	if (row.kind) return row.state === "done" || row.state === "cancelled" || row.state === "error";
	return row.state === "complete"
		|| row.state === "completed"
		|| row.state === "failed"
		|| row.state === "partial"
		|| row.state === "paused"
		|| row.state === "stopped"
		|| row.state === "rejected";
}

function nestedStatusGlyph(state: FleetNestedRow["state"] | "planned", theme: Theme): string {
	if (state === "running") return theme.fg("accent", "●");
	if (state === "queued" || state === "pending" || state === "planned") return theme.fg("muted", "◦");
	if (state === "complete" || state === "completed") return theme.fg("success", "✓");
	if (state === "failed" || state === "rejected") return theme.fg("error", "✗");
	return theme.fg("warning", "■");
}

function nestedStepDisplayCount(steps: NestedStepSummary[] | undefined, start = 0): number {
	let count = 0;
	for (let index = start; index < (steps?.length ?? 0); index++) {
		count += 1 + nestedDisplayCount(steps![index]!.children);
	}
	return count;
}

function nestedDisplayCount(children: NestedRunSummary[] | undefined, start = 0): number {
	let count = 0;
	for (let index = start; index < (children?.length ?? 0); index++) {
		const child = children![index]!;
		const steps = (child.mode === "parallel" || child.mode === "chain") ? child.steps ?? [] : [];
		count += steps.length > 0 ? nestedStepDisplayCount(steps) : 1;
		count += nestedDisplayCount(child.children);
	}
	return count;
}

function nestedFleetRows(children: NestedRunSummary[] | undefined, visibleLimit: number): FleetNestedRow[] {
	const rows: FleetNestedRow[] = [];
	let omitted = 0;
	const appendRuns = (runs: NestedRunSummary[] | undefined, depth: number): boolean => {
		for (let runIndex = 0; runIndex < (runs?.length ?? 0); runIndex++) {
			const child = runs![runIndex]!;
			const steps = (child.mode === "parallel" || child.mode === "chain") ? child.steps ?? [] : [];
			if (steps.length > 0) {
				for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
					if (rows.length >= visibleLimit) {
						omitted += nestedStepDisplayCount(steps, stepIndex);
						omitted += nestedDisplayCount(child.children);
						omitted += nestedDisplayCount(runs, runIndex + 1);
						return false;
					}
					const step = steps[stepIndex]!;
					const modelThinking = formatModelThinking(step.model, step.thinking) || undefined;
					const activity = nestedActivity(step);
					rows.push({
						name: step.agent,
						state: step.status,
						depth,
						...(modelThinking ? { modelThinking } : {}),
						...(activity ? { activity } : {}),
						...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
					});
					if (!appendRuns(step.children, depth + 1)) {
						omitted += nestedStepDisplayCount(steps, stepIndex + 1);
						omitted += nestedDisplayCount(child.children);
						omitted += nestedDisplayCount(runs, runIndex + 1);
						return false;
					}
				}
			} else {
				if (rows.length >= visibleLimit) {
					omitted += nestedDisplayCount(runs, runIndex);
					return false;
				}
				const modelThinking = formatModelThinking(child.model, child.thinking) || undefined;
				const activity = nestedActivity(child);
				rows.push({
					name: nestedRunLabel(child),
					state: child.state,
					depth,
					...(modelThinking ? { modelThinking } : {}),
					...(activity ? { activity } : {}),
					...(child.startedAt !== undefined ? { startedAt: child.startedAt } : {}),
				});
			}
			if (!appendRuns(child.children, depth + 1)) {
				omitted += nestedDisplayCount(runs, runIndex + 1);
				return false;
			}
		}
		return true;
	};
	appendRuns(children, 0);
	if (omitted > 0) rows.push({ name: `… +${omitted} more nested leaves`, state: "complete", depth: 0, overflow: omitted });
	return rows;
}

function fleetTreeRows(entries: FleetStatusEntry[]): FleetTreeRow[] {
	const rows: FleetTreeRow[] = [];
	const entryKeys = new Set(entries.map((entry) => entry.key));
	const childrenByParent = new Map<string, FleetStatusEntry[]>();
	for (const entry of entries) {
		if (!entry.parentKey || !entryKeys.has(entry.parentKey)) continue;
		const children = childrenByParent.get(entry.parentKey) ?? [];
		children.push(entry);
		childrenByParent.set(entry.parentKey, children);
	}
	for (const entry of entries) {
		if (entry.parentKey && entryKeys.has(entry.parentKey)) continue;
		rows.push({ kind: "owner", entry });
		const attached = childrenByParent.get(entry.key) ?? [];
		const workflowPhases = visibleWorkflowPhases(entry.workflowChecklist, attached.length > 0 ? 2 : 4);
		const workflowRows = visibleWorkflowRows(entry.workflowRows, attached.length > 0 ? 2 : 4);
		for (const [index, child] of attached.entries()) {
			const nested = nestedFleetRows(child.nestedChildren, 3);
			const laterRows = index < attached.length - 1 || workflowPhases.length > 0 || workflowRows.length > 0 || Boolean(entry.nestedChildren?.length);
			rows.push({ kind: "child", entry: child, last: !laterRows && nested.length === 0 });
			for (const [nestedIndex, row] of nested.entries()) rows.push({
				kind: "nested",
				ownerKey: child.key,
				row: { ...row, depth: row.depth + 1 },
				last: nestedIndex === nested.length - 1 && !laterRows,
			});
		}
		for (const [index, phase] of workflowPhases.entries()) rows.push({
			kind: "workflow-phase",
			ownerKey: entry.key,
			phase,
			last: index === workflowPhases.length - 1 && workflowRows.length === 0 && !entry.nestedChildren?.length,
		});
		for (const [index, row] of workflowRows.entries()) rows.push({ kind: "workflow", ownerKey: entry.key, row, last: index === workflowRows.length - 1 && !entry.nestedChildren?.length });
		const nested = nestedFleetRows(entry.nestedChildren, attached.length > 0 ? 3 : 4);
		for (const [index, row] of nested.entries()) rows.push({ kind: "nested", ownerKey: entry.key, row, last: index === nested.length - 1 });
	}
	return rows;
}

function foregroundDescription(control: { parentWorkflowRunId?: string; workflowKey?: string }, description: string | undefined): string | undefined {
	if (!control.parentWorkflowRunId) return description;
	const workflow = `workflow child: ${control.parentWorkflowRunId}${control.workflowKey ? ` (${control.workflowKey})` : ""}`;
	return description ? `${workflow} · ${description}` : workflow;
}

function workflowIdentityCandidates(step: Pick<AsyncJobStep, "workflowKey" | "runId">): string[] {
	return [...new Set([step.workflowKey, step.runId].filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function asyncJobIdentityCandidates(job: AsyncJobState): string[] {
	return [...new Set([job.workflowKey, job.asyncId].filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function linkedWorkflowParentKey(parentWorkflowRunId: string | undefined, activeWorkflowKeys: ReadonlySet<string>): string | undefined {
	if (!parentWorkflowRunId) return undefined;
	const parentKey = `async:${parentWorkflowRunId}`;
	return activeWorkflowKeys.has(parentKey) ? parentKey : undefined;
}

function workflowStepsWithoutMaterializedChildren(steps: AsyncJobStep[] | undefined, materializedChildIds: ReadonlySet<string> | undefined): AsyncJobStep[] | undefined {
	if (!steps?.length || !materializedChildIds?.size) return steps;
	return steps.filter((step) => !workflowIdentityCandidates(step).some((identity) => materializedChildIds.has(identity)));
}

function activeLeafAgentCount(entries: FleetStatusEntry[]): number {
	return entries.filter((entry) => !entry.workflowWrapper && !entry.surface).length;
}

interface NativeProjectionBudget {
	remaining: number;
	omitted: number;
}

function nativeText(value: string): string {
	return previewDisplayText(value, 160);
}

function nativeUsageTotal(entries: FleetStatusEntry[]): number {
	let total = 0;
	for (const entry of entries) total = Math.min(Number.MAX_SAFE_INTEGER, total + Math.max(0, entry.tokens));
	return total;
}

function nativeNestedNodeCount(children: NestedRunSummary[] | undefined): number {
	let count = 0;
	for (const child of children ?? []) {
		count += 1;
		for (const step of child.steps ?? []) count += 1 + nativeNestedNodeCount(step.children);
		count += nativeNestedNodeCount(child.children);
	}
	return count;
}

function nativeNestedNodes(
	children: NestedRunSummary[] | undefined,
	depth: number,
	budget: NativeProjectionBudget,
	childLimit = DESKTOP_SUBAGENT_CHILD_LIMIT,
): DesktopSubagentNode[] {
	if (!children?.length) return [];
	if (depth > DESKTOP_SUBAGENT_DEPTH_LIMIT) {
		budget.omitted += nativeNestedNodeCount(children);
		return [];
	}
	const nodes: DesktopSubagentNode[] = [];
	for (const [index, child] of children.entries()) {
		if (nodes.length >= childLimit || budget.remaining <= 0) {
			budget.omitted += nativeNestedNodeCount(children.slice(index));
			break;
		}
		budget.remaining--;
		const modelThinking = formatModelThinking(child.model, child.thinking) || undefined;
		const childNodes: DesktopSubagentNode[] = [];
		if (depth >= DESKTOP_SUBAGENT_DEPTH_LIMIT) {
			budget.omitted += (child.steps?.length ?? 0)
				+ (child.steps?.reduce((count, step) => count + nativeNestedNodeCount(step.children), 0) ?? 0)
				+ nativeNestedNodeCount(child.children);
		} else for (const [stepIndex, step] of (child.steps ?? []).entries()) {
			if (childNodes.length >= childLimit || budget.remaining <= 0) {
				budget.omitted += (child.steps?.length ?? 0) - stepIndex
					+ (child.steps?.slice(stepIndex).reduce((count, remaining) => count + nativeNestedNodeCount(remaining.children), 0) ?? 0);
				break;
			}
			budget.remaining--;
			const stepModelThinking = formatModelThinking(step.model, step.thinking) || undefined;
			const stepTokens = "tokens" in step
				? step.tokens as { total?: number; window?: number } | undefined
				: undefined;
			const nested = nativeNestedNodes(step.children, depth + 2, budget);
			childNodes.push({
				id: nativeText(`${child.id}:step:${stepIndex}`),
				kind: "step",
				label: nativeText(step.sessionName?.trim() || step.agent),
				state: step.status,
				...(stepModelThinking ? { modelThinking: nativeText(stepModelThinking) } : {}),
				...(nestedActivity(step) ? { activity: nativeText(nestedActivity(step)!) } : {}),
				...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
				...(step.endedAt !== undefined ? { updatedAt: step.endedAt } : step.lastActivityAt !== undefined ? { updatedAt: step.lastActivityAt } : {}),
				...(!isActiveState(step.status) && step.endedAt !== undefined ? { endedAt: step.endedAt } : {}),
				...(stepTokens?.total !== undefined ? { tokens: stepTokens.total } : {}),
				...(stepTokens?.window !== undefined ? { window: stepTokens.window } : {}),
				...(step.toolCount !== undefined ? { toolCount: step.toolCount } : {}),
				...(step.turnCount !== undefined ? { turnCount: step.turnCount } : {}),
				...(nested.length ? { children: nested } : {}),
			});
		}
		const remainingChildSlots = Math.max(0, childLimit - childNodes.length);
		const directChildren = depth >= DESKTOP_SUBAGENT_DEPTH_LIMIT
			? []
			: nativeNestedNodes(child.children, depth + 1, budget, remainingChildSlots);
		const nested = [...childNodes, ...directChildren];
		nodes.push({
			id: nativeText(child.id),
			kind: child.mode === "workflow" ? "workflow" : "subagent",
			label: nativeText(nestedRunLabel(child)),
			state: child.state,
			...(modelThinking ? { modelThinking: nativeText(modelThinking) } : {}),
			...(nestedActivity(child) ? { activity: nativeText(nestedActivity(child)!) } : {}),
			...(child.startedAt !== undefined ? { startedAt: child.startedAt } : {}),
			...(child.lastUpdate !== undefined ? { updatedAt: child.lastUpdate } : {}),
			...(!isActiveState(child.state) && child.endedAt !== undefined ? { endedAt: child.endedAt } : {}),
			...(child.totalTokens?.total !== undefined ? { tokens: child.totalTokens.total } : {}),
			...(child.totalTokens?.window !== undefined ? { window: child.totalTokens.window } : {}),
			...(child.toolCount !== undefined ? { toolCount: child.toolCount } : {}),
			...(child.turnCount !== undefined ? { turnCount: child.turnCount } : {}),
			...(nested.length ? { children: nested } : {}),
		});
	}
	return nodes;
}

function nativeWorkflowNodes(
	rows: AsyncStatusWorkflowRow[] | undefined,
	budget: NativeProjectionBudget,
	childLimit = DESKTOP_SUBAGENT_CHILD_LIMIT,
): DesktopSubagentNode[] {
	const rowList = rows ?? [];
	const available = Math.max(0, Math.min(childLimit, budget.remaining));
	if (available === 0) {
		budget.omitted += rowList.length;
		return [];
	}
	const selected = new Set<number>();
	for (const [index, row] of rowList.entries()) {
		if (!isWorkflowRowTerminal(row) || row.activity === "needs attention" || row.activity === "needs_attention") {
			selected.add(index);
		}
		if (selected.size >= available) break;
	}
	for (let index = 0; index < rowList.length && selected.size < available; index++) selected.add(index);
	const selectedRows = [...selected].sort((left, right) => left - right);
	budget.omitted += rowList.length - selectedRows.length;
	return selectedRows.map((index) => {
		const row = rowList[index]!;
		budget.remaining--;
		return {
			id: nativeText(`workflow-row:${index}:${row.name}`),
			kind: row.kind ? "host-step" : "step",
			label: nativeText(row.name),
			state: row.state,
			...(row.modelThinking ? { modelThinking: nativeText(row.modelThinking) } : {}),
			...(row.activity ? { activity: nativeText(row.activity) } : {}),
			...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
			...(isWorkflowRowTerminal(row) && row.endedAt !== undefined ? { endedAt: row.endedAt } : {}),
			...(row.tokens !== undefined ? { tokens: row.tokens } : {}),
			...(row.window !== undefined ? { window: row.window } : {}),
			...(row.verdict ? { verdict: row.verdict } : {}),
		};
	});
}

export function buildFleetDesktopStatus(
	entries: FleetStatusEntry[],
	capacity: SubagentState["activeAsyncCapacity"],
	generatedAt = Date.now(),
): DesktopSubagentWidgetContent {
	const budget: NativeProjectionBudget = { remaining: DESKTOP_SUBAGENT_NODE_LIMIT, omitted: 0 };
	const entriesByParent = new Map<string, FleetStatusEntry[]>();
	for (const entry of entries) {
		if (!entry.parentKey) continue;
		const children = entriesByParent.get(entry.parentKey) ?? [];
		children.push(entry);
		entriesByParent.set(entry.parentKey, children);
	}
	const countEntrySubtree = (entry: FleetStatusEntry, ancestors = new Set<string>()): number => {
		if (ancestors.has(entry.key)) return 0;
		const nextAncestors = new Set(ancestors).add(entry.key);
		return 1
			+ (entry.workflowRows?.length ?? 0)
			+ nativeNestedNodeCount(entry.nestedChildren)
			+ (entriesByParent.get(entry.key)?.reduce((count, child) => count + countEntrySubtree(child, nextAncestors), 0) ?? 0);
	};
	const appendEntry = (entry: FleetStatusEntry, depth: number, ancestors = new Set<string>()): DesktopSubagentNode | undefined => {
		if (budget.remaining <= 0 || ancestors.has(entry.key)) {
			budget.omitted += countEntrySubtree(entry, ancestors);
			return undefined;
		}
		budget.remaining--;
		const nextAncestors = new Set(ancestors).add(entry.key);
		const attached: DesktopSubagentNode[] = [];
		let workflowNodes: DesktopSubagentNode[] = [];
		let nestedNodes: DesktopSubagentNode[] = [];
		if (depth < DESKTOP_SUBAGENT_DEPTH_LIMIT) {
			let availableChildren = DESKTOP_SUBAGENT_CHILD_LIMIT;
			const childEntries = entriesByParent.get(entry.key) ?? [];
			for (const [index, child] of childEntries.entries()) {
				if (availableChildren <= 0) {
					budget.omitted += childEntries.slice(index).reduce((count, omitted) => count + countEntrySubtree(omitted, nextAncestors), 0);
					break;
				}
				const node = appendEntry(child, depth + 1, nextAncestors);
				if (node) {
					attached.push(node);
					availableChildren--;
				}
			}
			workflowNodes = nativeWorkflowNodes(entry.workflowRows, budget, availableChildren);
			availableChildren -= workflowNodes.length;
			nestedNodes = nativeNestedNodes(entry.nestedChildren, depth + 1, budget, availableChildren);
		} else {
			budget.omitted += (entriesByParent.get(entry.key)?.reduce((count, child) => count + countEntrySubtree(child, nextAncestors), 0) ?? 0)
				+ (entry.workflowRows?.length ?? 0)
				+ nativeNestedNodeCount(entry.nestedChildren);
		}
		const children = [...attached, ...workflowNodes, ...nestedNodes];
		return {
			id: nativeText(entry.key),
			kind: entry.surface === "project-pane" ? "project-pane" : entry.external ? "external" : entry.workflowWrapper ? "workflow" : "subagent",
			label: nativeText(entry.agent),
			state: nativeText(entry.state),
			...(entry.runId ? { runId: nativeText(entry.runId) } : {}),
			...(entry.modelThinking ? { modelThinking: nativeText(entry.modelThinking) } : {}),
			...(entry.description ? { description: nativeText(entry.description) } : {}),
			...(entry.activity ? { activity: nativeText(entry.activity) } : {}),
			...(entry.startedAt !== undefined ? { startedAt: entry.startedAt } : {}),
			...(entry.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {}),
			...(entry.tokens > 0 ? { tokens: entry.tokens } : {}),
			...(entry.window !== undefined ? { window: entry.window } : {}),
			...(entry.toolCount !== undefined ? { toolCount: entry.toolCount } : {}),
			...(entry.turnCount !== undefined ? { turnCount: entry.turnCount } : {}),
			...(children.length ? { children } : {}),
		};
	};
	const roots: DesktopSubagentNode[] = [];
	for (const [index, entry] of entries.entries()) {
		if (entry.parentKey) continue;
		if (roots.length >= 20 || budget.remaining <= 0) {
			budget.omitted += entries
				.slice(index)
				.filter((candidate) => !candidate.parentKey)
				.reduce((count, candidate) => count + countEntrySubtree(candidate), 0);
			break;
		}
		const node = appendEntry(entry, 0);
		if (node) roots.push(node);
	}
	const usageEntries = entries.filter((entry) => !entry.parentKey);
	return {
		type: "subagents",
		version: 1,
		source: "fleet",
		generatedAt,
		summary: {
			activeAgents: activeLeafAgentCount(entries.filter((entry) => !entry.surface)),
			asyncRunsUsed: capacity?.used ?? 0,
			asyncRunsLimit: capacity?.limit ?? 0,
			totalTokens: nativeUsageTotal(usageEntries),
		},
		nodes: roots,
		omittedNodeCount: budget.omitted,
	};
}

function projectPaneNeedsAttention(pane: HerdrProjectPaneSnapshot): boolean {
	return ["attention", "blocked", "paused", "failed", "error"].some((status) => pane.agentStatus.includes(status))
		|| pane.summary?.includes("⚠") === true;
}

function projectName(projectRoot: string): string {
	return projectRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? projectRoot;
}

function projectPaneEntries(state: SubagentState): FleetStatusEntry[] {
	return [...(state.herdrProjectPanes?.values() ?? [])]
		.filter((pane) => pane.state === "open")
		.sort((left, right) => left.openedAt.localeCompare(right.openedAt) || left.projectRoot.localeCompare(right.projectRoot))
		.map((pane) => ({
			key: `project-pane:${pane.projectRoot}`,
			surface: "project-pane" as const,
			agent: `${projectName(pane.projectRoot)} · ${pane.paneId}`,
			description: pane.summary,
			startedAt: Date.parse(pane.openedAt) || pane.refreshedAt,
			tokens: 0,
			state: pane.agentStatus || "unknown",
			projectPane: pane,
		}));
}

export function collectFleetStatusEntries(state: SubagentState): FleetStatusEntry[] {
	const entries: FleetStatusEntry[] = [];
	const activeWorkflowKeys = new Set([...state.asyncJobs.values()]
		.filter((job) => job.mode === "workflow" && isActiveState(job.status))
		.map((job) => `async:${job.asyncId}`));
	const materializedChildrenByWorkflow = new Map<string, Set<string>>();
	for (const job of state.asyncJobs.values()) {
		if (!isActiveState(job.status) || !job.parentWorkflowRunId) continue;
		const parentKey = linkedWorkflowParentKey(job.parentWorkflowRunId, activeWorkflowKeys);
		if (!parentKey) continue;
		const childIds = materializedChildrenByWorkflow.get(parentKey) ?? new Set<string>();
		for (const identity of asyncJobIdentityCandidates(job)) childIds.add(identity);
		materializedChildrenByWorkflow.set(parentKey, childIds);
	}
	for (const control of state.foregroundControls.values()) {
		const linkedParentKey = linkedWorkflowParentKey(control.parentWorkflowRunId, activeWorkflowKeys);
		if (control.activeChildren) {
			const nestedChildren = control.nestedChildren ?? [];
			const nestedChildrenByParentStep = new Map<number, NestedRunSummary[]>();
			for (const nested of nestedChildren) {
				if (nested.parentStepIndex === undefined) continue;
				const children = nestedChildrenByParentStep.get(nested.parentStepIndex) ?? [];
				children.push(nested);
				nestedChildrenByParentStep.set(nested.parentStepIndex, children);
			}
			for (const child of [...control.activeChildren.values()].sort((left, right) => left.index - right.index)) {
				const modelThinking = formatModelThinking(child.model, child.thinking) || undefined;
				const childNestedChildren = nestedChildrenByParentStep.get(child.index)
					?? (control.activeChildren.size === 1 && nestedChildren.length ? nestedChildren : undefined);
				entries.push({
					key: `foreground-active:${control.runId}:${child.index}`,
					runId: control.runId,
					...(linkedParentKey ? { parentKey: linkedParentKey } : {}),
					agent: child.agent,
					...(modelThinking ? { modelThinking } : {}),
					description: foregroundDescription(control, child.description),
					...(nestedActivity(child) ? { activity: nestedActivity(child) } : {}),
					startedAt: child.startedAt,
					updatedAt: child.lastActivityAt,
					tokens: child.tokens ?? 0,
					...(child.window !== undefined ? { window: child.window } : {}),
					...(child.toolCount !== undefined ? { toolCount: child.toolCount } : {}),
					...(child.turnCount !== undefined ? { turnCount: child.turnCount } : {}),
					state: "running",
					...(childNestedChildren?.length ? { nestedChildren: childNestedChildren } : {}),
				});
			}
			continue;
		}
		const modelThinking = formatModelThinking(control.model, control.thinking) || undefined;
		entries.push({
			key: `foreground-active:${control.runId}:${control.currentIndex ?? 0}`,
			runId: control.runId,
			...(linkedParentKey ? { parentKey: linkedParentKey } : {}),
			agent: control.currentAgent ?? control.mode,
			...(modelThinking ? { modelThinking } : {}),
			description: foregroundDescription(control, control.description),
			...(nestedActivity(control) ? { activity: nestedActivity(control) } : {}),
			startedAt: control.startedAt,
			updatedAt: control.lastActivityAt,
			tokens: control.tokens ?? 0,
			...(control.window !== undefined ? { window: control.window } : {}),
			...(control.toolCount !== undefined ? { toolCount: control.toolCount } : {}),
			...(control.turnCount !== undefined ? { turnCount: control.turnCount } : {}),
			state: "running",
			...(control.nestedChildren?.length ? { nestedChildren: control.nestedChildren } : {}),
		});
	}

	for (const job of state.asyncJobs.values()) {
		if (!isActiveState(job.status)) continue;
		const startedAt = job.startedAt ?? job.updatedAt ?? Date.now();
		const linkedParentKey = linkedWorkflowParentKey(job.parentWorkflowRunId, activeWorkflowKeys);
		if (job.mode === "workflow") {
			const latestEmit = job.workflow?.emits?.length ? formatWorkflowJsonPreview(job.workflow.emits.at(-1), 120) : undefined;
			const workflowSteps = workflowStepsWithoutMaterializedChildren(job.steps, materializedChildrenByWorkflow.get(`async:${job.asyncId}`));
			const workflowRows = projectAsyncWorkflowRows(workflowSteps, job.workflowGraph ?? job.hostSteps, job.preflight);
			const workflowChecklist = projectWorkflowChecklist({
				graph: job.workflowGraph,
				steps: job.steps,
				hostSteps: job.hostSteps,
				preflight: job.preflight,
				trace: job.workflow?.trace,
				now: job.updatedAt ?? Date.now(),
			});
			entries.push({
				key: `async:${job.asyncId}`,
				runId: job.asyncId,
				...(linkedParentKey ? { parentKey: linkedParentKey } : {}),
				workflowWrapper: true,
				agent: "workflow",
				description: latestEmit !== undefined ? `latest emit: ${latestEmit}` : job.description,
				...(job.currentTool ? { activity: `tool ${job.currentTool}` } : job.activityState ? { activity: job.activityState } : {}),
				startedAt,
				updatedAt: job.updatedAt,
				tokens: job.totalTokens?.total ?? 0,
				...(job.totalTokens?.window !== undefined ? { window: job.totalTokens.window } : {}),
				...(job.toolCount !== undefined ? { toolCount: job.toolCount } : {}),
				...(job.turnCount !== undefined ? { turnCount: job.turnCount } : {}),
				state: job.status,
				...(workflowRows.length ? { workflowRows } : {}),
				...(workflowChecklist.total ? { workflowChecklist } : {}),
				...(job.nestedChildren?.length ? { nestedChildren: job.nestedChildren } : {}),
			});
			continue;
		}
		const steps: AsyncJobStep[] | undefined = job.steps?.length
			? job.steps
			: job.agents?.map((agent, index) => {
				const pending = job.status === "queued"
					|| (job.mode === "chain" && !job.activeParallelGroup && index !== (job.currentStep ?? 0));
				return { agent, index, status: pending ? "pending" : "running" };
			});
		if (!steps?.length) {
			entries.push({
				key: `async:${job.asyncId}`,
				runId: job.asyncId,
				...(linkedParentKey ? { parentKey: linkedParentKey } : {}),
				agent: job.mode ?? "subagent",
				description: job.description,
				...(job.currentTool ? { activity: `tool ${job.currentTool}` } : job.activityState ? { activity: job.activityState } : {}),
				startedAt,
				updatedAt: job.updatedAt,
				tokens: job.totalTokens?.total ?? 0,
				...(job.totalTokens?.window !== undefined ? { window: job.totalTokens.window } : {}),
				...(job.toolCount !== undefined ? { toolCount: job.toolCount } : {}),
				...(job.turnCount !== undefined ? { turnCount: job.turnCount } : {}),
				state: job.status,
				...(job.nestedChildren?.length ? { nestedChildren: job.nestedChildren } : {}),
			});
			continue;
		}
		for (const [offset, step] of steps.entries()) {
			if (!isActiveState(step.status)) continue;
			const index = step.index ?? offset;
			if (step.status === "pending" && job.mode === "chain" && !job.activeParallelGroup && index !== (job.currentStep ?? 0)) continue;
			const modelThinking = formatModelThinking(step.model, step.thinking) || undefined;
			entries.push({
				key: `async:${job.asyncId}:${index}`,
				runId: job.asyncId,
				...(linkedParentKey ? { parentKey: linkedParentKey } : {}),
				agent: step.label ? `${step.label} (${step.agent})` : step.agent,
				...(modelThinking ? { modelThinking } : {}),
				description: step.description ?? job.description,
				...(nestedActivity(step) ? { activity: nestedActivity(step) } : {}),
				startedAt: step.startedAt ?? startedAt,
				updatedAt: step.lastActivityAt ?? job.updatedAt,
				tokens: step.tokens?.total ?? (steps.length === 1 ? job.totalTokens?.total ?? 0 : 0),
				...((step.tokens?.window ?? (steps.length === 1 ? job.totalTokens?.window : undefined)) !== undefined
					? { window: step.tokens?.window ?? job.totalTokens?.window }
					: {}),
				...(step.toolCount !== undefined ? { toolCount: step.toolCount } : {}),
				...(step.turnCount !== undefined ? { turnCount: step.turnCount } : {}),
				state: step.status,
				...((step.children?.length ?? 0) > 0
					? { nestedChildren: step.children }
					: job.nestedChildren?.filter((nested) => nested.parentStepIndex === index).length
						? { nestedChildren: job.nestedChildren.filter((nested) => nested.parentStepIndex === index) }
						: {}),
			});
		}
	}

	if (state.currentSessionId) {
		try {
			for (const run of snapshotExternalRuns(state.currentSessionId, { ignoreMalformed: true, onMalformedRecord: (message) => console.warn(`[pi-subagents] Removed ${message}`) })) {
				if (!isActiveState(run.state)) continue;
				entries.push({
					key: `external:${run.id}`,
					runId: run.id,
					agent: `external · ${run.label}`,
					description: run.currentAction ?? `source: ${run.source}`,
					startedAt: run.startedAt,
					tokens: 0,
					state: run.state,
					external: true,
				});
			}
		} catch (cause) {
			console.warn(`[pi-subagents] Failed to inspect external jobs: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
	}

	entries.push(...projectPaneEntries(state));
	return entries.sort((left, right) => left.startedAt - right.startedAt || left.key.localeCompare(right.key));
}

export class SubagentFleetStatus {
	private ctx: ExtensionContext | undefined;
	private ui: ExtensionContext["ui"] | undefined;
	private tui: FleetStatusTui | undefined;
	private inputUnsubscribe: (() => void) | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private widgetRegistered = false;
	private active = false;
	private selectedKey = "main";
	private inspectorOpen = false;
	private lastRenderKey = "";
	private entries: FleetStatusEntry[] = [];
	private readonly state: SubagentState;
	private readonly openInspector: (itemKey: string) => Promise<void> | void;
	private readonly refreshMs: number;
	private readonly maxAgentRows: number;
	private readonly placement: FleetViewPlacement;

	constructor(
		state: SubagentState,
		openInspector: (itemKey: string) => Promise<void> | void,
		options: FleetStatusOptions = {},
	) {
		this.state = state;
		this.openInspector = openInspector;
		this.refreshMs = options.refreshMs ?? REFRESH_MS;
		this.maxAgentRows = options.maxAgentRows ?? MAX_AGENT_ROWS;
		this.placement = options.placement ?? "belowEditor";
	}

	setContext(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const ui = ctx.ui;
		if (this.ui === ui) {
			this.ctx = ctx;
			this.refresh();
			return;
		}
		this.clearUiRegistration();
		this.ctx = ctx;
		this.ui = ui;
		if (typeof ui.onTerminalInput === "function") {
			this.inputUnsubscribe = ui.onTerminalInput((data) => this.handleKey(data));
		}
		this.timer = setInterval(() => this.refresh(), this.refreshMs);
		this.timer.unref?.();
		this.refresh();
	}

	dispose(): void {
		this.clearUiRegistration();
		this.ctx = undefined;
		this.ui = undefined;
		this.entries = [];
		this.active = false;
		this.selectedKey = "main";
		this.inspectorOpen = false;
		this.lastRenderKey = "";
	}

	refresh(): void {
		const ctx = this.getActiveUiContext();
		if (!ctx) return;
		if (this.state.widgetsSuspended) {
			this.clearWidget();
			return;
		}
		this.entries = collectFleetStatusEntries(this.state);
		this.clampSelection();
		if (this.inspectorOpen || this.state.fleetInspectorOpen) {
			this.lastRenderKey = "";
			this.clearWidget();
			return;
		}
		if (!this.hasInlineSurface()) {
			this.active = false;
			this.selectedKey = "main";
			this.lastRenderKey = "";
			this.clearWidget();
			return;
		}

		const renderKey = this.getRenderKey();
		if (supportsDesktopNativeWidgets(ctx)) {
			const nativeContent = buildFleetDesktopStatus(
				this.entries,
				this.state.activeAsyncCapacity,
				Math.floor(Date.now() / 1_000) * 1_000,
			);
			const nativeRenderKey = JSON.stringify(nativeContent);
			if (this.widgetRegistered && nativeRenderKey === this.lastRenderKey) return;
			const options: DesktopSubagentWidgetOptions = { placement: this.placement, nativeContent };
			const fallbackLines = [`Subagents · ${nativeContent.summary.activeAgents} active · ${nativeContent.summary.asyncRunsUsed}/${nativeContent.summary.asyncRunsLimit || "∞"} async`];
			ctx.ui.setWidget(FLEET_STATUS_WIDGET_KEY, fallbackLines, options);
			this.widgetRegistered = true;
			this.lastRenderKey = nativeRenderKey;
			return;
		}
		if (!this.widgetRegistered) {
			ctx.ui.setWidget(FLEET_STATUS_WIDGET_KEY, (tui, theme) => {
				this.tui = tui;
				return {
					render: (width: number) => this.render(width, theme),
					invalidate: () => {
						this.lastRenderKey = "";
					},
					dispose: () => {
						if (this.tui !== tui) return;
						this.widgetRegistered = false;
						this.tui = undefined;
					},
				};
			}, { placement: this.placement });
			this.widgetRegistered = true;
			this.lastRenderKey = renderKey;
			return;
		}
		if (renderKey === this.lastRenderKey) {
			// Repaint anyway while anything is running so the wall-clock
			// spinner animates between state changes (500ms tick).
			if (this.entries.some((entry) => entry.state === "running")) this.tui?.requestRender();
			return;
		}
		this.lastRenderKey = renderKey;
		this.tui?.requestRender();
	}

	handleKey(data: string): { consume?: boolean; data?: string } | undefined {
		if (this.state.widgetsSuspended) return undefined;
		const ctx = this.getActiveUiContext();
		if (!ctx || this.entries.length === 0 || isKeyRelease(data)) return undefined;
		if (this.inspectorOpen) return undefined;
		if (!this.editorHasFocus()) {
			if (this.active) this.deactivate();
			return undefined;
		}

		if (!this.active) {
			const activates = matchesKey(data, "down") || matchesKey(data, "left");
			if (!activates || ctx.ui.getEditorText() !== "") return undefined;
			this.active = true;
			this.selectedKey = "main";
			this.refresh();
			return { consume: true };
		}

		const roster = this.rosterKeys();
		const selectedIndex = Math.max(0, roster.indexOf(this.selectedKey));
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.selectedKey = roster[Math.min(roster.length - 1, selectedIndex + 1)] ?? "main";
			this.refresh();
			return { consume: true };
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			if (selectedIndex === 0) {
				this.deactivate();
				return { consume: true };
			}
			this.selectedKey = roster[selectedIndex - 1] ?? "main";
			this.refresh();
			return { consume: true };
		}
		if (matchesKey(data, "escape")) {
			this.deactivate();
			return { consume: true };
		}
		if (matchesKey(data, Key.enter)) {
			if (this.selectedKey === "main") {
				this.deactivate();
				return { consume: true };
			}
			this.inspectorOpen = true;
			this.refresh();
			const selectedKey = this.selectedKey;
			void Promise.resolve()
				.then(() => this.openInspector(selectedKey))
				.catch((error) => ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"))
				.finally(() => {
					this.inspectorOpen = false;
					this.refresh();
				});
			return { consume: true };
		}

		this.deactivate();
		return undefined;
	}

	render(width: number, theme: Theme): string[] {
		if (!this.hasInlineSurface()) return [];
		if (!this.active) {
			const workEntries = this.entries.filter((entry) => !entry.surface);
			const projectEntries = this.entries.filter((entry) => entry.surface === "project-pane");
			const tokens = workEntries.reduce((total, entry) => total + entry.tokens, 0);
			const nativeEntries = workEntries.filter((entry) => !entry.external);
			const window = nativeEntries.length > 0 && nativeEntries.every((entry) => entry.window !== undefined)
				? nativeEntries.reduce((total, entry) => total + entry.window!, 0)
				: undefined;
			const capacity = this.state.activeAsyncCapacity;
			const hasNativeRows = workEntries.some((entry) => !entry.external);
			const showNativeSummary = hasNativeRows || Boolean(capacity?.used);
			const asyncRuns = capacity && showNativeSummary ? `Async runs ${capacity.used}/${capacity.limit || "∞"}` : "";
			const activeEntries = activeLeafAgentCount(workEntries);
			const noun = workEntries.some((entry) => entry.external) ? "job" : "agent";
			const agents = activeEntries > 0 ? `${activeEntries} active ${noun}${activeEntries === 1 ? "" : "s"}` : "";
			const paneAttention = projectEntries.filter((entry) => entry.projectPane && projectPaneNeedsAttention(entry.projectPane)).length;
			const panes = projectEntries.length > 0 ? `${projectEntries.length} pane${projectEntries.length === 1 ? "" : "s"}${paneAttention ? ` (${paneAttention} ⚠)` : ""}` : "";
			const label = [agents, asyncRuns, panes].filter(Boolean).join(" · ");
			const detail = [showNativeSummary ? formatFleetTokens(tokens, window) : undefined, "↓/← to inspect"].filter(Boolean).join(" · ");
			return [truncateToWidth(`  ${theme.fg("muted", label)}${label && detail ? " · " : ""}${theme.fg("dim", detail)}`, width)];
		}
		const roster = this.rosterKeys();
		const selectedIndex = Math.max(0, roster.indexOf(this.selectedKey));
		const rosterIndexByKey = new Map<string, number>();
		for (const [index, entry] of this.entries.entries()) {
			if (!rosterIndexByKey.has(entry.key)) rosterIndexByKey.set(entry.key, index + 1);
		}
		const lines = [truncateToWidth(`  ${theme.fg("dim", "↑↓/jk select · enter inspect · esc back")}`, width), ""];
		lines.push(truncateToWidth(`  ${this.bullet(0, selectedIndex, theme)} main`, width));

		const workEntries = this.entries.filter((entry) => !entry.surface);
		const tree = fleetTreeRows(workEntries);
		const selectedTreeIndex = Math.max(0, tree.findIndex((row) => (row.kind === "owner" || row.kind === "child") && row.entry.key === this.selectedKey));
		const visibleCount = Math.min(this.maxAgentRows, tree.length);
		const start = selectedTreeIndex < visibleCount ? 0 : selectedTreeIndex - visibleCount + 1;
		const hiddenBelow = tree.length - (start + visibleCount);
		if (start > 0) lines.push(rightAlign("", theme.fg("dim", `↑ ${start} more`), width));
		for (let index = start; index < start + visibleCount; index++) {
			const row = tree[index]!;
			if (row.kind === "owner" || row.kind === "child") {
				const rosterIndex = rosterIndexByKey.get(row.entry.key) ?? 0;
				lines.push(this.renderEntry(rosterIndex, selectedIndex, row.entry, width, theme, row.kind === "child" ? (row.last ? "└─" : "├─") : undefined));
			} else if (row.kind === "workflow") {
				lines.push(this.renderWorkflowRow(row.row, row.last, width, theme));
			} else if (row.kind === "workflow-phase") {
				lines.push(this.renderWorkflowPhaseRow(row.phase, row.last, width, theme));
			} else {
				lines.push(this.renderNestedRow(row.row, row.last, width, theme));
			}
		}
		if (hiddenBelow > 0) lines.push(rightAlign("", theme.fg("dim", `↓ ${hiddenBelow} more`), width));
		this.renderProjectPaneSection(lines, selectedIndex, width, theme, rosterIndexByKey);
		return lines;
	}

	private renderProjectPaneSection(lines: string[], selectedIndex: number, width: number, theme: Theme, rosterIndexByKey: ReadonlyMap<string, number>): void {
		const entries = this.entries.filter((entry) => entry.surface === "project-pane");
		if (!entries.length) return;
		lines.push("", truncateToWidth(`  ${theme.fg("dim", "project panes")}`, width));
		for (const entry of entries) {
			const rosterIndex = rosterIndexByKey.get(entry.key) ?? 0;
			lines.push(this.renderEntry(rosterIndex, selectedIndex, entry, width, theme));
		}
	}


	private renderEntry(rosterIndex: number, selectedIndex: number, entry: FleetStatusEntry, width: number, theme: Theme, branch?: string): string {
		const agent = entry.modelThinking ? `${entry.agent} (${entry.modelThinking})` : entry.agent;
		const prefix = branch ? `    ${branch}` : " ";
		const checklist = entry.workflowWrapper && entry.workflowChecklist
			? ` · checklist ${formatWorkflowChecklistSummary(entry.workflowChecklist)}${entry.workflowChecklist.bottleneck ? ` · bottleneck ${formatWorkflowChecklistBottleneck(entry.workflowChecklist.bottleneck)}` : ""}`
			: "";
		const left = `${prefix} ${this.bullet(rosterIndex, selectedIndex, theme)} ${theme.fg("muted", agent)} · ${entry.state}${checklist}`;
		const elapsed = Date.now() - entry.startedAt;
		const rightText = entry.projectPane
			? `${entry.projectPane.summary ?? "—"} · ${formatFleetElapsed(Date.now() - entry.projectPane.refreshedAt)} ago`
				: entry.external ? formatFleetElapsed(elapsed) : `${formatFleetElapsed(elapsed)} · ${formatFleetTokens(entry.tokens, entry.window)}`;
		const right = theme.fg("dim", rightText);
		return rightAlign(left, right, width);
	}

	private renderNestedRow(row: FleetNestedRow, last: boolean, width: number, theme: Theme): string {
		const marker = last ? "└─" : "├─";
		const indent = "    ".repeat(row.depth + 1);
		if (row.overflow !== undefined) return truncateToWidth(`${indent}${marker} ${theme.fg("dim", `+${row.overflow} nested leaves`)}`, width);
		const modelThinking = row.modelThinking ? ` (${row.modelThinking})` : "";
		const activity = row.activity ? ` · ${row.activity}` : "";
		const left = `${indent}${marker} ${nestedStatusGlyph(row.state, theme)} ${theme.fg("muted", `${row.name}${modelThinking}`)} · ${row.state}${activity}`;
		const elapsed = row.startedAt !== undefined ? ` · ${formatFleetElapsed(Date.now() - row.startedAt)}` : "";
		return truncateToWidth(`${left}${theme.fg("dim", elapsed)}`, width);
	}

	private workflowRowGlyph(row: AsyncStatusWorkflowRow, theme: Theme): string {
		if (!row.kind) return nestedStatusGlyph(row.state as FleetNestedRow["state"], theme);
		const state = row.state as HostStepState;
		if (state === "pending") return theme.fg("muted", "◦");
		if (state === "running") return theme.fg("accent", "●");
		if (state === "done") return row.verdict === "pass" ? theme.fg("success", "✓") : row.verdict === "fail" ? theme.fg("error", "✗") : theme.fg("warning", "■");
		if (state === "error") return theme.fg("error", "✗");
		return theme.fg("warning", "■");
	}

	private workflowRowStateLabel(row: AsyncStatusWorkflowRow, theme: Theme): string {
		const state = row.kind ? hostStepVerdictLabel(row.state as HostStepState, row.verdict as HostStepVerdict | undefined) : row.state;
		if (state === "running") return theme.fg("accent", state);
		if (state === "pending" || state === "queued") return theme.fg("muted", state);
		if (state === "pass" || state === "complete" || state === "completed") return theme.fg("success", state === "pass" ? "pass" : "complete");
		if (state === "fail" || state === "failed" || state === "error") return theme.fg("error", state === "fail" ? "fail" : state);
		return theme.fg("warning", state);
	}

	private renderWorkflowPhaseRow(phase: WorkflowChecklistPhase, last: boolean, width: number, theme: Theme): string {
		const marker = last ? "└─" : "├─";
		const glyph = phase.state === "complete"
			? theme.fg("success", "✓")
			: phase.state === "running"
				? theme.fg("accent", "●")
				: phase.state === "blocked" || phase.state === "failed"
					? theme.fg("error", phase.state === "blocked" ? "!" : "✗")
					: phase.state === "queued"
						? theme.fg("muted", "◦")
						: theme.fg("warning", "■");
		return truncateToWidth(`    ${marker} ${glyph} ${theme.fg("muted", formatWorkflowChecklistPhase(phase))}`, width);
	}

	private renderWorkflowRow(row: AsyncStatusWorkflowRow, last: boolean, width: number, theme: Theme): string {
		const marker = last ? "└─" : "├─";
		const indent = "    ";
		if (row.overflow !== undefined) return truncateToWidth(`${indent}${marker} ${theme.fg("dim", `+${row.overflow} hidden workflow steps`)}`, width);
		const context = contextModeLabel(row.context);
		const modelThinking = row.modelThinking ? ` (${row.modelThinking})` : "";
		const activity = row.activity ? ` · ${row.activity}` : "";
		const kind = row.kind ? `${row.kind}: ` : "";
		const hints = row.preflight ? [
			row.preflight.mode ? `mode:${row.preflight.mode}` : undefined,
			row.preflight.decision ? `decision:${row.preflight.decision}` : undefined,
			row.preflight.claims?.length ? `claims:${row.preflight.claims.join(",")}` : undefined,
			row.preflight.expectedOutput ? `expected:${row.preflight.expectedOutput}` : undefined,
			row.preflight.independence ? `independence:${row.preflight.independence}` : undefined,
		].filter((value): value is string => Boolean(value)).join(" · ") : "";
		const left = `${indent}${marker} ${this.workflowRowGlyph(row, theme)} ${theme.fg("muted", `${kind}${row.name}${context ? ` ${context}` : ""}${modelThinking}`)} · ${this.workflowRowStateLabel(row, theme)}${activity}${hints ? ` · ${hints}` : ""}`;
		const details = [
			row.startedAt !== undefined ? formatFleetElapsed(Date.now() - row.startedAt) : undefined,
			row.tokens !== undefined ? formatFleetTokens(row.tokens, row.window) : undefined,
			row.provider ? `provider:${row.provider}` : undefined,
			row.role ? `role:${row.role}` : undefined,
			row.target,
			row.detail,
			row.reasonCode ? `reason:${row.reasonCode}` : undefined,
			row.freshness?.stale ? "stale" : row.freshness?.observedRef ? `ref:${row.freshness.observedRef}` : undefined,
			row.reportPath ? `out:${hostStepReportName(row.reportPath)}` : undefined,
		].filter(Boolean).join(" · ");
		return truncateToWidth(`${left}${details ? theme.fg("dim", ` · ${details}`) : ""}`, width);
	}

	private bullet(rosterIndex: number, selectedIndex: number, theme: Theme): string {
		return rosterIndex === selectedIndex ? theme.fg("accent", ">") : " ";
	}

	private rosterKeys(): string[] {
		return ["main", ...this.entries.map((entry) => entry.key)];
	}

	private clampSelection(): void {
		if (!this.rosterKeys().includes(this.selectedKey)) this.selectedKey = "main";
	}

	private deactivate(): void {
		this.active = false;
		this.selectedKey = "main";
		this.refresh();
	}

	private editorHasFocus(): boolean {
		// pi-tui exposes focus mutation but no focus getter, so inspect the focused
		// component structurally. instanceof is unreliable across jiti module boundaries.
		const focused = (this.tui as unknown as { focusedComponent?: unknown } | undefined)?.focusedComponent;
		if (!focused || typeof focused !== "object") return false;
		const candidate = focused as Partial<EditorComponent>;
		return typeof candidate.render === "function"
			&& typeof candidate.invalidate === "function"
			&& typeof candidate.handleInput === "function"
			&& typeof candidate.getText === "function"
			&& typeof candidate.setText === "function";
	}

	private getRenderKey(): string {
		const now = Date.now();
		return JSON.stringify({
			active: this.active,
			selected: this.selectedKey,
			inspectorOpen: this.inspectorOpen,
			entries: this.entries.map((entry) => this.active
				? [
					entry.key,
					entry.surface,
					entry.parentKey,
					entry.agent,
					entry.state,
					entry.modelThinking,
					entry.description,
					entry.external,
					Math.round((now - entry.startedAt) / 1000),
					entry.tokens,
					entry.workflowChecklist ? [
						entry.workflowChecklist.total,
						entry.workflowChecklist.done,
						entry.workflowChecklist.running,
						entry.workflowChecklist.queued,
						entry.workflowChecklist.blocked,
						entry.workflowChecklist.failed,
						entry.workflowChecklist.phases.map((phase) => [phase.key, phase.state, phase.done, phase.total, phase.running, phase.queued, phase.blocked, phase.failed, phase.items.map((item) => [item.key, item.state, item.currentTool, item.currentPath, item.durationMs, item.toolCount, item.error])]),
					] : undefined,
					visibleWorkflowRows(entry.workflowRows, entry.parentKey ? 2 : 4).map((row) => [
						row.kind,
						row.name,
						row.state,
						row.context,
						row.modelThinking,
						row.activity,
						row.startedAt,
						row.tokens,
						row.provider,
						row.role,
						row.verdict,
						row.reasonCode,
						row.detail,
						row.target,
						row.freshness,
						row.reportPath,
						row.overflow,
					]),
					nestedFleetRows(entry.nestedChildren, entry.parentKey ? 3 : 4).map((row) => [
						row.name,
						row.state,
						row.modelThinking,
						row.activity,
						row.startedAt,
						row.depth,
						row.overflow,
					]),
				]
				: [entry.key, entry.state, entry.external, entry.surface, entry.tokens, entry.projectPane?.refreshedAt, entry.projectPane?.summary]),
		});
	}

	private hasInlineSurface(): boolean {
		return this.entries.length > 0 || Boolean(this.state.activeAsyncCapacity?.used);
	}

	private getActiveUiContext(): ExtensionContext | undefined {
		const ctx = this.ctx;
		if (!ctx) return undefined;
		try {
			return ctx.hasUI ? ctx : undefined;
		} catch (error) {
			if (!isStaleExtensionContextError(error)) throw error;
			this.clearUiRegistration();
			return undefined;
		}
	}

	private clearWidget(): void {
		if (!this.widgetRegistered) return;
		try {
			this.ui?.setWidget(FLEET_STATUS_WIDGET_KEY, undefined);
		} catch (error) {
			if (!isStaleExtensionContextError(error)) throw error;
			this.clearUiRegistration();
			return;
		}
		this.widgetRegistered = false;
		this.tui = undefined;
	}

	private clearUiRegistration(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;

		const inputUnsubscribe = this.inputUnsubscribe;
		const ui = this.ui;
		const widgetRegistered = this.widgetRegistered;
		this.inputUnsubscribe = undefined;
		this.ctx = undefined;
		this.ui = undefined;
		this.widgetRegistered = false;
		this.tui = undefined;

		const cleanupErrors: unknown[] = [];
		try {
			inputUnsubscribe?.();
		} catch (error) {
			if (!isStaleExtensionContextError(error)) cleanupErrors.push(error);
		}
		if (ui && widgetRegistered) {
			try {
				ui.setWidget(FLEET_STATUS_WIDGET_KEY, undefined);
			} catch (error) {
				if (!isStaleExtensionContextError(error)) cleanupErrors.push(error);
			}
		}
		if (cleanupErrors.length === 1) throw cleanupErrors[0];
		if (cleanupErrors.length > 1) {
			throw new AggregateError(cleanupErrors, "Failed to clean up FleetView UI registration");
		}
	}
}
