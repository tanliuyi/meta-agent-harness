/**
 * 本文件测试从 Pi canonical JSONL session 重建 desktop snapshot。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../core/session-manager.ts";
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
	});
});
