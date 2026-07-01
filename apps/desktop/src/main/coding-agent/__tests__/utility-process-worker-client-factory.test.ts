/**
 * 本文件测试 Electron utilityProcess worker client 工厂。
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
