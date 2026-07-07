/**
 * 本文件负责创建普通 Node sidecar worker client。
 */

import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkerClient } from './worker-types'
import { TransportWorkerClient } from './transport-worker-client'
import { NodeIpcWorkerTransport } from './node-ipc-worker-transport'
import { getCodingAgentWorkerEnv } from './coding-agent-package-dir'

/** Node sidecar worker 客户端工厂选项。 */
export interface NodeSidecarWorkerClientFactoryOptions {
  /** 自定义 worker 入口文件路径。 */
  workerEntry?: string
  /** 普通 Node 可执行文件路径；默认使用环境变量或 PATH 中的 node。 */
  nodeExecPath?: string
  /** 请求超时毫秒数。 */
  requestTimeoutMs?: number
  /** 无消息超时毫秒数，默认 2 分钟。 */
  inactivityTimeoutMs?: number
}

/**
 * 创建基于普通 Node 子进程的 worker 客户端。
 * @param options - 工厂选项。
 * @returns worker 客户端实例。
 */
export async function createNodeSidecarWorkerClient(
  options: NodeSidecarWorkerClientFactoryOptions = {}
): Promise<WorkerClient> {
  const workerEntry = options.workerEntry ?? resolveNodeSidecarWorkerEntry()
  if (!existsSync(workerEntry)) {
    throw new Error(`coding agent node sidecar worker entry not found: ${workerEntry}`)
  }
  const child = fork(workerEntry, [], {
    execPath: options.nodeExecPath ?? resolveNodeSidecarExecPath(),
    env: getCodingAgentWorkerEnv(),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  })
  return new TransportWorkerClient({
    workerId: crypto.randomUUID(),
    transport: new NodeIpcWorkerTransport(child),
    requestTimeoutMs: options.requestTimeoutMs,
    inactivityTimeoutMs: options.inactivityTimeoutMs ?? 120000
  })
}

/**
 * 获取默认 Node sidecar worker 入口路径。
 * @returns worker 入口路径。
 */
export function resolveNodeSidecarWorkerEntry(baseDir = __dirname): string {
  if (process.env.CODING_AGENT_NODE_SIDECAR_WORKER_ENTRY) {
    return process.env.CODING_AGENT_NODE_SIDECAR_WORKER_ENTRY
  }

  const candidates = [
    ...getUnpackedBaseDirCandidates(baseDir).flatMap((unpackedBaseDir) => [
      join(unpackedBaseDir, 'coding-agent-node-sidecar-worker.js'),
      join(unpackedBaseDir, '..', 'coding-agent-node-sidecar-worker.js')
    ]),
    join(baseDir, 'coding-agent-node-sidecar-worker.js'),
    join(baseDir, '..', 'coding-agent-node-sidecar-worker.js')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

/**
 * 将 Electron app.asar 内路径映射到 app.asar.unpacked。
 * 普通 Node 子进程无法加载 asar 虚拟路径，必须执行解包后的实体文件。
 */
function getUnpackedBaseDirCandidates(baseDir: string): string[] {
  if (!baseDir.includes('app.asar') || baseDir.includes('app.asar.unpacked')) {
    return []
  }
  return [baseDir.replace('app.asar', 'app.asar.unpacked')]
}

/**
 * 获取普通 Node sidecar 可执行文件。
 * @returns Node 可执行文件。
 */
export function resolveNodeSidecarExecPath(): string {
  return process.env.CODING_AGENT_NODE_SIDECAR_EXEC_PATH ?? process.env.NODE_BINARY ?? 'node'
}
