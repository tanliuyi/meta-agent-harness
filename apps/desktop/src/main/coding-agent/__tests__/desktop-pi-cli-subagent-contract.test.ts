/**
 * A/B contract tests for Pi-compatible child processes launched directly or
 * through the Desktop-owned `pi` shim. The fixture avoids model/network access
 * while preserving the process, signal, session-flush, and bridge boundaries
 * used by subagent extensions.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopPiCliShim, DESKTOP_PI_CLI_ENV } from '../desktop-pi-cli-shim'

interface FixtureEvent {
  type: string
  marker?: string
  message?: string
  signal?: string
}

interface RunningFixture {
  child: ChildProcess
  directory: string
  eventsFile: string
  inboxFile: string
  sessionFile: string
  shimBinDir?: string
}

type LaunchMode = 'direct' | 'desktop-shim'

const temporaryDirectories: string[] = []

const fixtureSource = String.raw`
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs')
const [eventsFile, inboxFile, sessionFile, requestedExitCode = '0'] = process.argv.slice(2)
let inboxOffset = 0
let closing = false

function emit(event) {
  appendFileSync(eventsFile, JSON.stringify({
    ...event,
    marker: process.env.${DESKTOP_PI_CLI_ENV} || 'direct'
  }) + '\n')
}

function flushAndExit(reason, exitCode, signal) {
  if (closing) return
  closing = true
  writeFileSync(sessionFile, JSON.stringify({ reason, signal, flushed: true }) + '\n')
  emit({ type: 'session_flushed', signal })
  clearInterval(inboxTimer)
  setTimeout(() => process.exit(exitCode), 10)
}

emit({ type: 'extension_discovered' })
setTimeout(() => {
  emit({ type: 'intercom_route_registered' })
  emit({ type: 'ready' })
}, 10)

const inboxTimer = setInterval(() => {
  if (!existsSync(inboxFile)) return
  const content = readFileSync(inboxFile, 'utf8')
  const unread = content.slice(inboxOffset)
  inboxOffset = content.length
  for (const line of unread.split(/\r?\n/).filter(Boolean)) {
    const message = JSON.parse(line)
    if (message.type === 'intercom') emit({ type: 'intercom_received', message: message.message })
    if (message.type === 'complete') {
      emit({ type: 'completion_received' })
      flushAndExit('complete', Number(requestedExitCode))
    }
  }
}, 10)

process.on('SIGINT', () => flushAndExit('signal', 130, 'SIGINT'))
process.on('SIGTERM', () => flushAndExit('signal', 143, 'SIGTERM'))
`

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe.runIf(process.platform !== 'win32')('Desktop pi CLI subagent process contract', () => {
  for (const mode of ['direct', 'desktop-shim'] satisfies LaunchMode[]) {
    it(`${mode}: discovers extensions before registering and using the intercom route`, async () => {
      const fixture = launchFixture(mode, 23)
      await waitForEvent(fixture, 'ready')

      appendInbox(fixture, { type: 'intercom', message: 'parent follow-up' })
      await waitForEvent(fixture, 'intercom_received')
      appendInbox(fixture, { type: 'complete' })

      const exit = await waitForExit(fixture.child)
      const events = readEvents(fixture)
      expect(events.map((event) => event.type)).toEqual([
        'extension_discovered',
        'intercom_route_registered',
        'ready',
        'intercom_received',
        'completion_received',
        'session_flushed'
      ])
      expect(events.find((event) => event.type === 'intercom_received')?.message).toBe(
        'parent follow-up'
      )
      expect(events.every((event) => event.marker === (mode === 'direct' ? 'direct' : '1'))).toBe(
        true
      )
      expect(exit).toEqual({ code: 23, signal: null })
      expect(JSON.parse(readFileSync(fixture.sessionFile, 'utf8'))).toEqual({
        reason: 'complete',
        flushed: true
      })
    })
  }

  for (const mode of ['direct', 'desktop-shim'] satisfies LaunchMode[]) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      it(`${mode}: ${signal} reaches only the selected child and flushes its session`, async () => {
        const selected = launchFixture(mode)
        const sibling = launchFixture(mode)
        await Promise.all([waitForEvent(selected, 'ready'), waitForEvent(sibling, 'ready')])

        expect(selected.child.kill(signal)).toBe(true)
        const selectedExit = await waitForExit(selected.child)
        await waitForEvent(selected, 'session_flushed')

        expect(selectedExit).toEqual({
          code: signal === 'SIGINT' ? 130 : 143,
          signal: null
        })
        expect(sibling.child.exitCode).toBeNull()
        expect(sibling.child.signalCode).toBeNull()
        expect(JSON.parse(readFileSync(selected.sessionFile, 'utf8'))).toEqual({
          reason: 'signal',
          signal,
          flushed: true
        })

        appendInbox(sibling, { type: 'intercom', message: 'sibling remains routable' })
        await waitForEvent(sibling, 'intercom_received')
        appendInbox(sibling, { type: 'complete' })
        expect(await waitForExit(sibling.child)).toEqual({ code: 0, signal: null })
      })
    }
  }
})

function launchFixture(mode: LaunchMode, exitCode = 0): RunningFixture {
  const directory = mkdtempSync(join(tmpdir(), `meta-agent-pi-contract-${mode}-`))
  temporaryDirectories.push(directory)
  const workerEntry = join(directory, 'fixture.cjs')
  const eventsFile = join(directory, 'events.jsonl')
  const inboxFile = join(directory, 'intercom-inbox.jsonl')
  const sessionFile = join(directory, 'session.jsonl')
  writeFileSync(workerEntry, fixtureSource, 'utf8')
  writeFileSync(eventsFile, '', 'utf8')
  writeFileSync(inboxFile, '', 'utf8')

  const args = [eventsFile, inboxFile, sessionFile, String(exitCode)]
  let child: ChildProcess
  let shimBinDir: string | undefined
  if (mode === 'direct') {
    child = spawn(process.execPath, [workerEntry, ...args], {
      env: { ...process.env, [DESKTOP_PI_CLI_ENV]: undefined },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } else {
    const shim = createDesktopPiCliShim({
      nodeExecPath: process.execPath,
      workerEntry,
      env: { ...process.env, [DESKTOP_PI_CLI_ENV]: undefined }
    })
    shimBinDir = shim.binDir
    temporaryDirectories.push(shim.binDir)
    child = spawn('pi', args, {
      env: shim.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }

  return { child, directory, eventsFile, inboxFile, sessionFile, shimBinDir }
}

function appendInbox(fixture: RunningFixture, message: object): void {
  appendFileSync(fixture.inboxFile, `${JSON.stringify(message)}\n`, 'utf8')
}

function readEvents(fixture: RunningFixture): FixtureEvent[] {
  if (!existsSync(fixture.eventsFile)) return []
  return readFileSync(fixture.eventsFile, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FixtureEvent)
}

async function waitForEvent(fixture: RunningFixture, type: string): Promise<FixtureEvent> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const event = readEvents(fixture).find((candidate) => candidate.type === type)
    if (event) return event
    if (fixture.child.exitCode !== null || fixture.child.signalCode !== null) {
      throw new Error(`fixture exited before ${type}`)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
  }
  throw new Error(`timed out waiting for fixture event: ${type}`)
}

function waitForExit(
  child: ChildProcess
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('timed out waiting for fixture exit'))
    }, 5000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolvePromise({ code, signal })
    })
  })
}
