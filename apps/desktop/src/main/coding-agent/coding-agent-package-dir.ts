/**
 * Resolves the packaged coding-agent asset directory used by the bundled desktop worker.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

const resourcePackageRelativePath = join('resources', 'pi-coding-agent')
const packagedPackageRelativePath = 'pi-coding-agent'
let loginShellPathResolved = false
let cachedLoginShellPath: string | undefined

export function resolveCodingAgentPackageDir(): string {
  if (process.env.PI_PACKAGE_DIR) {
    return process.env.PI_PACKAGE_DIR
  }

  for (const candidate of getCodingAgentPackageDirCandidates()) {
    if (existsSync(join(candidate, 'package.json'))) {
      return candidate
    }
  }

  return resolve(process.cwd(), resourcePackageRelativePath)
}

export function getCodingAgentWorkerEnv(
  options: {
    stripElectronRunAsNode?: boolean
    executablePath?: string
    loginShellPath?: string
  } = {}
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (options.stripElectronRunAsNode) {
    delete env.ELECTRON_RUN_AS_NODE
  }
  // 该标记只属于扩展通过 Desktop launcher 启动的 CLI 子进程。内部 worker
  // 必须始终走 IPC 模式，不能继承父 CLI 或测试进程中的兼容模式标记。
  delete env.META_AGENT_DESKTOP_PI_CLI
  env.PI_PACKAGE_DIR = resolveCodingAgentPackageDir()
  env.PATH = mergeWorkerPath(
    env.PATH,
    options.loginShellPath ?? resolveLoginShellPath(env),
    options.executablePath
  )
  return env
}

/**
 * Finder 等 GUI 启动方式不会继承登录 shell PATH。worker 和它启动的 shell tool
 * 必须看到用户正常终端中的命令，同时选定的 Node 所在目录必须始终可执行。
 */
export function mergeWorkerPath(
  currentPath: string | undefined,
  loginShellPath: string | undefined,
  executablePath?: string
): string | undefined {
  const entries = [
    ...(executablePath ? [dirname(executablePath)] : []),
    ...(loginShellPath?.split(delimiter) ?? []),
    ...(currentPath?.split(delimiter) ?? [])
  ].filter(Boolean)
  return entries.length > 0 ? [...new Set(entries)].join(delimiter) : undefined
}

function resolveLoginShellPath(env: NodeJS.ProcessEnv): string | undefined {
  if (loginShellPathResolved) return cachedLoginShellPath
  loginShellPathResolved = true
  if (process.platform === 'win32') return undefined
  const shell = env.SHELL?.trim() || '/bin/sh'
  const marker = '__META_AGENT_PATH__='
  try {
    const output = execFileSync(shell, ['-ilc', `printf '\\n${marker}%s\\n' "$PATH"`], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    })
    cachedLoginShellPath = output
      .split(/\r?\n/)
      .find((line) => line.startsWith(marker))
      ?.slice(marker.length)
    return cachedLoginShellPath
  } catch {
    return undefined
  }
}

export function installCodingAgentPackageDirEnv(): void {
  process.env.PI_PACKAGE_DIR = resolveCodingAgentPackageDir()
}

function getCodingAgentPackageDirCandidates(): string[] {
  const candidates: string[] = []

  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, packagedPackageRelativePath))
  }

  candidates.push(resolve(process.cwd(), resourcePackageRelativePath))
  candidates.push(resolve(__dirname, '..', '..', resourcePackageRelativePath))
  candidates.push(resolve(__dirname, '..', '..', '..', resourcePackageRelativePath))
  candidates.push(resolve(__dirname, '..', '..', '..', '..', 'packages', 'coding-agent'))
  candidates.push(resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'coding-agent'))

  return candidates
}
