/**
 * 本文件集中延迟加载 Pi SessionManager，避免完整 IPC 注册时解析 session-manager 大模块。
 */

type SessionManagerModule = typeof import('@coding-agent-src/core/session-manager')

let sessionManagerModulePromise: Promise<SessionManagerModule> | undefined

/**
 * 按需加载 Pi session-manager 模块。
 * @returns session-manager 模块。
 */
export function loadSessionManagerModule(): Promise<SessionManagerModule> {
  sessionManagerModulePromise ??= import('@coding-agent-src/core/session-manager')
  return sessionManagerModulePromise
}

/**
 * 按 Pi session header 解析运行 cwd。
 * @param sessionFile - session JSONL 文件。
 * @param cwdFallback - 无 header cwd 时的 fallback。
 * @param cwdOverride - 显式 cwd override。
 * @returns 解析后的 cwd。
 */
export async function resolveSessionCwdLazy(
  sessionFile: string,
  cwdFallback: string,
  cwdOverride?: string
): Promise<string> {
  const { resolveSessionCwd } = await loadSessionManagerModule()
  return resolveSessionCwd(sessionFile, cwdFallback, cwdOverride)
}
