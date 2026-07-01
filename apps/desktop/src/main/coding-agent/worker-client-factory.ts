/**
 * 本文件负责创建 desktop main 使用的 coding agent worker client。
 */

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { WorkerClient } from './worker-types'
import { TransportWorkerClient } from './transport-worker-client'
import { StdioWorkerTransport } from './stdio-worker-transport'

export interface WorkerClientFactoryOptions {
  workerEntry?: string
  requestTimeoutMs?: number
}

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

function getDefaultWorkerEntry(): string {
  return process.env.CODING_AGENT_WORKER_ENTRY ?? join(__dirname, 'coding-agent-worker.js')
}
