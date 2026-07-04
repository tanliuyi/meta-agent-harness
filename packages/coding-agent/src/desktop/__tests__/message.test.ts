/**
 * 本文件测试 Pi AgentMessage 到 desktop message 的共享转换。
 */

import { describe, expect, it } from "vitest";
import {
	toDesktopFileChanges,
	toDesktopMessageContent,
	toDesktopMessages,
	toDesktopToolCalls,
} from "../protocol/message.ts";
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
		expect(toDesktopMessageContent(messages[1]!)).toBeUndefined();
		expect(toDesktopMessages(messages)).toEqual([
			{
				id: "message-0",
				role: "assistant",
				text: "hello",
				raw: messages[0],
				createdAt: "2026-07-01T00:00:00.000Z",
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

	it("保留模型请求失败的 assistant 错误消息", () => {
		const timestamp = Date.parse("2026-07-01T00:00:00.000Z");
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
			stopReason: "error",
			errorMessage: "429: rate limit exceeded",
			timestamp,
		};

		expect(toDesktopMessageContent(message)).toEqual({
			role: "assistant",
			text: "模型请求失败：429: rate limit exceeded",
			raw: message,
			createdAt: "2026-07-01T00:00:00.000Z",
		});
		expect(toDesktopMessages([message])).toEqual([
			{
				id: "message-0",
				role: "assistant",
				text: "模型请求失败：429: rate limit exceeded",
				raw: message,
				createdAt: "2026-07-01T00:00:00.000Z",
			},
		]);
	});

	it("assistant raw 展示内容不重复暴露 toolCall block", () => {
		const message: AgentMessage = {
			role: "assistant",
			content: [
				{ type: "text", text: "我先读文件" },
				{ type: "toolCall", id: "tool-a", name: "read", arguments: { path: "README.md" } },
			],
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
		};

		expect(toDesktopMessageContent(message)).toMatchObject({
			role: "assistant",
			text: "我先读文件",
			toolCallIds: ["tool-a"],
			raw: {
				role: "assistant",
				content: [{ type: "text", text: "我先读文件" }],
			},
		});
	});

	it("从 assistant toolCall 建立工具投影，toolResult 只更新结果", () => {
		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "tool-a", name: "read", arguments: { path: "README.md" } }],
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
			},
			{
				role: "toolResult",
				content: [{ type: "text", text: "file content" }],
				toolCallId: "tool-a",
				isError: false,
				timestamp: Date.parse("2026-07-01T00:00:00.000Z"),
			} as AgentMessage,
		];

		expect(toDesktopMessages(messages)).toEqual([
			{
				id: "message-0",
				role: "assistant",
				toolCallIds: ["tool-a"],
				raw: {
					...messages[0],
					content: [],
				},
				createdAt: undefined,
			},
		]);
		expect(toDesktopToolCalls(messages, "thread-1")).toMatchObject([
			{
				threadId: "thread-1",
				toolCallId: "tool-a",
				toolName: "read",
				status: "succeeded",
				args: { path: "README.md" },
				result: { content: [{ type: "text", text: "file content" }] },
				resultSummary: "file content",
				finishedAt: "2026-07-01T00:00:00.000Z",
			},
		]);
	});

	it("忽略没有 assistant toolCall 的孤儿 toolResult", () => {
		const messages: AgentMessage[] = [
			{
				role: "toolResult",
				content: [{ type: "text", text: "orphan" }],
				toolCallId: "tool-orphan",
				isError: false,
			} as AgentMessage,
		];

		expect(toDesktopMessages(messages)).toEqual([]);
		expect(toDesktopToolCalls(messages, "thread-1")).toEqual([]);
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
