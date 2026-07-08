import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CONFIG_DIR_NAME = ".pi";
const PANEL_ID = "token-usage";
const MAX_RECENT_RECORDS = 25;
const panelRoot = fileURLToPath(new URL("./token-usage-panel", import.meta.url));

type Usage = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
};

type AssistantUsageMessage = {
	role: "assistant";
	provider?: string;
	model?: string;
	api?: string;
	stopReason?: string;
	timestamp?: number;
	usage?: Usage;
};

type SerializableUsageStats = {
	requests: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cacheHitRate: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
};

type UsageStats = SerializableUsageStats & {
	byModel: Map<string, UsageStats>;
};

type UsageRecord = {
	timestamp: string;
	provider?: string;
	model?: string;
	modelKey: string;
	api?: string;
	stopReason?: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cacheHitRate: number;
	cost: SerializableUsageStats["cost"];
};

function createStats(): UsageStats {
	return {
		requests: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cacheHitRate: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		byModel: new Map(),
	};
}

function number(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageTotal(usage: Usage): number {
	return number(usage.totalTokens) || number(usage.input) + number(usage.output) + number(usage.cacheRead) + number(usage.cacheWrite);
}

function addUsage(stats: UsageStats, usage: Usage, key?: string): void {
	stats.requests++;
	stats.input += number(usage.input);
	stats.output += number(usage.output);
	stats.cacheRead += number(usage.cacheRead);
	stats.cacheWrite += number(usage.cacheWrite);
	stats.totalTokens += usageTotal(usage);
	stats.cacheHitRate = cacheHitRate(stats);
	stats.cost.input += number(usage.cost?.input);
	stats.cost.output += number(usage.cost?.output);
	stats.cost.cacheRead += number(usage.cost?.cacheRead);
	stats.cost.cacheWrite += number(usage.cost?.cacheWrite);
	stats.cost.total += number(usage.cost?.total);

	if (key) {
		let modelStats = stats.byModel.get(key);
		if (!modelStats) {
			modelStats = createStats();
			stats.byModel.set(key, modelStats);
		}
		addUsage(modelStats, usage);
	}
}

function resetStats(stats: UsageStats): void {
	stats.requests = 0;
	stats.input = 0;
	stats.output = 0;
	stats.cacheRead = 0;
	stats.cacheWrite = 0;
	stats.totalTokens = 0;
	stats.cacheHitRate = 0;
	stats.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	stats.byModel.clear();
}

function formatInt(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

function formatCost(value: number): string {
	return value > 0 ? `$${value.toFixed(4)}` : "$0";
}

function formatK(value: number): string {
	return `${(value / 1000).toFixed(1)}K`;
}

function cacheHitRateFromValues(input: number, cacheRead: number, cacheWrite: number): number {
	const promptTokens = input + cacheRead + cacheWrite;
	return promptTokens > 0 ? (cacheRead / promptTokens) * 100 : 0;
}

function cacheHitRate(stats: Pick<UsageStats, "input" | "cacheRead" | "cacheWrite">): number {
	return cacheHitRateFromValues(stats.input, stats.cacheRead, stats.cacheWrite);
}

function modelKey(message: AssistantUsageMessage): string {
	return [message.provider, message.model].filter(Boolean).join("/") || "unknown";
}

function renderSummary(stats: UsageStats, logFile: string): string[] {
	const lines = [
		`Requests: ${formatInt(stats.requests)}`,
		`Tokens: ${formatInt(stats.totalTokens)} total (${formatInt(stats.input)} input, ${formatInt(stats.output)} output)`,
		`Cache: ${formatInt(stats.cacheRead)} read, ${formatInt(stats.cacheWrite)} write, ${cacheHitRate(stats).toFixed(1)}% hit`,
		`Cost: ${formatCost(stats.cost.total)}`,
		`Log: ${logFile}`,
	];

	const modelLines = [...stats.byModel.entries()]
		.sort((a, b) => b[1].totalTokens - a[1].totalTokens)
		.slice(0, 5)
		.map(([key, value]) =>
			`${key}: ${formatInt(value.totalTokens)} tokens, cache ${formatInt(value.cacheRead)}/${formatInt(value.cacheWrite)}`,
		);

	if (modelLines.length > 0) {
		lines.push("", "Top models:", ...modelLines);
	}

	return lines;
}

function toSerializableStats(stats: UsageStats): SerializableUsageStats {
	return {
		requests: stats.requests,
		input: stats.input,
		output: stats.output,
		cacheRead: stats.cacheRead,
		cacheWrite: stats.cacheWrite,
		totalTokens: stats.totalTokens,
		cacheHitRate: cacheHitRate(stats),
		cost: { ...stats.cost },
	};
}

function toPanelState(stats: UsageStats, recent: UsageRecord[], logFile: string) {
	return {
		type: "usage-state",
		updatedAt: new Date().toISOString(),
		logFile,
		stats: toSerializableStats(stats),
		byModel: [...stats.byModel.entries()]
			.sort((a, b) => b[1].totalTokens - a[1].totalTokens)
			.map(([key, value]) => ({ key, ...toSerializableStats(value) })),
		recent,
	};
}

function registerPanel(ctx: ExtensionContext, stats: UsageStats, recent: UsageRecord[], logFile: string): void {
	ctx.desktop.registerWebviewPanel(PANEL_ID, {
		title: "Usage",
		icon: "gauge",
		order: 35,
		source: {
			type: "file",
			path: "index.html",
			basePath: panelRoot,
			localResourceRoots: [panelRoot],
			permissions: { enableScripts: true },
		},
	});
	postPanelState(ctx, stats, recent, logFile);
}

function postPanelState(ctx: ExtensionContext, stats: UsageStats, recent: UsageRecord[], logFile: string): void {
	ctx.desktop.postPanelMessage(PANEL_ID, toPanelState(stats, recent, logFile));
}

function updateUi(ctx: ExtensionContext, stats: UsageStats, recent: UsageRecord[], logFile: string): void {
	const hitRate = cacheHitRate(stats);
	ctx.ui.setStatus(
		"token-usage",
		`tokens ${formatK(stats.totalTokens)} cache ${formatK(stats.cacheRead)}/${formatK(stats.cacheWrite)} ${hitRate.toFixed(0)}%`,
	);
	ctx.ui.setWidget("token-usage", renderSummary(stats, logFile), { placement: "belowEditor" });
	postPanelState(ctx, stats, recent, logFile);
}

function createUsageRecord(message: AssistantUsageMessage, usage: Usage): UsageRecord {
	return {
		timestamp: new Date(message.timestamp ?? Date.now()).toISOString(),
		provider: message.provider,
		model: message.model,
		modelKey: modelKey(message),
		api: message.api,
		stopReason: message.stopReason,
		input: number(usage.input),
		output: number(usage.output),
		cacheRead: number(usage.cacheRead),
		cacheWrite: number(usage.cacheWrite),
		totalTokens: usageTotal(usage),
		cacheHitRate: cacheHitRateFromValues(number(usage.input), number(usage.cacheRead), number(usage.cacheWrite)),
		cost: {
			input: number(usage.cost?.input),
			output: number(usage.cost?.output),
			cacheRead: number(usage.cost?.cacheRead),
			cacheWrite: number(usage.cost?.cacheWrite),
			total: number(usage.cost?.total),
		},
	};
}

function appendUsageLog(logFile: string, record: UsageRecord, usage: Usage): void {
	mkdirSync(join(logFile, ".."), { recursive: true });
	appendFileSync(logFile, `${JSON.stringify({ ...record, usage })}\n`, "utf8");
}

function getCwd(ctx: ExtensionContext): string {
	return ctx.cwd || ctx.sessionManager.getCwd() || process.cwd();
}

function getLogFile(ctx: ExtensionContext): string {
	return join(getCwd(ctx), CONFIG_DIR_NAME, "token-usage.jsonl");
}

export default function tokenUsageExtension(pi: ExtensionAPI) {
	const stats = createStats();
	const recent: UsageRecord[] = [];
	let logFile = "";

	pi.on("session_start", (_event, ctx) => {
		resetStats(stats);
		recent.length = 0;
		logFile = getLogFile(ctx);

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const message = entry.message as AssistantUsageMessage;
			if (!message.usage) continue;
			addUsage(stats, message.usage, modelKey(message));
			recent.unshift(createUsageRecord(message, message.usage));
		}
		recent.splice(MAX_RECENT_RECORDS);

		registerPanel(ctx, stats, recent, logFile);
		updateUi(ctx, stats, recent, logFile);
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;

		const message = event.message as AssistantUsageMessage;
		if (!message.usage) return;

		if (!logFile) logFile = getLogFile(ctx);
		addUsage(stats, message.usage, modelKey(message));
		const record = createUsageRecord(message, message.usage);
		recent.unshift(record);
		recent.splice(MAX_RECENT_RECORDS);

		try {
			appendUsageLog(logFile, record, message.usage);
		} catch (error) {
			console.warn(`[token-usage] failed to write ${logFile}:`, error);
		}

		updateUi(ctx, stats, recent, logFile);
	});

	pi.on("after_provider_response", (event, ctx) => {
		if (event.status < 400) return;
		ctx.ui.setStatus("token-usage-provider", `provider ${event.status}`);
	});

	pi.on("desktop_panel_message", (event, ctx) => {
		if (event.panelId !== PANEL_ID) return;
		const message = event.message as { type?: string };
		if (message.type === "reset") {
			resetStats(stats);
			recent.length = 0;
			if (!logFile) logFile = getLogFile(ctx);
			updateUi(ctx, stats, recent, logFile);
			ctx.ui.notify("Token usage counters reset", "info");
			return;
		}
		if (!logFile) logFile = getLogFile(ctx);
		postPanelState(ctx, stats, recent, logFile);
	});

	pi.registerCommand("token-usage", {
		description: "Show token usage and prompt cache statistics",
		getArgumentCompletions: (prefix) => ["reset", "log"].filter((item) => item.startsWith(prefix)),
		handler: async (args, ctx) => {
			if (!logFile) logFile = getLogFile(ctx);

			const action = args.trim();
			if (action === "reset") {
				resetStats(stats);
				recent.length = 0;
				updateUi(ctx, stats, recent, logFile);
				ctx.ui.notify("Token usage counters reset", "info");
				return;
			}

			if (action === "log") {
				ctx.ui.notify(logFile, "info");
				return;
			}

			updateUi(ctx, stats, recent, logFile);
			await ctx.ui.editor("Token usage", renderSummary(stats, logFile).join("\n"));
		},
	});
}
