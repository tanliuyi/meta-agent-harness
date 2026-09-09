import type { ExtensionContext, ExtensionWidgetOptions } from "@earendil-works/pi-coding-agent";
import {
	projectAsyncStatusSnapshot,
	type AsyncStatusSnapshotNodeV1,
} from "../runs/shared/async-status-projection.ts";
import type { AsyncJobState } from "../shared/types.ts";
import { previewDisplayText } from "../shared/display-text.ts";

export const DESKTOP_SUBAGENT_WIDGET_VERSION = 1 as const;
export const DESKTOP_SUBAGENT_NODE_LIMIT = 80;
export const DESKTOP_SUBAGENT_CHILD_LIMIT = 8;
export const DESKTOP_SUBAGENT_DEPTH_LIMIT = 3;
export const DESKTOP_SUBAGENT_TEXT_LIMIT = 160;

export interface DesktopSubagentNode {
	id: string;
	kind: "subagent" | "workflow" | "step" | "host-step" | "external" | "project-pane";
	label: string;
	state: string;
	runId?: string;
	modelThinking?: string;
	description?: string;
	activity?: string;
	startedAt?: number;
	updatedAt?: number;
	endedAt?: number;
	tokens?: number;
	window?: number;
	toolCount?: number;
	turnCount?: number;
	verdict?: "pass" | "fail" | "inconclusive";
	children?: DesktopSubagentNode[];
}

export interface DesktopSubagentWidgetContent {
	type: "subagents";
	version: typeof DESKTOP_SUBAGENT_WIDGET_VERSION;
	source: "fleet" | "async";
	generatedAt: number;
	summary: {
		activeAgents: number;
		asyncRunsUsed: number;
		asyncRunsLimit: number;
		totalTokens: number;
	};
	nodes: DesktopSubagentNode[];
	omittedNodeCount: number;
}

export interface DesktopSubagentWidgetOptions extends ExtensionWidgetOptions {
	nativeContent: DesktopSubagentWidgetContent;
}

export function supportsDesktopNativeWidgets(ctx: ExtensionContext): boolean {
	if ((ctx as { mode?: string }).mode !== "rpc") return false;
	if (!("widgetCapabilities" in ctx.ui)) return false;
	const capabilities = ctx.ui.widgetCapabilities as { components?: unknown; nativeContent?: unknown };
	return typeof capabilities === "object"
		&& capabilities !== null
		&& capabilities.components === true
		&& capabilities.nativeContent === true;
}

function snapshotNodeToDesktop(node: AsyncStatusSnapshotNodeV1): DesktopSubagentNode {
	const activity = node.activity?.currentTool
		? previewDisplayText(`tool ${node.activity.currentTool}`, DESKTOP_SUBAGENT_TEXT_LIMIT)
		: node.activity?.state;
	return {
		id: node.id,
		kind: node.kind,
		label: node.label,
		state: node.state,
		...(node.modelThinking ? { modelThinking: node.modelThinking } : {}),
		...(node.hostStep?.detail ? { description: node.hostStep.detail } : {}),
		...(activity ? { activity } : {}),
		...(node.startedAt !== undefined ? { startedAt: node.startedAt } : {}),
		...(node.updatedAt !== undefined ? { updatedAt: node.updatedAt } : {}),
		...(node.endedAt !== undefined ? { endedAt: node.endedAt } : {}),
		...(node.tokens !== undefined ? { tokens: node.tokens } : {}),
		...(node.window !== undefined ? { window: node.window } : {}),
		...(node.activity?.toolCount !== undefined ? { toolCount: node.activity.toolCount } : {}),
		...(node.activity?.turnCount !== undefined ? { turnCount: node.activity.turnCount } : {}),
		...(node.hostStep?.verdict ? { verdict: node.hostStep.verdict } : {}),
		...(node.children?.length ? { children: node.children.map(snapshotNodeToDesktop) } : {}),
	};
}

function safeTotal(values: Iterable<number>): number {
	let total = 0;
	for (const value of values) total = Math.min(Number.MAX_SAFE_INTEGER, total + Math.max(0, value));
	return total;
}

export function buildAsyncDesktopStatus(jobs: Iterable<AsyncJobState>, generatedAt = Date.now()): DesktopSubagentWidgetContent {
	const jobList = [...jobs];
	const snapshot = projectAsyncStatusSnapshot(jobList, {
		generatedAt,
		maxRuns: 20,
		maxChildrenPerNode: DESKTOP_SUBAGENT_CHILD_LIMIT,
		maxDepth: DESKTOP_SUBAGENT_DEPTH_LIMIT,
		maxStringLength: DESKTOP_SUBAGENT_TEXT_LIMIT,
		maxSerializedBytes: 32 * 1024,
	});
	const jobById = new Map(jobList.map((job) => [job.asyncId, job]));
	const nodes = snapshot.runs.map((run) => {
		const node = snapshotNodeToDesktop(run);
		const job = jobById.get(run.id);
		return {
			...node,
			runId: run.id,
			...(job?.totalTokens?.total !== undefined ? { tokens: job.totalTokens.total } : {}),
			...(job?.totalTokens?.window !== undefined ? { window: job.totalTokens.window } : {}),
		};
	});
	const bounded = boundDesktopNodes(nodes, DESKTOP_SUBAGENT_NODE_LIMIT, 0, 20);
	const activeAgents = bounded.nodes.reduce((count, run) => count + countActiveLeaves(run), 0);
	const topLevelJobIds = new Set(jobList.map((job) => job.asyncId));
	const usageJobs = jobList.filter((job) => !job.parentWorkflowRunId || !topLevelJobIds.has(job.parentWorkflowRunId));
	return {
		type: "subagents",
		version: DESKTOP_SUBAGENT_WIDGET_VERSION,
		source: "async",
		generatedAt,
		summary: {
			activeAgents,
			asyncRunsUsed: jobList.filter((job) => job.status === "queued" || job.status === "running").length,
			asyncRunsLimit: 0,
			totalTokens: safeTotal(usageJobs.map((job) => job.totalTokens?.total ?? 0)),
		},
		nodes: bounded.nodes,
		omittedNodeCount: snapshot.omitted.runs + snapshot.omitted.children + bounded.omitted,
	};
}

function countDesktopNodes(nodes: DesktopSubagentNode[]): number {
	return nodes.reduce((count, node) => count + 1 + countDesktopNodes(node.children ?? []), 0);
}

function boundDesktopNodes(
	nodes: DesktopSubagentNode[],
	limit: number,
	depth = 0,
	widthLimit = DESKTOP_SUBAGENT_CHILD_LIMIT,
): { nodes: DesktopSubagentNode[]; omitted: number } {
	if (depth > DESKTOP_SUBAGENT_DEPTH_LIMIT || limit <= 0) return { nodes: [], omitted: countDesktopNodes(nodes) };
	const bounded: DesktopSubagentNode[] = [];
	let omitted = 0;
	let remaining = limit;
	for (const [index, node] of nodes.entries()) {
		if (bounded.length >= widthLimit || remaining <= 0) {
			omitted += countDesktopNodes(nodes.slice(index));
			break;
		}
		remaining--;
		const children = boundDesktopNodes(node.children ?? [], remaining, depth + 1);
		remaining -= countDesktopNodes(children.nodes);
		omitted += children.omitted;
		bounded.push({ ...node, ...(children.nodes.length ? { children: children.nodes } : { children: undefined }) });
	}
	return { nodes: bounded, omitted };
}

function countActiveLeaves(node: DesktopSubagentNode): number {
	const activeChildren = node.children?.reduce((count, child) => count + countActiveLeaves(child), 0) ?? 0;
	if (activeChildren > 0) return activeChildren;
	return node.kind !== "workflow" && (node.state === "queued" || node.state === "running") ? 1 : 0;
}
