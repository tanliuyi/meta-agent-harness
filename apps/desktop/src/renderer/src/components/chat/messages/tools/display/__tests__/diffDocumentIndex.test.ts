import { describe, expect, it } from 'vitest'
import { parseDisplayDiff } from '../diffDisplay'
import {
  buildDiffDocumentIndex,
  countDiffDocumentLines,
  getIndexedDiffLine
} from '../diffDocumentIndex'
import { DiffDocumentIndexService, diffDocumentIndexService } from '../diffDocumentIndexService'

describe('diffDocumentIndex', () => {
  it('indexes the same rows as the existing display parser', () => {
    const source = '+  12 new line\n-  13 old line\n  14 same line\n...\nmetadata'
    const indexed = buildDiffDocumentIndex(source)
    const indexedLines = Array.from({ length: indexed.lineCount }, (_, index) =>
      getIndexedDiffLine(indexed, index)
    )

    expect(indexedLines).toEqual(parseDisplayDiff(source).lines)
    expect(indexed.contentColumns).toBe(parseDisplayDiff(source).contentColumns)
  })

  it('preserves empty and trailing lines without allocating line objects eagerly', () => {
    const source = '\n+  1 value\n'
    const indexed = buildDiffDocumentIndex(source)

    expect(countDiffDocumentLines(source)).toBe(3)
    expect(indexed.lineCount).toBe(3)
    expect(getIndexedDiffLine(indexed, 0)?.text).toBe('')
    expect(getIndexedDiffLine(indexed, 1)).toMatchObject({
      kind: 'added',
      lineNumber: 1,
      marker: '+',
      text: 'value'
    })
    expect(getIndexedDiffLine(indexed, 2)?.text).toBe('')
  })

  it('returns undefined outside the indexed range', () => {
    const indexed = buildDiffDocumentIndex('+  1 value')

    expect(getIndexedDiffLine(indexed, -1)).toBeUndefined()
    expect(getIndexedDiffLine(indexed, indexed.lineCount)).toBeUndefined()
  })

  it('reuses cached line counts and indexed documents', async () => {
    const source = '+  1 cached\n-  2 value'
    const cacheKey = 'diff-index-test-cache'

    expect(diffDocumentIndexService.getLineCount(cacheKey, source)).toBe(2)
    const first = await diffDocumentIndexService.request(cacheKey, source)
    const second = await diffDocumentIndexService.request(cacheKey, source)

    expect(first).toBeDefined()
    expect(second).toBe(first)
    diffDocumentIndexService.reset()
  })

  it('evicts indexed documents by byte budget and clears session caches', async () => {
    const service = new DiffDocumentIndexService(50)
    const firstSource = '+  1 first'
    const secondSource = '+  2 second'

    await service.request('first', firstSource)
    const second = await service.request('second', secondSource)

    expect(service.getCached('first', firstSource)).toBeUndefined()
    expect(service.getCached('second', secondSource)).toBe(second)
    service.reset()
    expect(service.getCached('second', secondSource)).toBeUndefined()
  })
})
