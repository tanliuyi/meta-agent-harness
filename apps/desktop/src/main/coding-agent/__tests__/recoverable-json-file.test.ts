/**
 * 验证 recoverable JSON 只从缺失或内容损坏中恢复，不掩盖文件系统故障。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRecoverableJsonFile, type RecoverableJsonFileIo } from '../recoverable-json-file'

interface Metadata {
  version: number
}

const roots: string[] = []
const isMetadata = (value: unknown): value is Metadata =>
  typeof value === 'object' &&
  value !== null &&
  'version' in value &&
  typeof value.version === 'number'

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('readRecoverableJsonFile', () => {
  it.each(['EACCES', 'EIO', 'EPERM'])('原样传播 %s 且不读取 recovery snapshot', (code) => {
    const failure = Object.assign(new Error(code), { code })
    const io: RecoverableJsonFileIo = {
      exists: vi.fn(),
      read: vi.fn((path) => {
        if (path.endsWith('.bak')) throw new Error('backup must not be read')
        throw failure
      }),
      writeAtomically: vi.fn()
    }

    expect(() => readRecoverableJsonFile('metadata.json', isMetadata, io)).toThrow(failure)
    expect(io.read).toHaveBeenCalledTimes(1)
    expect(io.exists).not.toHaveBeenCalled()
    expect(io.writeAtomically).not.toHaveBeenCalled()
  })

  it('主文件缺失时从 recovery snapshot 恢复', () => {
    const { metadataPath } = createFixture()
    writeFileSync(`${metadataPath}.bak`, '{"version":1}\n')

    expect(readRecoverableJsonFile(metadataPath, isMetadata)).toEqual({ version: 1 })
    expect(readFileSync(metadataPath, 'utf8')).toBe('{"version":1}\n')
  })

  it.each([
    ['损坏 JSON', '{'],
    ['错误 schema', '{"version":"one"}\n']
  ])('主文件%s时从 recovery snapshot 恢复', (_label, content) => {
    const { metadataPath } = createFixture()
    writeFileSync(metadataPath, content)
    writeFileSync(`${metadataPath}.bak`, '{"version":2}\n')

    expect(readRecoverableJsonFile(metadataPath, isMetadata)).toEqual({ version: 2 })
    expect(readFileSync(metadataPath, 'utf8')).toBe('{"version":2}\n')
  })
})

function createFixture(): { metadataPath: string } {
  const root = join(tmpdir(), `desktop-recoverable-json-${crypto.randomUUID()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  return { metadataPath: join(root, 'metadata.json') }
}
