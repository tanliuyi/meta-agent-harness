/**
 * 为第三方扩展创建由 Desktop 托管的 `pi` 命令。
 *
 * 兼容层必须放在进程环境而不是具体扩展中：大量现有 Pi 扩展会直接执行
 * `spawn("pi", args)`，Desktop 既不能要求它们改用私有 API，也不能假设用户安装了
 * 全局 Pi CLI。因此 worker 暴露给扩展的 PATH 必须优先解析到这里生成的 launcher。
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

export const DESKTOP_PI_CLI_ENV = 'META_AGENT_DESKTOP_PI_CLI'

interface DesktopPiCliShimOptions {
  nodeExecPath: string
  workerEntry: string
  env?: NodeJS.ProcessEnv
  electronRunAsNode?: boolean
  platform?: NodeJS.Platform
}

interface DesktopPiCliShim {
  binDir: string
  env: NodeJS.ProcessEnv
}

const shimDirectories = new Set<string>()
let cleanupRegistered = false

/**
 * 生成私有 launcher 并把目录放到 PATH 最前面。
 *
 * launcher 始终使用当前 Desktop 已选定的 Node 和同一份 sidecar 构建产物，确保
 * RPC、JSON、print 以及其他 argv 协议和主 worker 使用完全相同的 coding-agent
 * 版本与资源。这里还主动移除 PI_SUBAGENT_PI_BINARY，避免某个扩展的可选优化配置
 * 绕过通用 PATH 兼容层，重新调用用户机器上的外部 Pi。
 */
export function createDesktopPiCliShim(options: DesktopPiCliShimOptions): DesktopPiCliShim {
  const platform = options.platform ?? process.platform
  const binDir = mkdtempSync(join(tmpdir(), 'meta-agent-desktop-pi-'))
  const env = { ...(options.env ?? process.env) }

  if (platform === 'win32') {
    writeWindowsLaunchers(binDir, options)
  } else {
    writePosixLauncher(binDir, options)
  }

  prependEnvironmentPath(env, binDir, platform)
  delete env.PI_SUBAGENT_PI_BINARY
  registerCleanup(binDir)
  return { binDir, env }
}

/**
 * POSIX launcher 使用 exec 替换 shell 进程。这样 stdin/stdout/stderr、退出码和信号
 * 都直接属于 sidecar 子进程，调用方观察到的行为与执行真实 pi CLI 一致。
 */
function writePosixLauncher(binDir: string, options: DesktopPiCliShimOptions): void {
  const launcherPath = join(binDir, 'pi')
  const lines = [
    '#!/bin/sh',
    `export ${DESKTOP_PI_CLI_ENV}=1`,
    ...(options.electronRunAsNode ? ['export ELECTRON_RUN_AS_NODE=1'] : []),
    `exec ${shellQuote(options.nodeExecPath)} ${shellQuote(options.workerEntry)} "$@"`
  ]
  writeFileSync(launcherPath, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o700 })
  chmodSync(launcherPath, 0o700)
}

/**
 * 同时生成 cmd 与 PowerShell shim，兼容 Windows 上不同扩展使用的命令解析方式。
 * 不在这里拼接业务参数，所有原始 argv 都原样交给 sidecar 的兼容 runner 解析。
 */
function writeWindowsLaunchers(binDir: string, options: DesktopPiCliShimOptions): void {
  const environment = [
    `set "${DESKTOP_PI_CLI_ENV}=1"`,
    ...(options.electronRunAsNode ? ['set "ELECTRON_RUN_AS_NODE=1"'] : [])
  ]
  const command = `"${escapeCmdValue(options.nodeExecPath)}" "${escapeCmdValue(options.workerEntry)}" %*`
  writeFileSync(
    join(binDir, 'pi.cmd'),
    `@echo off\r\n${environment.join('\r\n')}\r\n${command}\r\n`,
    'utf8'
  )
  writeFileSync(
    join(binDir, 'pi.ps1'),
    `$env:${DESKTOP_PI_CLI_ENV} = '1'\n${options.electronRunAsNode ? "$env:ELECTRON_RUN_AS_NODE = '1'\n" : ''}& ${powerShellQuote(options.nodeExecPath)} ${powerShellQuote(options.workerEntry)} @args\nexit $LASTEXITCODE\n`,
    'utf8'
  )
}

/**
 * Windows 环境变量键名大小写不敏感，但复制成普通对象后可能只存在 `Path`。
 * 这里先大小写不敏感地取出并删除旧键，再统一写成 PATH，避免 Node 在同时存在
 * `PATH`/`Path` 时只保留其中一个，也不能为了注入 pi 而丢掉扩展需要的系统命令。
 */
function prependEnvironmentPath(
  env: NodeJS.ProcessEnv,
  binDir: string,
  platform: NodeJS.Platform
): void {
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path')
  const currentPath = pathKeys.map((key) => env[key]).find((value) => value !== undefined)
  for (const key of pathKeys) delete env[key]
  const pathDelimiter = platform === 'win32' ? ';' : delimiter
  env.PATH = currentPath ? `${binDir}${pathDelimiter}${currentPath}` : binDir
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function escapeCmdValue(value: string): string {
  return value.replaceAll('%', '%%').replaceAll('"', '""')
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * 每个目录由 mkdtemp 创建，避免多个 Desktop 实例共享可被替换的 launcher。
 * 主进程退出时统一清理，既维持目录所有权边界，也避免长期堆积临时文件。
 */
function registerCleanup(binDir: string): void {
  shimDirectories.add(binDir)
  if (cleanupRegistered) return
  cleanupRegistered = true
  process.once('exit', () => {
    for (const directory of shimDirectories) {
      rmSync(directory, { recursive: true, force: true })
    }
    shimDirectories.clear()
  })
}
