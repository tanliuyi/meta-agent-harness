/**
 * 本文件负责创建 desktop main 使用的 Electron utilityProcess worker client。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { utilityProcess } from 'electron'
import type { WorkerClient } from './worker-types'
import { TransportWorkerClient } from './transport-worker-client'
import { UtilityProcessWorkerTransport } from './utility-process-worker-transport'
import { getCodingAgentWorkerEnv } from './coding-agent-package-dir'
import { createDesktopPiCliShim } from './desktop-pi-cli-shim'
import { resolveNodeSidecarWorkerEntry } from './node-sidecar-worker-client-factory'

/**
 * Utility process worker 客户端工厂选项。
 */
export interface UtilityProcessWorkerClientFactoryOptions {
  /** 自定义 worker 入口文件路径。 */
  workerEntry?: string
  /** 自定义扩展 `pi` 命令使用的 CLI sidecar 入口；主要用于测试与特殊打包布局。 */
  piCliWorkerEntry?: string
  /** 请求超时毫秒数。 */
  requestTimeoutMs?: number
  /** 无消息超时毫秒数，默认 2 分钟。 */
  inactivityTimeoutMs?: number
}

/**
 * 创建基于 Electron utilityProcess 的 worker 客户端。
 * @param options - 工厂选项。
 * @returns worker 客户端实例。
 * @throws 当 worker 入口文件不存在时。
 */
export async function createUtilityProcessWorkerClient(
  options: UtilityProcessWorkerClientFactoryOptions = {}
): Promise<WorkerClient> {
  const workerEntry = options.workerEntry ?? resolveUtilityWorkerEntry()
  if (!existsSync(workerEntry)) {
    throw new Error(`coding agent utility worker entry not found: ${workerEntry}`)
  }
  const piCliWorkerEntry = options.piCliWorkerEntry ?? resolveNodeSidecarWorkerEntry()
  if (!existsSync(piCliWorkerEntry)) {
    throw new Error(`coding agent CLI compatibility worker entry not found: ${piCliWorkerEntry}`)
  }
  const workerEnv = getCodingAgentWorkerEnv({ executablePath: process.execPath })
  const { env } = createDesktopPiCliShim({
    // utilityProcess 本身运行在 Electron 中；launcher 通过 ELECTRON_RUN_AS_NODE
    // 复用应用自带的可执行文件，并转到同一构建中的 Node sidecar。不能退回 PATH
    // 查找外部 pi，否则 utilityProcess 与 nodeSidecar 会再次产生版本和资源分裂。
    nodeExecPath: process.execPath,
    workerEntry: piCliWorkerEntry,
    env: workerEnv,
    electronRunAsNode: true
  })
  const child = utilityProcess.fork(workerEntry, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    serviceName: 'Coding Agent Worker'
  })
  return new TransportWorkerClient({
    workerId: crypto.randomUUID(),
    transport: new UtilityProcessWorkerTransport(child),
    requestTimeoutMs: options.requestTimeoutMs,
    inactivityTimeoutMs: options.inactivityTimeoutMs ?? 120000
  })
}

/**
 * 获取默认 utility worker 入口路径。
 * 优先读取环境变量 CODING_AGENT_UTILITY_WORKER_ENTRY，否则使用构建产物目录下的 coding-agent-utility-worker.js。
 * @returns 默认 worker 入口路径。
 */
export function resolveUtilityWorkerEntry(baseDir = __dirname): string {
  if (process.env.CODING_AGENT_UTILITY_WORKER_ENTRY) {
    return process.env.CODING_AGENT_UTILITY_WORKER_ENTRY
  }

  const candidates = [
    join(baseDir, 'coding-agent-utility-worker.js'),
    join(baseDir, '..', 'coding-agent-utility-worker.js')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}
