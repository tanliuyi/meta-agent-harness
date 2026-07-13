import { describe, expect, it } from 'vitest'
import {
  countFileChangeStats,
  formatFileChangePath,
  getFileChangeId,
  getFileChangeLayoutSize,
  getVisibleDiffLineRange,
  type FileChange
} from '../changesDisplay'

describe('formatFileChangePath', () => {
  it('keeps workspace-relative paths relative', () => {
    expect(formatFileChangePath('apps/desktop/package.json', '/Users/dev/meta-agent-harness')).toBe(
      'apps/desktop/package.json'
    )
  })

  it('makes workspace absolute paths relative to the workspace root', () => {
    expect(
      formatFileChangePath(
        '/Users/dev/meta-agent-harness/apps/desktop/package.json',
        '/Users/dev/meta-agent-harness'
      )
    ).toBe('apps/desktop/package.json')
  })

  it('removes an existing workspace directory prefix', () => {
    expect(
      formatFileChangePath(
        'meta-agent-harness/apps/desktop/package.json',
        '/Users/dev/meta-agent-harness'
      )
    ).toBe('apps/desktop/package.json')
  })

  it('normalizes Windows workspace paths', () => {
    expect(formatFileChangePath('H:\\repo\\src\\main.ts', 'H:\\repo')).toBe('src/main.ts')
  })

  it('omits the workspace root itself', () => {
    expect(
      formatFileChangePath('/Users/dev/meta-agent-harness', '/Users/dev/meta-agent-harness')
    ).toBe('')
  })

  it('leaves absolute paths outside the workspace unchanged', () => {
    expect(formatFileChangePath('/tmp/file.txt', '/Users/dev/meta-agent-harness')).toBe(
      '/tmp/file.txt'
    )
  })

  it('returns the normalized relative path when the workspace is unavailable', () => {
    expect(formatFileChangePath('./src\\main.ts', undefined)).toBe('src/main.ts')
  })

  it('keeps the row ID stable when the same file receives another tool call', () => {
    const first = { path: 'src/app.ts', toolCallId: 'tool-a' } as FileChange
    const second = { path: './src\\app.ts', toolCallId: 'tool-b' } as FileChange

    expect(getFileChangeId(first)).toBe('src/app.ts')
    expect(getFileChangeId(second)).toBe(getFileChangeId(first))
  })
})

describe('change layout virtualization', () => {
  it('computes exact expanded, collapsed, and empty diff heights', () => {
    expect(getFileChangeLayoutSize(3, true, true)).toBe(94)
    expect(getFileChangeLayoutSize(1_000_000, true, true, 2)).toBe(10_000_034)
    expect(getFileChangeLayoutSize(3, false, true)).toBe(33)
    expect(getFileChangeLayoutSize(0, true, false)).toBe(70)
  })

  it('limits diff rows to the outer viewport plus line overscan', () => {
    expect(getVisibleDiffLineRange(100, 100, 1134, 100)).toEqual({ start: 38, end: 67 })
    expect(getVisibleDiffLineRange(100, 1_000, 1134, 100, 2)).toEqual({
      start: 88,
      end: 122
    })
    expect(getVisibleDiffLineRange(5000, 100, 0, 900)).toEqual({ start: 0, end: 0 })
  })

  it('keeps the final logical lines reachable at the bottom of a scaled diff', () => {
    const lineCount = 1_000_000
    const lineScale = 2
    const viewportHeight = 600
    const diffHeight = (lineCount * 20) / lineScale
    const scrollTop = 34 + diffHeight - viewportHeight

    expect(getVisibleDiffLineRange(0, lineCount, scrollTop, viewportHeight, lineScale)).toEqual({
      start: 999_928,
      end: lineCount
    })
  })

  it('increments stats from an append boundary without recounting previous changes', () => {
    const changes = [
      { additions: 2, deletions: 1 },
      { additions: 3, deletions: 4 }
    ] as FileChange[]
    const initial = countFileChangeStats(changes.slice(0, 1))

    expect(countFileChangeStats(changes, 1, initial)).toEqual({ additions: 5, deletions: 5 })
  })
})
