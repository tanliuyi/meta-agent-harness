/**
 * 本文件定义 runtime command handler 共享的 host 契约。
 */

import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";

export interface RuntimeCommandHandlerHost {
	runtime: AgentSessionRuntime;
	rebindSession?: () => Promise<void>;
}

export async function rebindIfNeeded(host: RuntimeCommandHandlerHost, cancelled: boolean): Promise<void> {
	if (!cancelled) {
		await host.rebindSession?.();
	}
}
