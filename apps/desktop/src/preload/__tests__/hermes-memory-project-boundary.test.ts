import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Hermes Memory preload boundary', () => {
  it('只暴露静态 named API，shared 输入不再接受 renderer cwd', () => {
    const preload = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
    const sharedTypes = readFileSync(
      join(__dirname, '..', '..', 'shared', 'coding-agent', 'types.ts'),
      'utf8'
    )
    const contract = sharedTypes.slice(
      sharedTypes.indexOf('/** Hermes Memory 快照查询'),
      sharedTypes.indexOf('/** 获取 Pi-compatible resource / extension 发现快照')
    )

    expect(preload).toContain('getHermesMemorySnapshot: (input) =>')
    expect(preload).toContain('codingAgentChannels.getHermesMemorySnapshot, input')
    expect(preload).toContain('mutateHermesMemory: (input) =>')
    expect(preload).toContain('codingAgentChannels.mutateHermesMemory, input')
    expect(contract).toContain('projectId?: string')
    expect(contract).not.toMatch(/^\s*cwd\??:/m)
  })
})
