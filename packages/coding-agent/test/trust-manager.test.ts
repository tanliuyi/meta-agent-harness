import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasTrustRequiringProjectResources, ProjectTrustStore } from '../src/core/trust-manager.ts'

describe('ProjectTrustStore', () => {
  let tempDir: string
  let agentDir: string
  let cwd: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `trust-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    agentDir = join(tempDir, 'agent')
    cwd = join(tempDir, 'project')
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(cwd, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('reads decisions without acquiring the exclusive trust lock', () => {
    const store = new ProjectTrustStore(agentDir)
    store.set(cwd, true)
    const lockSpy = vi.spyOn(lockfile, 'lockSync')

    expect(store.get(cwd)).toBe(true)
    expect(lockSpy).not.toHaveBeenCalled()
  })

  it('writes decisions while holding the exclusive trust lock', () => {
    const lockSpy = vi.spyOn(lockfile, 'lockSync')
    const store = new ProjectTrustStore(agentDir)

    store.set(cwd, true)

    expect(lockSpy).toHaveBeenCalled()
    expect(store.get(cwd)).toBe(true)
  })

  it('stores decisions and inherits from parent directories', () => {
    const store = new ProjectTrustStore(agentDir)
    const parentDir = join(tempDir, 'trusted-parent')
    const childDir = join(parentDir, 'project')
    mkdirSync(childDir, { recursive: true })

    expect(store.get(childDir)).toBeNull()
    store.set(parentDir, true)
    expect(store.get(childDir)).toBe(true)
    store.set(childDir, false)
    expect(store.get(childDir)).toBe(false)
    store.set(childDir, null)
    expect(store.get(childDir)).toBe(true)
  })

  it('detects trust-requiring project resources', () => {
    const originalHome = process.env.HOME
    process.env.HOME = tempDir
    try {
      mkdirSync(join(tempDir, '.pi', 'agent'), { recursive: true })
      mkdirSync(join(tempDir, '.agents', 'skills'), { recursive: true })
      expect(hasTrustRequiringProjectResources(tempDir)).toBe(false)
      expect(hasTrustRequiringProjectResources(cwd)).toBe(false)

      writeFileSync(join(tempDir, '.pi', 'settings.json'), '{}')
      expect(hasTrustRequiringProjectResources(tempDir)).toBe(true)
      rmSync(join(tempDir, '.pi', 'settings.json'), { force: true })

      mkdirSync(join(cwd, '.pi'), { recursive: true })
      writeFileSync(join(cwd, '.pi', 'settings.json'), '{}')
      expect(hasTrustRequiringProjectResources(cwd)).toBe(true)

      rmSync(join(cwd, '.pi'), { recursive: true, force: true })
      mkdirSync(join(cwd, '.agents', 'skills'), { recursive: true })
      expect(hasTrustRequiringProjectResources(cwd)).toBe(true)
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = originalHome
      }
    }
  })
})
