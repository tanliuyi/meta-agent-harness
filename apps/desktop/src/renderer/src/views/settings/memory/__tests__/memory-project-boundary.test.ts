import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('MemorySettingsView Project boundary', () => {
  it('只把 active projectId 发送给 preload', () => {
    const source = readFileSync(join(__dirname, '..', 'MemorySettingsView.vue'), 'utf8')

    expect(source).toContain('const activeProjectId = computed(() => projectStore.activeProjectId)')
    expect(source).toContain('getHermesMemorySnapshot({ projectId: requestedProjectId })')
    expect(source).toContain('projectId: requestedProjectId')
    expect(source).not.toContain('activeProjectPath')
    expect(source).not.toContain('cwd: requestedProject')
  })
})
