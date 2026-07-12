/**
 * Tests the worker environment shared by Node sidecars and utility processes.
 */

import { delimiter, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeWorkerPath } from '../coding-agent-package-dir'

describe('coding agent worker PATH', () => {
  it('exposes the selected Node directory before login-shell and GUI paths', () => {
    const executablePath = joinPath('opt', 'node', 'bin', executableName())
    const loginBin = joinPath('usr', 'local', 'bin')
    const guiBin = joinPath('usr', 'bin')

    expect(
      mergeWorkerPath(guiBin, [loginBin, guiBin].join(delimiter), executablePath)?.split(delimiter)
    ).toEqual([dirname(executablePath), loginBin, guiBin])
  })

  it('preserves the GUI PATH when the login shell cannot be resolved', () => {
    const guiEntries = [joinPath('usr', 'bin'), joinPath('bin')]

    expect(mergeWorkerPath(guiEntries.join(delimiter), undefined)?.split(delimiter)).toEqual(
      guiEntries
    )
  })

  it('returns undefined only when no PATH source exists', () => {
    expect(mergeWorkerPath(undefined, undefined)).toBeUndefined()
  })
})

function joinPath(...segments: string[]): string {
  const prefix = process.platform === 'win32' ? 'C:\\' : '/'
  return `${prefix}${segments.join(process.platform === 'win32' ? '\\' : '/')}`
}

function executableName(): string {
  return process.platform === 'win32' ? 'node.exe' : 'node'
}
