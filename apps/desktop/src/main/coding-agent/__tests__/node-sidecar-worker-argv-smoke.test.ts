/**
 * Build-product smoke tests for the Desktop node sidecar argv entry.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDesktopPiCliShim } from '../desktop-pi-cli-shim'

const repoRoot = resolve(__dirname, '../../../../../..')
const workerEntry = join(
  repoRoot,
  'apps',
  'desktop',
  'out',
  'main',
  'coding-agent-node-sidecar-worker.js'
)
const hasBuiltWorker = existsSync(workerEntry)

describe.skipIf(!hasBuiltWorker)('node sidecar worker argv build smoke', () => {
  it('prints version from the built worker', async () => {
    const result = await runWorker(['--version'])

    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
    expect(result.stderr).not.toContain('Cannot find module')
  })

  it.runIf(process.platform !== 'win32')(
    'runs the built worker through the app-owned pi command without a global CLI',
    async () => {
      const shim = createDesktopPiCliShim({
        nodeExecPath: process.execPath,
        workerEntry,
        env: {
          ...process.env,
          // 只保留系统基础命令目录；测试不能意外使用用户 npm 安装的 pi。
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          PI_SUBAGENT_PI_BINARY: '/tmp/external-pi-must-not-run'
        }
      })
      try {
        const result = await runCommand('pi', ['--version'], shim.env)

        expect(result.stdout.trim()).toBe('0.80.2')
        expect(result.stderr).not.toContain('Cannot find module')
      } finally {
        rmSync(shim.binDir, { recursive: true, force: true })
      }
    }
  )

  it('prints help from the built worker', async () => {
    const result = await runWorker(['--help'])

    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('Commands:')
  })

  it('loads runtime metadata commands from the built worker', async () => {
    const result = await runWorker(['--list-models', 'Local'])

    expect(result.stdout).toMatch(/provider/i)
    expect(result.stdout).toMatch(/model/i)
  })

  it('exports a session file from the built worker', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'meta-agent-sidecar-export-'))
    try {
      const sessionFile = join(tempDir, 'session.jsonl')
      const outputFile = join(tempDir, 'session.html')
      writeFileSync(
        sessionFile,
        `${JSON.stringify({
          type: 'session',
          version: 3,
          id: 'desktop-worker-export-smoke',
          timestamp: '2026-01-01T00:00:00.000Z',
          cwd: tempDir
        })}\n`,
        'utf8'
      )

      const result = await runWorker(['--export', sessionFile, outputFile])

      expect(result.stdout).toContain(`Exported to: ${outputFile}`)
      expect(existsSync(outputFile)).toBe(true)
      const html = readFileSync(outputFile, 'utf8')
      expect(html).toContain('<title>Session Export</title>')
      expect(html).toContain('id="session-data"')
      expect(html).not.toContain('{{SESSION_DATA}}')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('runs the config command from the built worker', async () => {
    const result = await runWorker(['config'])

    expect(result.stdout).toContain('Resolved configuration')
    expect(result.stdout).toContain('agentDir:')
    expect(result.stdout).toContain('extensions:')
  })

  it.runIf(process.env.PI_DESKTOP_WORKER_SMOKE_MODEL)(
    'runs json print mode from the built worker',
    async () => {
      const model = process.env.PI_DESKTOP_WORKER_SMOKE_MODEL ?? 'Local/deepseek-v4-flash'
      const result = await runWorker([
        '--mode',
        'json',
        '-p',
        '--no-session',
        '--model',
        model,
        'Task: 请只回复 Desktop argv smoke ok'
      ])

      expect(result.stdout).toContain('agent_start')
      expect(result.stdout).toContain('agent_end')
      expect(result.stdout).toContain('Desktop argv smoke ok')
    },
    120_000
  )
})

async function runWorker(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return runCommand(process.execPath, [workerEntry, ...args], {
    ...process.env,
    NO_COLOR: '1'
  })
}

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stdin.end()

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`command timed out: ${command} ${args.join(' ')}`))
    }, 120_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolvePromise({ stdout, stderr })
        return
      }
      reject(new Error(`command exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    })
  })
}
