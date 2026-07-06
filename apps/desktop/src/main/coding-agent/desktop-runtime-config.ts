/**
 * Desktop-only runtime 配置。
 *
 * 这里的字段不写入 Pi settings.json，避免 CLI 读取到 Desktop 承载进程细节。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentWorkerMode } from '@shared/coding-agent/types'

/** Desktop runtime 配置。 */
export interface DesktopRuntimeConfig {
  /** Desktop worker 承载模式。 */
  workerMode: AgentWorkerMode
  /** Node sidecar 可执行文件路径。 */
  nodeSidecarExecPath?: string
}

/** Desktop runtime 配置更新输入。 */
export type DesktopRuntimeConfigInput = Partial<DesktopRuntimeConfig>

const defaultRuntimeConfig: DesktopRuntimeConfig = {
  workerMode: 'nodeSidecar'
}

/**
 * 解析 Desktop runtime 配置文件路径。
 * @returns 配置文件路径。
 */
export function getDesktopRuntimeConfigPath(): string {
  return join(app.getPath('userData'), 'desktop-runtime.json')
}

/**
 * 读取 Desktop runtime 配置，并应用环境变量覆盖。
 * @param configPath - 可选配置文件路径。
 * @returns Desktop runtime 配置。
 */
export function readDesktopRuntimeConfig(configPath = getDesktopRuntimeConfigPath()): DesktopRuntimeConfig {
  const fileConfig = readDesktopRuntimeConfigFile(configPath)
  return normalizeDesktopRuntimeConfig({
    ...defaultRuntimeConfig,
    ...fileConfig,
    ...getDesktopRuntimeConfigEnvOverride()
  })
}

/**
 * 写入 Desktop runtime 配置文件。
 * @param input - 配置更新。
 * @param configPath - 可选配置文件路径。
 * @returns 写入后的文件配置，不含环境变量覆盖。
 */
export function writeDesktopRuntimeConfig(
  input: DesktopRuntimeConfigInput,
  configPath = getDesktopRuntimeConfigPath()
): DesktopRuntimeConfig {
  const next = normalizeDesktopRuntimeConfig({
    ...defaultRuntimeConfig,
    ...readDesktopRuntimeConfigFile(configPath),
    ...input
  })
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/**
 * 读取配置文件，不应用环境变量。
 * @param configPath - 配置文件路径。
 * @returns 文件内配置。
 */
function readDesktopRuntimeConfigFile(configPath: string): DesktopRuntimeConfigInput {
  if (!existsSync(configPath)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as DesktopRuntimeConfigInput
  } catch {
    return {}
  }
}

/**
 * 获取环境变量配置覆盖。
 * @returns 环境变量覆盖。
 */
function getDesktopRuntimeConfigEnvOverride(): DesktopRuntimeConfigInput {
  return {
    ...(process.env.CODING_AGENT_WORKER_MODE
      ? { workerMode: process.env.CODING_AGENT_WORKER_MODE as AgentWorkerMode }
      : {}),
    ...(process.env.CODING_AGENT_NODE_SIDECAR_EXEC_PATH
      ? { nodeSidecarExecPath: process.env.CODING_AGENT_NODE_SIDECAR_EXEC_PATH }
      : {})
  }
}

/**
 * 标准化 Desktop runtime 配置。
 * @param input - 原始配置。
 * @returns 标准配置。
 */
function normalizeDesktopRuntimeConfig(input: DesktopRuntimeConfigInput): DesktopRuntimeConfig {
  const workerMode = input.workerMode === 'utilityProcess' ? 'utilityProcess' : 'nodeSidecar'
  return {
    workerMode,
    ...(input.nodeSidecarExecPath?.trim()
      ? { nodeSidecarExecPath: input.nodeSidecarExecPath.trim() }
      : {})
  }
}
