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

/**
 * Utility process worker 客户端工厂选项。
 */
export interface UtilityProcessWorkerClientFactoryOptions {
  /** 自定义 worker 入口文件路径。 */
  workerEntry?: string
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
  const child = utilityProcess.fork(workerEntry, [], {
    env: getCodingAgentWorkerEnv(),
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
