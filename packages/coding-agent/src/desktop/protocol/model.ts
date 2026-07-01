/**
 * 定义 desktop 协议中与模型和 reasoning 相关的轻量类型。
 */

/** Desktop thinking 级别。 */
export type DesktopThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** 模型身份标识。 */
export interface ModelIdentity {
	/** 模型提供商。 */
	provider: string;
	/** 模型 ID。 */
	id: string;
	/** 显示名称。 */
	displayName?: string;
}

/** 模型 cycle 投影结果。 */
export interface ModelCycleProjection {
	/** 当前模型身份。 */
	model: ModelIdentity;
	/** 当前 thinking 级别。 */
	thinkingLevel: DesktopThinkingLevel;
	/** 是否为作用域模型。 */
	isScoped: boolean;
}
