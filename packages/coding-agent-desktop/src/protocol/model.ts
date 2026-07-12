/**
 * 定义 desktop 协议中与模型相关的轻量投影类型。
 */

/** 模型身份标识。 */
export interface ModelIdentity {
  /** 模型提供商。 */
  provider: string
  /** 模型 ID。 */
  id: string
  /** 显示名称。 */
  displayName?: string
}
