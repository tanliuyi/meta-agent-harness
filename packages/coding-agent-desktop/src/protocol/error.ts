/**
 * 定义 worker、pool 与 IPC 共用的结构化错误。
 */

/** Desktop 错误码联合类型。 */
export type DesktopErrorCode =
  | 'invalid_command'
  | 'invalid_state'
  | 'thread_not_found'
  | 'worker_not_found'
  | 'worker_crashed'
  | 'worker_exited'
  | 'protocol_error'
  | 'timeout'
  | 'permission_denied'
  | 'runtime_error'

/** Desktop 结构化错误。 */
export interface DesktopError {
  /** 错误码。 */
  code: DesktopErrorCode
  /** 错误消息。 */
  message: string
  /** 是否可恢复。 */
  recoverable: boolean
  /** 额外错误细节。 */
  details?: unknown
}

/**
 * 创建 DesktopError 实例。
 * @param code - 错误码。
 * @param message - 错误消息。
 * @param recoverable - 是否可恢复。
 * @returns 结构化错误对象。
 */
export function createDesktopError(
  code: DesktopErrorCode,
  message: string,
  recoverable: boolean
): DesktopError {
  return { code, message, recoverable }
}
