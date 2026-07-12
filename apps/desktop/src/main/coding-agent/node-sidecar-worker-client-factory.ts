/**
 * 本文件负责创建普通 Node sidecar worker client。
 */

import { fork } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { WorkerClient } from './worker-types'
import { TransportWorkerClient } from './transport-worker-client'
import { NodeIpcWorkerTransport } from './node-ipc-worker-transport'
import { getCodingAgentWorkerEnv } from './coding-agent-package-dir'
import { createDesktopPiCliShim } from './desktop-pi-cli-shim'

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
  const nodeExecPath = options.nodeExecPath ?? resolveNodeSidecarExecPath()
  const workerEnv = getCodingAgentWorkerEnv({
    stripElectronRunAsNode: true,
    executablePath: nodeExecPath
  })
  // 扩展仍按标准 Pi 约定执行 `pi`。这里把 Desktop 私有 launcher 放到 worker
  // PATH 最前面，保证所有扩展统一回到同一个 sidecar，而不会探测或调用全局 Pi。
  const { env } = createDesktopPiCliShim({
    nodeExecPath,
    workerEntry,
    env: workerEnv
  })
  const child = fork(workerEntry, [], {
    execPath: nodeExecPath,
    env,
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
export function resolveNodeSidecarExecPath(
  env: NodeJS.ProcessEnv = process.env,
  resolveFromLoginShell: (env: NodeJS.ProcessEnv) => string | undefined = resolveNodeFromLoginShell,
  isElectron = Boolean(process.versions.electron)
): string {
  const configuredPath = env.CODING_AGENT_NODE_SIDECAR_EXEC_PATH?.trim() || env.NODE_BINARY?.trim()
  if (configuredPath) {
    return configuredPath
  }

  if (!isElectron && isExecutableFile(process.execPath)) {
    return process.execPath
  }

  const pathNode = findExecutableOnPath('node', env.PATH)
  if (pathNode) {
    return pathNode
  }

  const windowsNode = findWindowsNodeInstallation(env)
  if (windowsNode) {
    return windowsNode
  }

  const shellNode = resolveFromLoginShell(env)
  if (shellNode && isExecutableFile(shellNode)) {
    return shellNode
  }

  throw new Error(
    'Node sidecar runtime not found. Configure a standard Node executable in Settings > Agent > Runtime.'
  )
}

function findExecutableOnPath(name: string, pathValue: string | undefined): string | undefined {
  if (!pathValue) {
    return undefined
  }
  const executableName = process.platform === 'win32' ? `${name}.exe` : name
  return pathValue
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, executableName))
    .find(isExecutableFile)
}

function findWindowsNodeInstallation(env: NodeJS.ProcessEnv): string | undefined {
  if (process.platform !== 'win32') {
    return undefined
  }
  const candidates = [
    env.NVM_SYMLINK ? join(env.NVM_SYMLINK, 'node.exe') : undefined,
    env.VOLTA_HOME ? join(env.VOLTA_HOME, 'bin', 'node.exe') : undefined,
    env.SCOOP ? join(env.SCOOP, 'apps', 'nodejs', 'current', 'node.exe') : undefined,
    env.ProgramFiles ? join(env.ProgramFiles, 'nodejs', 'node.exe') : undefined,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe') : undefined
  ]
  return candidates
    .filter((candidate): candidate is string => Boolean(candidate))
    .find(isExecutableFile)
}

function resolveNodeFromLoginShell(env: NodeJS.ProcessEnv): string | undefined {
  if (process.platform === 'win32') {
    return undefined
  }
  const shell = env.SHELL?.trim() || '/bin/sh'
  try {
    const output = execFileSync(shell, ['-ilc', 'command -v node'], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    })
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => isAbsolute(line) && isExecutableFile(line))
  } catch {
    return undefined
  }
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
