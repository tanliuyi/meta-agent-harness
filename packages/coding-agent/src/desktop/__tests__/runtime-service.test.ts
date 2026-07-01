/**
 * 本文件测试 runtime desktop worker service 的启动、绑定与停止行为。
 */

import { describe, expect, it } from "vitest";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
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

	/** 验证绑定 runtime 后转发 canonical event 并派生 projection event。 */
	it("绑定 runtime 后转发 canonical event 并派生 projection event", async () => {
		let listener: ((event: { type: "thinking_level_changed"; level: "high" }) => void) | undefined;
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
				eventType: "projection",
				threadId: "thread-1",
				event: { type: "thinking.changed", threadId: "thread-1", level: "high" },
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
