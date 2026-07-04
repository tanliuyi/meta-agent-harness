/**
 * 本文件测试 runtime desktop worker service 的启动、绑定与停止行为。
 */

import { describe, expect, it } from "vitest";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type { AgentSessionEvent } from "../../core/agent-session.ts";
import { RuntimeDesktopWorkerService } from "../worker/runtime-service.ts";
import type { StartThreadInput } from "../protocol/thread.ts";
import type { WorkerEventEnvelope } from "../protocol/envelope.ts";

/** RuntimeDesktopWorkerService 测试套件。 */
describe("RuntimeDesktopWorkerService", () => {
	/** 验证 startThread 使用 factory 创建 Pi runtime。 */
	it("startThread 使用 factory 创建 Pi runtime", async () => {
		const calls: StartThreadInput[] = [];
		const service = new RuntimeDesktopWorkerService(async (input) => {
			calls.push(input);
			return createRuntime();
		});

		const response = await service.handle({
			kind: "command",
			id: "1",
			command: { type: "worker.startThread", input: { threadId: "thread-1", cwd: "H:/repo" } },
		});

		expect(response.success).toBe(true);
		expect(calls).toEqual([{ threadId: "thread-1", cwd: "H:/repo" }]);
	});

	/** 验证重复绑定同一个 worker 时 fail-first。 */
	it("重复绑定同一个 worker 时 fail-first", async () => {
		const service = new RuntimeDesktopWorkerService(async () => createRuntime());
		await service.startThread({ threadId: "thread-1", cwd: "H:/repo" });

		const response = await service.handle({
			kind: "command",
			id: "1",
			command: { type: "worker.startThread", input: { threadId: "thread-2", cwd: "H:/repo" } },
		});

		expect(response.success).toBe(false);
		expect(response.error?.message).toContain("already has a bound thread");
	});

	/** 验证 stop 会释放 runtime。 */
	it("stop 会释放 runtime", async () => {
		let disposed = false;
		const service = new RuntimeDesktopWorkerService(async () =>
			createRuntime({
				dispose: async () => {
					disposed = true;
				},
			}),
		);
		await service.startThread({ threadId: "thread-1", cwd: "H:/repo" });

		await service.stop("test");
		const response = await service.handle({
			kind: "command",
			id: "1",
			command: { type: "worker.ping" },
		});

		expect(disposed).toBe(true);
		expect(response.success).toBe(true);
	});

	/** 验证绑定 runtime 后原样转发 canonical event。 */
	it("绑定 runtime 后原样转发 canonical event", async () => {
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		const model = createModel("gpt-5.1");
		const events: WorkerEventEnvelope[] = [];
		const service = new RuntimeDesktopWorkerService(async () =>
			createRuntime({
				session: {
					subscribe: (next: typeof listener) => {
						listener = next;
						return () => {};
					},
				},
			}),
		);
		service.setEventSink((event) => events.push(event));
		await service.startThread({ threadId: "thread-1", cwd: "H:/repo" });

		listener?.({ type: "thinking_level_changed", level: "high" });
		listener?.({ type: "model_changed", model, source: "set" });

		expect(events).toEqual([
			{
				kind: "event",
				eventType: "projection",
				threadId: "thread-1",
				event: { type: "thread.stateChanged", threadId: "thread-1", status: "idle" },
			},
			{
				kind: "event",
				eventType: "canonical",
				threadId: "thread-1",
				event: { type: "thinking_level_changed", level: "high" },
			},
			{
				kind: "event",
				eventType: "canonical",
				threadId: "thread-1",
				event: { type: "model_changed", model, source: "set" },
			},
		]);
	});

	it("edit tool 结束后派生 file.changed projection", async () => {
		let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
		const events: WorkerEventEnvelope[] = [];
		const service = new RuntimeDesktopWorkerService(async () =>
			createRuntime({
				session: {
					subscribe: (next: typeof listener) => {
						listener = next;
						return () => {};
					},
				},
			}),
		);
		service.setEventSink((event) => events.push(event));
		await service.startThread({ threadId: "thread-1", cwd: "H:/repo" });

		listener?.({
			type: "tool_execution_start",
			toolCallId: "tool-edit",
			toolName: "edit",
			args: { path: "src/app.ts" },
		});
		listener?.({
			type: "tool_execution_end",
			toolCallId: "tool-edit",
			toolName: "edit",
			result: {
				content: [{ type: "text", text: "Successfully replaced 1 block(s) in src/app.ts." }],
				details: {
					diff: "-1 old\n+1 new",
					patch: "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n",
					firstChangedLine: 1,
				},
			},
			isError: false,
		});

		expect(events).toMatchObject([
			{ eventType: "projection", event: { type: "thread.stateChanged" } },
			{ eventType: "canonical", event: { type: "tool_execution_start" } },
			{ eventType: "canonical", event: { type: "tool_execution_end" } },
			{
				eventType: "projection",
				threadId: "thread-1",
				event: {
					type: "file.changed",
					threadId: "thread-1",
					change: {
						threadId: "thread-1",
						toolCallId: "tool-edit",
						path: "src/app.ts",
						changeType: "updated",
						diff: "-1 old\n+1 new",
						patch: "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n",
						additions: 1,
						deletions: 1,
						firstChangedLine: 1,
					},
				},
			},
		]);
	});
});

function createRuntime(overrides: Partial<AgentSessionRuntime> = {}): AgentSessionRuntime {
	const session = {
		subscribe: () => () => {},
		bindExtensions: async () => {},
		...((overrides.session as Record<string, unknown> | undefined) ?? {}),
	};
	const { session: _session, ...rest } = overrides;
	return {
		session,
		dispose: async () => {},
		...rest,
	} as AgentSessionRuntime;
}

function createModel(id: string) {
	return {
		id,
		name: id,
		api: "openai-responses" as const,
		provider: "openai" as const,
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text" as const],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 128000,
		maxTokens: 16384,
	};
}
