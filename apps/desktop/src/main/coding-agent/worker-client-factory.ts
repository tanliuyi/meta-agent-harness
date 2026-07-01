/**
 * 本文件负责创建 desktop main 使用的 coding agent worker client。
 */

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { WorkerClient } from './worker-types'
import { TransportWorkerClient } from './transport-worker-client'
import { StdioWorkerTransport } from './stdio-worker-transport'

/**
 * Worker 客户端工厂选项。
 */
export interface WorkerClientFactoryOptions {
  /** 自定义 worker 入口文件路径。 */
  workerEntry?: string
  /** 请求超时毫秒数。 */
  requestTimeoutMs?: number
}

/**
 * 创建基于 stdio 的 worker 客户端。
 * @param options - 工厂选项。
 * @returns worker 客户端实例。
 * @throws 当 worker 入口文件不存在时。
 */
export async function createStdioWorkerClient(
  options: WorkerClientFactoryOptions = {}
): Promise<WorkerClient> {
  const workerEntry = options.workerEntry ?? getDefaultWorkerEntry()
  if (!existsSync(workerEntry)) {
    throw new Error(`coding agent worker entry not found: ${workerEntry}`)
  }
  const child = spawn(process.execPath, [workerEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  return new TransportWorkerClient({
    workerId: crypto.randomUUID(),
    transport: new StdioWorkerTransport(child),
    requestTimeoutMs: options.requestTimeoutMs
  })
}

/**
 * 获取默认 worker 入口路径。
 * 优先读取环境变量 CODING_AGENT_WORKER_ENTRY，否则使用构建产物目录下的 coding-agent-worker.js。
 * @returns 默认 worker 入口路径。
 */
function getDefaultWorkerEntry(): string {
  return process.env.CODING_AGENT_WORKER_ENTRY ?? join(__dirname, 'coding-agent-worker.js')
}
