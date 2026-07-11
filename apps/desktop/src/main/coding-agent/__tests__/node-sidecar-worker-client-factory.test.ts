/**
 * 本文件测试普通 Node sidecar worker client 工厂。
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
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
    vi.stubEnv('PI_SUBAGENT_PI_BINARY', '/tmp/external-pi')
    vi.stubEnv('META_AGENT_DESKTOP_PI_CLI', '1')

    await createNodeSidecarWorkerClient({
      workerEntry,
      nodeExecPath: '/opt/node/bin/node'
    })

    expect(forkMock).toHaveBeenCalledWith(
      workerEntry,
      [],
      expect.objectContaining({
        execPath: '/opt/node/bin/node',
        env: expect.objectContaining({ PI_PACKAGE_DIR: expect.any(String) }),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })
    )
    const workerEnv = forkMock.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv
    expect(workerEnv).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(workerEnv).not.toHaveProperty('META_AGENT_DESKTOP_PI_CLI')
    expect(workerEnv.PI_SUBAGENT_PI_BINARY).toBeUndefined()
    expect(workerEnv.PATH?.split(delimiter)[0]).toMatch(/meta-agent-desktop-pi-/)
  })

  it('默认接入 worker 无消息 hang 检测', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-sidecar-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeChildProcess()
    const hangInfo: WorkerHangInfo[] = []
    forkMock.mockReturnValue(child)

    const client = await createNodeSidecarWorkerClient({
      workerEntry,
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

  it('主动 stop 后 child SIGTERM exit 不会触发 crash exit 事件', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-sidecar-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeChildProcess()
    const exits: Array<{ reason: string }> = []
    forkMock.mockReturnValue(child)

    const client = await createNodeSidecarWorkerClient({ workerEntry })
    client.onExit?.((info) => exits.push({ reason: info.reason }))
    await client.stop('idle')
    child.emit('exit', null, 'SIGTERM')

    expect(exits).toEqual([])
  })

  it('过滤 node SQLite experimental warning 诊断噪声', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-sidecar-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeChildProcess()
    const exits: Array<{ reason: string }> = []
    forkMock.mockReturnValue(child)

    const client = await createNodeSidecarWorkerClient({ workerEntry })
    client.onExit?.((info) => exits.push({ reason: info.reason }))
    child.stderr.write(
      '(node:31008) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n'
    )
    child.stderr.write('(Use `node --trace-warnings ...` to show where the warning was created)\n')
    child.emit('exit', 1, null)

    expect(exits).toEqual([{ reason: 'node sidecar exited: code=1 signal=null' }])
  })

  it('默认 worker 入口兼容 electron-vite chunks 目录', async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'meta-agent-dist-'))
    const chunksDir = join(distDir, 'chunks')
    const workerEntry = join(distDir, 'coding-agent-node-sidecar-worker.js')
    mkdirSync(chunksDir)
    writeFileSync(workerEntry, '')

    expect(resolveNodeSidecarWorkerEntry(chunksDir)).toBe(workerEntry)
  })

  it('打包后优先使用 app.asar.unpacked 中的 sidecar worker', async () => {
    const resourcesDir = mkdtempSync(join(tmpdir(), 'meta-agent-resources-'))
    const unpackedMainDir = join(resourcesDir, 'app.asar.unpacked', 'out', 'main')
    const asarMainDir = join(resourcesDir, 'app.asar', 'out', 'main')
    const workerEntry = join(unpackedMainDir, 'coding-agent-node-sidecar-worker.js')
    mkdirSync(unpackedMainDir, { recursive: true })
    writeFileSync(workerEntry, '')

    expect(resolveNodeSidecarWorkerEntry(asarMainDir)).toBe(workerEntry)
  })

  it('通过环境变量配置 Node 可执行文件', () => {
    vi.stubEnv('CODING_AGENT_NODE_SIDECAR_EXEC_PATH', '/tmp/node')

    expect(resolveNodeSidecarExecPath()).toBe('/tmp/node')
  })

  it('未配置外部 Node 时复用开发进程的标准 Node', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-sidecar-')), 'worker.js')
    writeFileSync(workerEntry, '')
    forkMock.mockReturnValue(createFakeChildProcess())
    vi.stubEnv('CODING_AGENT_NODE_SIDECAR_EXEC_PATH', '')
    vi.stubEnv('NODE_BINARY', '')

    expect(resolveNodeSidecarExecPath()).toBe(process.execPath)
    await createNodeSidecarWorkerClient({ workerEntry })

    expect(forkMock).toHaveBeenCalledWith(
      workerEntry,
      [],
      expect.objectContaining({
        execPath: process.execPath,
        env: expect.not.objectContaining({ ELECTRON_RUN_AS_NODE: '1' })
      })
    )
  })

  it('Finder 环境 PATH 无 Node 时从登录 shell 解析标准 Node', () => {
    const resolveFromLoginShell = vi.fn(() => process.execPath)

    expect(
      resolveNodeSidecarExecPath(
        { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' },
        resolveFromLoginShell,
        true
      )
    ).toBe(process.execPath)
    expect(resolveFromLoginShell).toHaveBeenCalledWith({
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/zsh'
    })
  })

  it('把异步 IPC send 错误转换为 worker 启动失败', async () => {
    const workerEntry = join(mkdtempSync(join(tmpdir(), 'meta-agent-sidecar-')), 'worker.js')
    writeFileSync(workerEntry, '')
    const child = createFakeChildProcess()
    forkMock.mockReturnValue(child)
    const client = await createNodeSidecarWorkerClient({ workerEntry })

    const start = client.startThread({ threadId: 'thread-a', cwd: '/tmp/project-a' })
    const callback = child.send.mock.calls[0]?.[1] as ((error: Error | null) => void) | undefined
    callback?.(new Error('write EPIPE'))

    await expect(start).rejects.toThrow('node sidecar IPC send failed: write EPIPE')
    expect(child.disconnect).toHaveBeenCalledOnce()
    expect(child.kill).toHaveBeenCalledOnce()
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
