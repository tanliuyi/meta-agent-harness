/**
 * 本文件测试 Electron utilityProcess worker client 工厂。
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerHangInfo } from '../worker-types'
import {
  createUtilityProcessWorkerClient,
  resolveUtilityWorkerEntry
} from '../utility-process-worker-client-factory'

const forkMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  utilityProcess: {
    fork: forkMock
  }
}))

describe('createUtilityProcessWorkerClient', () => {
  afterEach(() => {
    forkMock.mockReset()
    vi.unstubAllEnvs()
  })

  it('通过 Electron utilityProcess 启动 worker 子进程', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-worker-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeUtilityProcess()
    forkMock.mockReturnValue(child)

    await createUtilityProcessWorkerClient({ workerEntry, piCliWorkerEntry: workerEntry })

    expect(forkMock).toHaveBeenCalledWith(workerEntry, [], {
      env: expect.objectContaining({
        PI_PACKAGE_DIR: expect.any(String)
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      serviceName: 'Coding Agent Worker'
    })
    const workerEnv = forkMock.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv
    expect(workerEnv.PATH?.split(delimiter)[0]).toMatch(/meta-agent-desktop-pi-/)
    expect(workerEnv.PI_SUBAGENT_PI_BINARY).toBeUndefined()
  })

  it('缺少 Desktop CLI sidecar 时启动即明确失败', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'meta-agent-worker-'))
    const workerEntry = join(fixtureDir, 'worker.js')
    writeFileSync(workerEntry, '')

    await expect(
      createUtilityProcessWorkerClient({
        workerEntry,
        piCliWorkerEntry: join(fixtureDir, 'missing-cli-worker.js')
      })
    ).rejects.toThrow('coding agent CLI compatibility worker entry not found')
    expect(forkMock).not.toHaveBeenCalled()
  })

  it('默认接入 worker 无消息 hang 检测', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-worker-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeUtilityProcess()
    const hangInfo: WorkerHangInfo[] = []
    forkMock.mockReturnValue(child)

    const client = await createUtilityProcessWorkerClient({
      workerEntry,
      piCliWorkerEntry: workerEntry,
      inactivityTimeoutMs: 20,
      requestTimeoutMs: 20
    })
    client.onHang?.((info) => hangInfo.push(info))

    await waitUntil(() => hangInfo.length === 1)

    expect(hangInfo[0]).toMatchObject({
      workerId: client.workerId
    })
    expect(hangInfo[0]?.silentMs).toBeGreaterThanOrEqual(20)
    expect(child.kill).toHaveBeenCalled()
  })

  it('主动 stop 后 utility process exit 不会触发 crash exit 事件', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-worker-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeUtilityProcess()
    const exits: Array<{ reason: string }> = []
    forkMock.mockReturnValue(child)

    const client = await createUtilityProcessWorkerClient({
      workerEntry,
      piCliWorkerEntry: workerEntry
    })
    client.onExit?.((info) => exits.push({ reason: info.reason }))
    await client.stop('idle')
    child.emit('exit', null)

    expect(exits).toEqual([])
  })

  it('过滤 utility worker SQLite experimental warning 诊断噪声', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-worker-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeUtilityProcess()
    const exits: Array<{ reason: string }> = []
    forkMock.mockReturnValue(child)

    const client = await createUtilityProcessWorkerClient({
      workerEntry,
      piCliWorkerEntry: workerEntry
    })
    client.onExit?.((info) => exits.push({ reason: info.reason }))
    child.stderr.write(
      '(node:31008) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n'
    )
    child.stderr.write('(Use `node --trace-warnings ...` to show where the warning was created)\n')
    child.emit('exit', 1)

    expect(exits).toEqual([{ reason: 'worker exited: code=1' }])
  })

  it('默认 worker 入口兼容 electron-vite chunks 目录', async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'meta-agent-dist-'))
    const chunksDir = join(distDir, 'chunks')
    const workerEntry = join(distDir, 'coding-agent-utility-worker.js')
    mkdirSync(chunksDir)
    writeFileSync(workerEntry, '')

    expect(resolveUtilityWorkerEntry(chunksDir)).toBe(workerEntry)
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
