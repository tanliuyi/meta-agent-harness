/**
 * 本文件负责把 desktop thread 启动输入转换为 Pi 同构 AgentSessionRuntime。
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

export interface DesktopRuntimeFactoryOptions {
	agentDir?: string;
	approvalBridge?: ApprovalBridge;
	hasUI?: boolean;
}

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
				? false
				: (cachedProjectTrust ?? (!hasTrustRequiringResources || trustStore.get(cwd) === true));
			const settingsManager = SettingsManager.create(cwd, runtimeOptions.agentDir, { projectTrusted });
			const projectTrustDiagnostics: Array<{ type: "warning"; message: string }> = [];
			const services = await createAgentSessionServices({
				cwd,
				agentDir: runtimeOptions.agentDir,
				settingsManager,
				resourceLoaderReloadOptions: shouldResolveProjectTrust
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

function requireApprovalBridge(approvalBridge: ApprovalBridge | undefined): ApprovalBridge {
	if (!approvalBridge) {
		throw new Error("desktop project trust requires approval bridge");
	}
	return approvalBridge;
}

function createSessionManager(input: StartThreadInput): SessionManager {
	if (input.sessionFile) {
		return SessionManager.open(input.sessionFile, undefined, input.cwd);
	}
	return SessionManager.create(input.cwd);
}
