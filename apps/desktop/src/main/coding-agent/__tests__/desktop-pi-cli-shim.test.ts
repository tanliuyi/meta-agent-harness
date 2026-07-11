/**
 * 验证 Desktop 为第三方扩展提供的 `pi` CLI 兼容命令。
 */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopPiCliShim, DESKTOP_PI_CLI_ENV } from '../desktop-pi-cli-shim'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('desktop pi cli shim', () => {
  it.runIf(process.platform !== 'win32')('PATH 中存在外部 pi 时仍只执行 Desktop sidecar', () => {
    const fixtureDir = createTempDir('meta-agent-pi-shim-fixture-')
    const externalBinDir = join(fixtureDir, 'external-bin')
    const workerEntry = join(fixtureDir, 'worker.js')
    const externalPi = join(externalBinDir, 'pi')
    const cwd = createTempDir('meta-agent-pi-shim-cwd-')
    mkdirSync(externalBinDir)

    writeFileSync(
      workerEntry,
      `console.log(JSON.stringify({ args: process.argv.slice(2), marker: process.env.${DESKTOP_PI_CLI_ENV}, cwd: process.cwd() }))\n`,
      'utf8'
    )
    writeFileSync(externalPi, '#!/bin/sh\necho EXTERNAL_PI_MUST_NOT_RUN\n', {
      encoding: 'utf8',
      mode: 0o700
    })
    chmodSync(externalPi, 0o700)

    const shim = createDesktopPiCliShim({
      nodeExecPath: process.execPath,
      workerEntry,
      env: {
        ...process.env,
        PATH: `${externalBinDir}:${process.env.PATH ?? ''}`,
        PI_SUBAGENT_PI_BINARY: '/tmp/external-pi'
      }
    })
    temporaryDirectories.push(shim.binDir)

    const result = spawnSync('pi', ['--mode', 'rpc'], {
      cwd,
      env: shim.env,
      encoding: 'utf8'
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('EXTERNAL_PI_MUST_NOT_RUN')
    expect(JSON.parse(result.stdout.trim())).toEqual({
      args: ['--mode', 'rpc'],
      marker: '1',
      cwd: realpathSync(cwd)
    })
    expect(shim.env.PI_SUBAGENT_PI_BINARY).toBeUndefined()
    expect(statSync(join(shim.binDir, 'pi')).mode & 0o111).not.toBe(0)
  })

  it('生成 Windows cmd 和 PowerShell launcher 并前置 Windows PATH', () => {
    const shim = createDesktopPiCliShim({
      nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
      workerEntry: 'C:\\Meta Agent\\coding-agent-worker.js',
      // Windows 常见的是 `Path` 而不是全大写 `PATH`。
      env: { Path: 'C:\\Windows\\System32' },
      electronRunAsNode: true,
      platform: 'win32'
    })
    temporaryDirectories.push(shim.binDir)

    const cmd = readFileSync(join(shim.binDir, 'pi.cmd'), 'utf8')
    const powerShell = readFileSync(join(shim.binDir, 'pi.ps1'), 'utf8')

    expect(shim.env.PATH).toBe(`${shim.binDir};C:\\Windows\\System32`)
    expect(shim.env.Path).toBeUndefined()
    expect(cmd).toContain(`set "${DESKTOP_PI_CLI_ENV}=1"`)
    expect(cmd).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(cmd).toContain('"C:\\Program Files\\nodejs\\node.exe"')
    expect(powerShell).toContain(`$env:${DESKTOP_PI_CLI_ENV} = '1'`)
    expect(powerShell).toContain("$env:ELECTRON_RUN_AS_NODE = '1'")
  })
})

function createTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}
