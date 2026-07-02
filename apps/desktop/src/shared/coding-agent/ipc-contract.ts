/**
 * 本文件定义 desktop coding agent IPC 的结构化调用信封。
 */

import type { IpcError, IpcResult } from './types'

/**
 * 将成功值包装为 IPC result。
 * @param value - 成功值。
 * @returns IPC result。
 */
export function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}

/**
 * 将异常转换为结构化 IPC result。
 * @param error - 未知异常。
 * @returns IPC result。
 */
export function fail(error: unknown): IpcResult<never> {
  return { ok: false, error: toIpcError(error) }
}

/**
 * 将 IPC result 解包，失败时抛出不含 raw stack 的 Error。
 * @param result - IPC result。
 * @returns 成功值。
 */
export function unwrapIpcResult<T>(result: IpcResult<T>): T {
  if (result.ok) {
    return result.value
  }
  const error = new Error(result.error.message) as Error & { code?: string; recoverable?: boolean }
  error.name = 'CodingAgentIpcError'
  error.code = result.error.code
  error.recoverable = result.error.recoverable
  return throwWithoutStack(error)
}

/**
 * 归一化异常。
 * @param error - 未知异常。
 * @returns IPC 错误。
 */
export function toIpcError(error: unknown): IpcError {
  const message = error instanceof Error ? error.message : String(error)
  const code = classifyError(message)
  return {
    code,
    message,
    recoverable: code !== 'protocol_error' && code !== 'permission_denied'
  }
}

/**
 * 按错误消息分类。
 * @param message - 错误消息。
 * @returns 错误代码。
 */
function classifyError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('required') || normalized.includes('invalid')) {
    return 'validation_error'
  }
  if (normalized.includes('not found') || normalized.includes('no worker')) {
    return 'not_found'
  }
  if (normalized.includes('permission') || normalized.includes('denied')) {
    return 'permission_denied'
  }
  if (
    normalized.includes('crash') ||
    normalized.includes('exit') ||
    normalized.includes('closed')
  ) {
    return 'worker_crash'
  }
  if (normalized.includes('protocol')) {
    return 'protocol_error'
  }
  return 'internal_error'
}

/**
 * 抛出无 stack 的 Error。
 * @param error - Error。
 */
function throwWithoutStack(error: Error): never {
  delete error.stack
  throw error
}
