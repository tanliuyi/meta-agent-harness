/**
 * 负责把 desktop thread 启动输入转换为 Pi 同构 AgentSessionRuntime。
 */

import {
	createAgentSessionRuntime,
	createAgentSessionServices,
	createAgentSessionFromServices,
	type AgentSessionRuntime,
} from "../../core/agent-session-runtime.ts";
import { getAgentDir } from "../../config.ts";
import { resolveProjectTrusted } from "../../core/project-trust.ts";
import { SessionManager } from "../../core/session-manager.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../../core/trust-manager.ts";
import type { StartThreadInput } from "../protocol/thread.ts";
import type { ApprovalBridge } from "./approval-bridge.ts";
import { createDesktopProjectTrustContext } from "./project-trust-context.ts";

/**
 * 创建 runtime 的选项。
 */
export interface DesktopRuntimeFactoryOptions {
	/** agent 目录路径。 */
	agentDir?: string;
	/** 审批桥接实例。 */
	approvalBridge?: ApprovalBridge;
	/** 是否拥有 UI。 */
	hasUI?: boolean;
}

/**
 * 为 thread 创建 Pi AgentSessionRuntime。
 * @param input - 启动 thread 的输入。
 * @param options - 创建选项。
 * @returns AgentSessionRuntime 实例。
 */
export async function createRuntimeForThread(
	input: StartThreadInput,
	options: DesktopRuntimeFactoryOptions = {},
): Promise<AgentSessionRuntime> {
	if (!input.cwd) {
		throw new Error("cwd is required");
	}
	const agentDir = input.agentDir ?? options.agentDir ?? getAgentDir();
	const sessionManager = createSessionManager(input);
	const trustStore = new ProjectTrustStore(agentDir);
	const projectTrustByCwd = new Map<string, boolean>();
	return await createAgentSessionRuntime(
		async (runtimeOptions) => {
			const cwd = runtimeOptions.cwd;
			const hasTrustRequiringResources = hasTrustRequiringProjectResources(cwd);
			const cachedProjectTrust = projectTrustByCwd.get(cwd);
			const shouldResolveProjectTrust = cachedProjectTrust === undefined && hasTrustRequiringResources;
			const projectTrusted = shouldResolveProjectTrust
				? (input.projectTrustOverride ?? false)
				: (cachedProjectTrust ?? (!hasTrustRequiringResources || trustStore.get(cwd) === true));
			const settingsManager = SettingsManager.create(cwd, runtimeOptions.agentDir, { projectTrusted });
			const projectTrustDiagnostics: Array<{ type: "warning"; message: string }> = [];
			const services = await createAgentSessionServices({
				cwd,
				agentDir: runtimeOptions.agentDir,
				settingsManager,
				resourceLoaderReloadOptions: shouldResolveProjectTrust && input.projectTrustOverride === undefined
					? {
							resolveProjectTrust: async ({ extensionsResult }) => {
								const trusted = await resolveProjectTrusted({
									cwd,
									trustStore,
									defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
									extensionsResult,
									projectTrustContext:
										runtimeOptions.projectTrustContext ??
										createDesktopProjectTrustContext({
											cwd,
											approvalBridge: requireApprovalBridge(options.approvalBridge),
											hasUI: options.hasUI ?? true,
										}),
									onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
								});
								projectTrustByCwd.set(cwd, trusted);
								return trusted;
							},
						}
					: undefined,
			});
			const result = await createAgentSessionFromServices({
				services,
				sessionManager: runtimeOptions.sessionManager,
				sessionStartEvent: runtimeOptions.sessionStartEvent,
			});
			return {
				...result,
				services,
				diagnostics: [...projectTrustDiagnostics, ...services.diagnostics],
			};
		},
		{
			cwd: input.cwd,
			agentDir,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: input.sessionFile ? "resume" : "startup" },
		},
	);
}

/**
 * 确保存在 approval bridge，否则抛出错误。
 * @param approvalBridge - 可选的 approval bridge。
 * @returns 非空的 approval bridge。
 */
function requireApprovalBridge(approvalBridge: ApprovalBridge | undefined): ApprovalBridge {
	if (!approvalBridge) {
		throw new Error("desktop project trust requires approval bridge");
	}
	return approvalBridge;
}

/**
 * 根据输入创建或打开 session manager。
 * @param input - 启动 thread 的输入。
 * @returns SessionManager 实例。
 */
function createSessionManager(input: StartThreadInput): SessionManager {
	if (input.sessionFile) {
		return SessionManager.open(input.sessionFile, undefined, input.cwd);
	}
	return SessionManager.create(input.cwd);
}
