/**
 * 本文件测试 Pi AgentMessage 到 desktop message 的共享转换。
 */

import { describe, expect, it } from "vitest";
import { toDesktopFileChanges, toDesktopMessageContent, toDesktopMessages } from "../protocol/message.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("desktop message conversion", () => {
	it("复用同一套 Pi AgentMessage 文本、角色和时间戳转换", () => {
		const timestamp = Date.parse("2026-07-01T00:00:00.000Z");
		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [{ type: "text", text: "hello" }],
				api: "responses",
				provider: "openai",
				model: "gpt-5",
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp,
			},
			{
				role: "toolResult",
				content: "done",
				toolCallId: "tool-a",
				toolName: "read",
			},
		];

		expect(toDesktopMessageContent(messages[0]!)).toEqual({
			role: "assistant",
			text: "hello",
			raw: messages[0],
			createdAt: "2026-07-01T00:00:00.000Z",
		});
		expect(toDesktopMessages(messages)).toEqual([
			{
				id: "message-0",
				role: "assistant",
				text: "hello",
				raw: messages[0],
				createdAt: "2026-07-01T00:00:00.000Z",
			},
			{
				id: "message-1",
				role: "tool",
				text: "done",
				raw: messages[1],
				createdAt: undefined,
			},
		]);
	});

	it("跳过没有文本内容的 assistant 消息", () => {
		const message: AgentMessage = {
			role: "assistant",
			content: [],
			api: "responses",
			provider: "openai",
			model: "gpt-5",
			usage: {
				input: 1,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 1,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "tool_use",
		};

		expect(toDesktopMessageContent(message)).toBeUndefined();
		expect(toDesktopMessages([message])).toEqual([]);
	});

	it("从 edit tool result 派生文件 diff projection", () => {
		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "tool-edit", name: "edit", arguments: { path: "src/app.ts" } }],
				api: "responses",
				provider: "openai",
				model: "gpt-5",
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
			},
			{
				role: "toolResult",
				content: [{ type: "text", text: "Successfully replaced 1 block(s) in src/app.ts." }],
				toolCallId: "tool-edit",
				toolName: "edit",
				isError: false,
				timestamp: Date.parse("2026-07-01T00:00:00.000Z"),
				details: {
					diff: "-1 old\n+1 new\n 2 context",
					patch: "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n",
					firstChangedLine: 1,
				},
			} as AgentMessage,
		];

		expect(toDesktopFileChanges(messages, "thread-1")).toEqual([
			{
				threadId: "thread-1",
				toolCallId: "tool-edit",
				path: "src/app.ts",
				changeType: "updated",
				diff: "-1 old\n+1 new\n 2 context",
				patch: "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n",
				additions: 1,
				deletions: 1,
				firstChangedLine: 1,
				createdAt: "2026-07-01T00:00:00.000Z",
			},
		]);
	});
});
