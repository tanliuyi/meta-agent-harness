import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  completeFileReference,
  dedupeFileArgs,
  extractFileReferenceQuery,
  formatFileArgForInsertion,
  parseFileReferenceTokens,
  removeFileReferenceTokens
} from '../src/core/file-reference.ts'

describe('file-reference', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `pi-file-reference-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('extracts unquoted and quoted @file queries at token boundaries', () => {
    expect(extractFileReferenceQuery('read @src/a.ts')).toMatchObject({
      raw: '@src/a.ts',
      query: 'src/a.ts',
      from: 5,
      quoted: false
    })
    expect(extractFileReferenceQuery('read @"docs/a b.md')).toMatchObject({
      raw: '@"docs/a b.md',
      query: 'docs/a b.md',
      from: 5,
      quoted: true
    })
    expect(extractFileReferenceQuery('@src/a.ts')).toMatchObject({
      raw: '@src/a.ts',
      query: 'src/a.ts',
      from: 0,
      quoted: false
    })
    expect(extractFileReferenceQuery('read\n@"docs/a b.md')).toMatchObject({
      raw: '@"docs/a b.md',
      query: 'docs/a b.md',
      from: 5,
      quoted: true
    })
    expect(extractFileReferenceQuery('(@src/a.ts')).toBeUndefined()
    expect(extractFileReferenceQuery('mail me@site.test')).toBeUndefined()
    expect(extractFileReferenceQuery('word@src/a.ts')).toBeUndefined()
  })

  it('formats insertion text using Pi @file syntax', () => {
    expect(formatFileArgForInsertion('src/a.ts')).toBe('@src/a.ts')
    expect(formatFileArgForInsertion('docs/a b.md')).toBe('@"docs/a b.md"')
  })

  it('parses valid file references and removes them from display text', async () => {
    await mkdir(join(testDir, 'docs'), { recursive: true })
    await writeFile(join(testDir, 'docs', 'a b.md'), 'hello')
    await writeFile(join(testDir, 'src.ts'), 'source')

    const text = '请参考 @src.ts 和 @"docs/a b.md"\n继续处理'
    const tokens = await parseFileReferenceTokens(text, testDir)

    expect(tokens.map((token) => token.fileArg)).toEqual(['src.ts', 'docs/a b.md'])
    expect(removeFileReferenceTokens(text, tokens)).toBe('请参考 和\n继续处理')
  })

  it('ignores missing references while parsing', async () => {
    await writeFile(join(testDir, 'exists.ts'), 'source')

    const tokens = await parseFileReferenceTokens('看 @exists.ts @missing.ts', testDir)

    expect(tokens.map((token) => token.fileArg)).toEqual(['exists.ts'])
  })

  it('parses file references at text start and line start', async () => {
    await writeFile(join(testDir, 'exists.ts'), 'source')

    const tokens = await parseFileReferenceTokens('@exists.ts\n@exists.ts', testDir)

    expect(tokens.map((token) => token.fileArg)).toEqual(['exists.ts', 'exists.ts'])
  })

  it('requires a token boundary before file reference tokens', async () => {
    await writeFile(join(testDir, 'exists.ts'), 'source')

    const tokens = await parseFileReferenceTokens('(@exists.ts word@exists.ts', testDir)

    expect(tokens).toEqual([])
  })

  it('dedupes file args by resolved path while preserving order', async () => {
    await writeFile(join(testDir, 'a.ts'), 'source')

    expect(dedupeFileArgs(['a.ts', './a.ts'], testDir)).toEqual(['a.ts'])
  })

  it('searches files under cwd and ignores heavy directories', async () => {
    await mkdir(join(testDir, 'src'), { recursive: true })
    await mkdir(join(testDir, 'node_modules'), { recursive: true })
    await mkdir(join(testDir, '.git'), { recursive: true })
    await writeFile(join(testDir, 'src', 'app.ts'), 'source')
    await writeFile(join(testDir, 'node_modules', 'app.ts'), 'ignored')
    await writeFile(join(testDir, '.git', 'config'), 'ignored')

    const candidates = await completeFileReference({ cwd: testDir, query: 'app', limit: 10 })

    expect(candidates.map((candidate) => candidate.relativePath)).toEqual(['src/app.ts'])
    expect(candidates[0]?.fileArg).toBe('src/app.ts')
  })

  it('sorts file completions by match quality before applying the limit', async () => {
    await mkdir(join(testDir, 'aaa'), { recursive: true })
    await mkdir(join(testDir, 'zzz'), { recursive: true })
    await writeFile(join(testDir, 'aaa', 'composer-helpers.ts'), 'source')
    await writeFile(join(testDir, 'aaa', 'project-composer-utils.ts'), 'source')
    await writeFile(join(testDir, 'zzz', 'composer.ts'), 'source')

    const candidates = await completeFileReference({ cwd: testDir, query: 'composer', limit: 2 })

    expect(candidates.map((candidate) => candidate.relativePath)).toEqual([
      'zzz/composer.ts',
      'aaa/composer-helpers.ts'
    ])
  })
})
