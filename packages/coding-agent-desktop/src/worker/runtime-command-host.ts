/**
 * 定义 runtime command handler 共享的 host 契约。
 */

import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { ProjectTrustContext } from "@earendil-works/pi-coding-agent";

/** Runtime 命令 handler 共享的 host。 */
export interface RuntimeCommandHandlerHost {
	/** 当前 agent session runtime 实例。 */
	runtime: AgentSessionRuntime;
	/** 重新绑定会话事件的回调（可选）。 */
	rebindSession?: () => Promise<void>;
	/** 为 session replacement 后的新 cwd 创建 Project trust 上下文。 */
	projectTrustContextFactory?: (cwd: string) => ProjectTrustContext;
}

/**
 * 如果操作未被取消，则重新绑定会话事件。
 * @param host - runtime 命令 host。
 * @param cancelled - 操作是否被取消。
 */
export async function rebindIfNeeded(host: RuntimeCommandHandlerHost, cancelled: boolean): Promise<void> {
	if (!cancelled) {
		await host.rebindSession?.();
	}
}
