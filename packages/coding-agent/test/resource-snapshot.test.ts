import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildResourcesSnapshot } from '../src/core/resource-snapshot.ts'
import { SettingsManager } from '../src/core/settings-manager.ts'
import type {
  MissingSourceAction,
  PackageManager,
  ResolvedPaths
} from '../src/core/package-manager.ts'

const tempDirs: string[] = []

describe('buildResourcesSnapshot', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('loads extension registration metadata through the Pi extension loader', async () => {
    const cwd = createTempDir()
    const agentDir = join(cwd, 'agent')
    const extensionPath = join(cwd, 'hello.ts')
    writeFileSync(
      extensionPath,
      `
export default function(pi) {
  pi.registerCommand("hello", { description: "Say hello", handler() {} });
  pi.registerFlag("plan", { description: "Plan mode", type: "boolean" });
}
`
    )
    const settingsManager = SettingsManager.create(cwd, agentDir)
    settingsManager.setExtensionPaths([extensionPath])
    await settingsManager.flush()

    const snapshot = await buildResourcesSnapshot({ cwd, agentDir, settingsManager })

    expect(snapshot.resources.extensions).toEqual([
      expect.objectContaining({
        path: extensionPath,
        enabled: true,
        sourceInfo: expect.objectContaining({
          scope: 'user',
          origin: 'top-level'
        })
      })
    ])
    expect(snapshot.extensions).toEqual([
      expect.objectContaining({
        path: extensionPath,
        commands: [expect.objectContaining({ name: 'hello', description: 'Say hello' })],
        flags: [expect.objectContaining({ name: 'plan', type: 'boolean' })]
      })
    ])
  })

  it('skips missing package sources instead of installing during snapshot discovery', async () => {
    const cwd = createTempDir()
    const agentDir = join(cwd, 'agent')
    let missingAction: MissingSourceAction | undefined
    const packageManager: PackageManager = {
      async resolve(onMissing) {
        missingAction = await onMissing?.('npm:missing-extension')
        return emptyResolvedPaths()
      },
      async install() {
        throw new Error('install should not run')
      },
      async installAndPersist() {
        throw new Error('installAndPersist should not run')
      },
      async remove() {},
      async removeAndPersist() {
        return false
      },
      async update() {},
      listConfiguredPackages() {
        return []
      },
      async resolveExtensionSources() {
        return emptyResolvedPaths()
      },
      addSourceToSettings() {
        return false
      },
      removeSourceFromSettings() {
        return false
      },
      setProgressCallback() {},
      getInstalledPath() {
        return undefined
      }
    }

    const snapshot = await buildResourcesSnapshot({ cwd, agentDir, packageManager })

    expect(missingAction).toBe('skip')
    expect(snapshot.extensions).toEqual([])
  })
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'resource-snapshot-'))
  tempDirs.push(dir)
  return dir
}

function emptyResolvedPaths(): ResolvedPaths {
  return {
    extensions: [],
    skills: [],
    prompts: [],
    themes: []
  }
}
