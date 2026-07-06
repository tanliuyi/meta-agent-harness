/**
 * 本文件测试普通 Node sidecar worker client 工厂。
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerHangInfo } from '../worker-types'
import {
  createNodeSidecarWorkerClient,
  resolveNodeSidecarExecPath,
  resolveNodeSidecarWorkerEntry
} from '../node-sidecar-worker-client-factory'

const forkMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  fork: forkMock
}))

describe('createNodeSidecarWorkerClient', () => {
  afterEach(() => {
    forkMock.mockReset()
    vi.unstubAllEnvs()
  })

  it('通过普通 Node 子进程启动 sidecar worker', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-sidecar-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeChildProcess()
    forkMock.mockReturnValue(child)

    await createNodeSidecarWorkerClient({
      workerEntry,
      nodeExecPath: '/opt/node/bin/node'
    })

    expect(forkMock).toHaveBeenCalledWith(workerEntry, [], {
      execPath: '/opt/node/bin/node',
      env: expect.objectContaining({
        ...process.env,
        PI_PACKAGE_DIR: expect.any(String)
      }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
  })

  it('默认接入 worker 无消息 hang 检测', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-sidecar-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeChildProcess()
    const hangInfo: WorkerHangInfo[] = []
    forkMock.mockReturnValue(child)

    const client = await createNodeSidecarWorkerClient({
      workerEntry,
      inactivityTimeoutMs: 20
    })
    client.onHang?.((info) => hangInfo.push(info))

    await waitUntil(() => hangInfo.length === 1)

    expect(hangInfo[0]).toMatchObject({
      workerId: client.workerId
    })
    expect(hangInfo[0]?.silentMs).toBeGreaterThanOrEqual(20)
    expect(child.kill).toHaveBeenCalled()
  })

  it('默认 worker 入口兼容 electron-vite chunks 目录', async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'meta-agent-dist-'))
    const chunksDir = join(distDir, 'chunks')
    const workerEntry = join(distDir, 'coding-agent-node-sidecar-worker.js')
    mkdirSync(chunksDir)
    writeFileSync(workerEntry, '')

    expect(resolveNodeSidecarWorkerEntry(chunksDir)).toBe(workerEntry)
  })

  it('通过环境变量配置 Node 可执行文件', () => {
    vi.stubEnv('CODING_AGENT_NODE_SIDECAR_EXEC_PATH', '/tmp/node')

    expect(resolveNodeSidecarExecPath()).toBe('/tmp/node')
  })
})

function createFakeChildProcess(): EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  connected: boolean
  send: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    connected: boolean
    send: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.connected = true
  child.send = vi.fn()
  child.disconnect = vi.fn(() => {
    child.connected = false
  })
  child.kill = vi.fn()
  return child
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('condition was not met')
}
