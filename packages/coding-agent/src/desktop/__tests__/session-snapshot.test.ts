/**
 * 本文件测试从 Pi canonical JSONL session 重建 desktop snapshot。
 */

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSessionCwd, SessionManager } from "../../core/session-manager.ts";
import { buildSnapshotFromSession } from "../storage/session-snapshot.ts";

const roots: string[] = [];

/** 每个测试后清理临时目录。 */
afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

/** buildSnapshotFromSession 测试套件。 */
describe("buildSnapshotFromSession", () => {
	/** 验证使用 Pi SessionManager 读取 JSONL 并重建最小 snapshot。 */
	it("使用 Pi SessionManager 读取 JSONL 并重建最小 snapshot", () => {
		const root = mkdtempSync(join(tmpdir(), "desktop-session-"));
		roots.push(root);
		const cwd = join(root, "repo");
		const sessionDir = join(root, "sessions");
		const manager = SessionManager.create(cwd, sessionDir);
		manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		manager.appendMessage({ role: "assistant", content: "world", timestamp: 2 });
		manager.appendModelChange("openai", "gpt-test");
		manager.appendThinkingLevelChange("high");
		manager.appendSessionInfo("测试会话");
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) {
			throw new Error("session file is required");
		}

		const snapshot = buildSnapshotFromSession({
			thread: {
				threadId: "thread-1",
				cwd,
				status: "stopped",
				createdAt: "2026-07-01T00:00:00.000Z",
				updatedAt: "2026-07-01T00:00:00.000Z",
			},
			sessionFile,
		});

		expect(snapshot).toMatchObject({
			threadId: "thread-1",
			cwd,
			sessionFile,
			title: "测试会话",
			status: "stopped",
			model: { provider: "openai", id: "gpt-test" },
			thinkingLevel: "high",
		});
		expect(snapshot.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
			{ role: "user", text: "hello" },
			{ role: "assistant", text: "world" },
		]);
		expect(resolveSessionCwd(sessionFile, join(root, "fallback"))).toBe(cwd);
		expect(resolveSessionCwd(sessionFile, join(root, "fallback"), join(root, "override"))).toBe(
			join(root, "override"),
		);
	});

	it("从 assistant toolCall block 派生工具调用参数", () => {
		const root = mkdtempSync(join(tmpdir(), "desktop-session-"));
		roots.push(root);
		const cwd = join(root, "repo");
		const sessionDir = join(root, "sessions");
		const manager = SessionManager.create(cwd, sessionDir);
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "toolCall", id: "tool-a", name: "bash", arguments: { command: "pnpm test" } }],
			api: "responses",
			provider: "openai",
			model: "gpt-test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 1,
		});
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "tool-a",
			toolName: "bash",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			timestamp: 2,
		});
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) {
			throw new Error("session file is required");
		}

		const snapshot = buildSnapshotFromSession({
			thread: {
				threadId: "thread-1",
				cwd,
				status: "stopped",
				createdAt: "2026-07-01T00:00:00.000Z",
				updatedAt: "2026-07-01T00:00:00.000Z",
			},
			sessionFile,
		});

		expect(snapshot.toolCalls).toMatchObject([
			{
				threadId: "thread-1",
				toolCallId: "tool-a",
				toolName: "bash",
				status: "succeeded",
				args: { command: "pnpm test" },
				resultSummary: "ok",
			},
		]);
	});

	it("从 edit tool result 重建文件 diff/patch 变更", () => {
		const root = mkdtempSync(join(tmpdir(), "desktop-session-"));
		roots.push(root);
		const cwd = join(root, "repo");
		const sessionDir = join(root, "sessions");
		const manager = SessionManager.create(cwd, sessionDir);
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "toolCall", id: "tool-edit", name: "edit", arguments: { path: "src/app.ts" } }],
			api: "responses",
			provider: "openai",
			model: "gpt-test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 1,
		});
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "tool-edit",
			toolName: "edit",
			content: [{ type: "text", text: "Successfully replaced 1 block(s) in src/app.ts." }],
			isError: false,
			timestamp: Date.parse("2026-07-01T00:00:00.000Z"),
			details: {
				diff: "-1 old\n+1 new",
				patch: "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n",
				firstChangedLine: 1,
			},
		} as Parameters<typeof manager.appendMessage>[0]);
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) {
			throw new Error("session file is required");
		}

		const snapshot = buildSnapshotFromSession({
			thread: {
				threadId: "thread-1",
				cwd,
				status: "stopped",
				createdAt: "2026-07-01T00:00:00.000Z",
				updatedAt: "2026-07-01T00:00:00.000Z",
			},
			sessionFile,
		});

		expect(snapshot.fileChanges).toMatchObject([
			{
				threadId: "thread-1",
				toolCallId: "tool-edit",
				path: "src/app.ts",
				changeType: "updated",
				diff: "-1 old\n+1 new",
				patch: "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n",
				additions: 1,
				deletions: 1,
				firstChangedLine: 1,
				createdAt: "2026-07-01T00:00:00.000Z",
			},
		]);
		expect(snapshot.toolCalls).toMatchObject([
			{
				toolCallId: "tool-edit",
				result: {
					details: {
						diff: "-1 old\n+1 new",
						patch: "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n",
						firstChangedLine: 1,
					},
				},
			},
		]);
	});

	/** 验证 cwd 解析复用完整 JSONL parser，不依赖短读 header。 */
	it("resolveSessionCwd 使用完整 JSONL header 解析", () => {
		const root = mkdtempSync(join(tmpdir(), "desktop-session-"));
		roots.push(root);
		const cwd = join(root, "repo");
		const sessionFile = join(root, "long-header.jsonl");
		const header = {
			type: "session",
			version: 3,
			id: "session-long-header",
			timestamp: "2026-07-01T00:00:00.000Z",
			cwd,
			parentSession: "x".repeat(1024),
		};
		appendFileSync(sessionFile, `${JSON.stringify(header)}\n`);

		expect(resolveSessionCwd(sessionFile, join(root, "fallback"))).toBe(cwd);
	});
});
