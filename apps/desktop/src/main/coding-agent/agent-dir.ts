/**
 * agent-dir.ts - Desktop metadata 路径使用的轻量 Pi agentDir 解析。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 获取 Pi-compatible agentDir。
 *
 * 这里刻意避免导入完整 agent runtime config，防止 main 首包或完整 IPC
 * 注册路径解析 CLI 安装检测、自更新、包资源路径等与 desktop metadata 无关的逻辑。
 */
export function getDesktopAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR
  return envDir ? normalizeDesktopAgentDir(envDir) : join(homedir(), '.pi', 'agent')
}

function normalizeDesktopAgentDir(input: string): string {
  if (input === '~') {
    return homedir()
  }
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return join(homedir(), input.slice(2))
  }
  if (input.startsWith('file://')) {
    return fileURLToPath(input)
  }
  return input
}
