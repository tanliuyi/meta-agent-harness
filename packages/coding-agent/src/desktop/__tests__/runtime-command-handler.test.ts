/**
 * 本文件测试 desktop runtime command handler 与 Pi RPC 主干语义的一致性。
 */

import { describe, expect, it } from "vitest";
import { handleRuntimeCommand, type RuntimeCommandHandlerHost } from "../worker/runtime-command-handler.ts";
import type { WorkerCommandEnvelope } from "../protocol/envelope.ts";

/** Runtime command handler 测试套件。 */
describe("handleRuntimeCommand", () => {
	/** 验证返回 Pi 同构的 session state。 */
	it("返回 Pi 同构 session state", async () => {
		const host = createHost();

		const response = await handleRuntimeCommand(host, command("1", { type: "get_state" }));

		expect(response?.success).toBe(true);
		expect(response?.data).toMatchObject({
			sessionId: "session-1",
			sessionName: "Desktop",
			messageCount: 0,
			pendingMessageCount: 0,
		});
	});

	/** 验证 set_session_name 拒绝空名称。 */
	it("set_session_name 拒绝空名称", async () => {
		const host = createHost();

		const response = await handleRuntimeCommand(host, command("1", { type: "set_session_name", name: "   " }));

		expect(response?.success).toBe(false);
		expect(response?.error?.code).toBe("invalid_command");
	});

	/** 验证 clone 在无 leaf entry 时 fail-first。 */
	it("clone 在没有 leaf entry 时 fail-first", async () => {
		const host = createHost();

		const response = await handleRuntimeCommand(host, command("1", { type: "clone" }));

		expect(response?.success).toBe(false);
		expect(response?.error?.code).toBe("invalid_state");
	});

	/** 验证 set_model 找不到模型时返回结构化错误。 */
	it("set_model 找不到模型时返回结构化错误", async () => {
		const host = createHost();

		const response = await handleRuntimeCommand(
			host,
			command("1", { type: "set_model", provider: "missing", modelId: "none" }),
		);

		expect(response?.success).toBe(false);
		expect(response?.error?.message).toContain("Model not found");
	});

	/** 验证 get_commands 汇总 extension、prompt template 和 skill 命令。 */
	it("get_commands 汇总 extension、prompt template 和 skill 命令", async () => {
		const host = createHost();

		const response = await handleRuntimeCommand(host, command("1", { type: "get_commands" }));
		expect(response?.success).toBe(true);
		expect(response?.data).toEqual({
			commands: [
				{
					name: "fix",
					description: "修复问题",
					source: "extension",
					sourceInfo: { type: "extension", path: "ext" },
				},
				{
					name: "review",
					description: "审查代码",
					source: "prompt",
					sourceInfo: { type: "prompt", path: "prompt" },
				},
				{
					name: "skill:test",
					description: "测试技能",
					source: "skill",
					sourceInfo: { type: "skill", path: "skill" },
				},
			],
		});
	});

	/** 验证 prompt 等待 preflight 成功后返回，不等待完整 agent run。 */
	it("prompt 等待 preflight 成功后返回，不等待完整 agent run", async () => {
		let finishPrompt: (() => void) | undefined;
		const session = createSession({
			prompt: async (_message: string, options: { preflightResult?: (success: boolean) => void }) => {
				options.preflightResult?.(true);
				await new Promise<void>((resolve) => {
					finishPrompt = resolve;
				});
			},
		});
		const host = createHost(session);

		const response = await handleRuntimeCommand(host, command("1", { type: "prompt", message: "hello" }));

		expect(response?.success).toBe(true);
		expect(finishPrompt).toBeDefined();
		finishPrompt?.();
	});

	/** 验证 prompt preflight 失败时返回 runtime_error。 */
	it("prompt preflight 失败时返回 runtime_error", async () => {
		const session = createSession({
			prompt: async (_message: string, options: { preflightResult?: (success: boolean) => void }) => {
				options.preflightResult?.(false);
				throw new Error("no model");
			},
		});
		const host = createHost(session);

		const response = await handleRuntimeCommand(host, command("1", { type: "prompt", message: "hello" }));

		expect(response?.success).toBe(false);
		expect(response?.error?.message).toBe("no model");
	});

	/** 验证 cycle_thinking_level 在模型不支持 thinking 时返回 null。 */
	it("cycle_thinking_level 不支持 thinking 时返回 null", async () => {
		const host = createHost(createSession({ cycleThinkingLevel: () => undefined }));

		const response = await handleRuntimeCommand(host, command("1", { type: "cycle_thinking_level" }));

		expect(response?.success).toBe(true);
		expect(response?.data).toBeNull();
	});
});

function command(id: string, value: WorkerCommandEnvelope["command"]): WorkerCommandEnvelope {
	return { kind: "command", id, command: value };
}

function createHost(session = createSession()): RuntimeCommandHandlerHost {
	return {
		runtime: {
			session,
			newSession: async () => ({ cancelled: false }),
			switchSession: async () => ({ cancelled: false }),
			fork: async () => ({ cancelled: false }),
			dispose: async () => {},
		} as RuntimeCommandHandlerHost["runtime"],
	};
}

function createSession(overrides: Record<string, unknown> = {}): RuntimeCommandHandlerHost["runtime"]["session"] {
	const sourceInfo = { type: "test", path: "test" };
	return {
		model: { provider: "openai", id: "gpt-test" },
		thinkingLevel: "medium",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		sessionFile: "session.jsonl",
		sessionId: "session-1",
		sessionName: "Desktop",
		autoCompactionEnabled: true,
		messages: [],
		pendingMessageCount: 0,
		modelRegistry: {
			getAvailable: async () => [{ provider: "openai", id: "gpt-test" }],
		},
		sessionManager: {
			getLeafId: () => null,
		},
		extensionRunner: {
			getRegisteredCommands: () => [
				{
					invocationName: "fix",
					description: "修复问题",
					sourceInfo: { type: "extension", path: "ext" },
				},
			],
		},
		promptTemplates: [
			{
				name: "review",
				description: "审查代码",
				sourceInfo: { type: "prompt", path: "prompt" },
			},
		],
		resourceLoader: {
			getSkills: () => ({
				skills: [
					{
						name: "test",
						description: "测试技能",
						sourceInfo: { type: "skill", path: "skill" },
					},
				],
			}),
		},
		prompt: async (_message: string, options: { preflightResult?: (success: boolean) => void }) => {
			options.preflightResult?.(true);
		},
		setModel: async () => {},
		cycleThinkingLevel: () => "high",
		...overrides,
	} as RuntimeCommandHandlerHost["runtime"]["session"];
}
