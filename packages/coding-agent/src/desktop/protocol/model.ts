/**
 * 本文件定义 desktop 协议中与模型和 reasoning 相关的轻量类型。
 */

export type DesktopThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModelIdentity {
	provider: string;
	id: string;
	displayName?: string;
}

export interface ModelCycleProjection {
	model: ModelIdentity;
	thinkingLevel: DesktopThinkingLevel;
	isScoped: boolean;
}

