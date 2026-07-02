/**
 * 本文件测试 Electron utilityProcess worker client 工厂。
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerHangInfo } from '../worker-types'
import { createUtilityProcessWorkerClient } from '../utility-process-worker-client-factory'

const forkMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  utilityProcess: {
    fork: forkMock
  }
}))

describe('createUtilityProcessWorkerClient', () => {
  afterEach(() => {
    forkMock.mockReset()
  })

  it('通过 Electron utilityProcess 启动 worker 子进程', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-worker-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeUtilityProcess()
    forkMock.mockReturnValue(child)

    await createUtilityProcessWorkerClient({ workerEntry })

    expect(forkMock).toHaveBeenCalledWith(workerEntry, [], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      serviceName: 'Coding Agent Worker'
    })
  })

  it('默认接入 worker 无消息 hang 检测', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-worker-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeUtilityProcess()
    const hangInfo: WorkerHangInfo[] = []
    forkMock.mockReturnValue(child)

    const client = await createUtilityProcessWorkerClient({
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
})

function createFakeUtilityProcess(): EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  postMessage: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    postMessage: ReturnType<typeof vi.fn>
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.postMessage = vi.fn()
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
