import type { DiffLine, DiffLineKind } from './diffDisplay'

const DIFF_KIND_SKIPPED = 0
const DIFF_KIND_ADDED = 1
const DIFF_KIND_REMOVED = 2
const DIFF_KIND_CONTEXT = 3
const NO_LINE_NUMBER = -1

export interface DiffDocumentIndex {
  source: string
  lineStarts: Uint32Array
  lineEnds: Uint32Array
  textStarts: Uint32Array
  kinds: Uint8Array
  lineNumbers: Int32Array
  lineCount: number
  contentColumns: number
}

export interface TransferableDiffDocumentIndex extends Omit<DiffDocumentIndex, 'source'> {}

export function countDiffDocumentLines(source: string): number {
  let count = 1
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      count += 1
    }
  }
  return count
}

export function buildDiffDocumentIndex(source: string): DiffDocumentIndex {
  const lineCount = countDiffDocumentLines(source)
  const lineStarts = new Uint32Array(lineCount)
  const lineEnds = new Uint32Array(lineCount)
  const textStarts = new Uint32Array(lineCount)
  const kinds = new Uint8Array(lineCount)
  const lineNumbers = new Int32Array(lineCount)
  lineNumbers.fill(NO_LINE_NUMBER)

  let contentColumns = 48
  let lineStart = 0
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const newlineIndex = source.indexOf('\n', lineStart)
    const lineEnd = newlineIndex === -1 ? source.length : newlineIndex
    const line = source.slice(lineStart, lineEnd)
    const match = line.match(/^([+\- ])(\s*\d+)\s(.*)$/)

    lineStarts[lineIndex] = lineStart
    lineEnds[lineIndex] = lineEnd
    if (!match) {
      textStarts[lineIndex] = lineStart
      kinds[lineIndex] = DIFF_KIND_SKIPPED
      contentColumns = Math.max(contentColumns, getDisplayColumnLength(line) + 2)
    } else {
      const marker = match[1] ?? ''
      const rawLineNumber = match[2] ?? ''
      const text = match[3] ?? ''
      const parsedLineNumber = Number.parseInt(rawLineNumber.trim(), 10)
      textStarts[lineIndex] = lineEnd - text.length
      lineNumbers[lineIndex] = Number.isNaN(parsedLineNumber) ? NO_LINE_NUMBER : parsedLineNumber
      kinds[lineIndex] = getEncodedDiffKind(marker, text)
      contentColumns = Math.max(contentColumns, getDisplayColumnLength(text) + 2)
    }
    lineStart = lineEnd + 1
  }

  return {
    source,
    lineStarts,
    lineEnds,
    textStarts,
    kinds,
    lineNumbers,
    lineCount,
    contentColumns
  }
}

export function getIndexedDiffLine(
  document: DiffDocumentIndex,
  index: number
): DiffLine | undefined {
  if (index < 0 || index >= document.lineCount) {
    return undefined
  }

  const encodedKind = document.kinds[index] ?? DIFF_KIND_SKIPPED
  const lineNumber = document.lineNumbers[index] ?? NO_LINE_NUMBER
  const kind = getDecodedDiffKind(encodedKind)
  const marker =
    encodedKind === DIFF_KIND_ADDED ? '+' : encodedKind === DIFF_KIND_REMOVED ? '-' : ''
  const text = document.source.slice(document.textStarts[index], document.lineEnds[index])
  if (lineNumber === NO_LINE_NUMBER) {
    return {
      key: `${index}:skipped:`,
      kind,
      marker,
      text
    }
  }
  const keyMarker = encodedKind === DIFF_KIND_CONTEXT ? ' ' : marker
  return {
    key: `${index}:${keyMarker}:${lineNumber}`,
    kind,
    marker,
    lineNumber,
    text
  }
}

export function getDiffDocumentTransferables(
  document: TransferableDiffDocumentIndex
): ArrayBuffer[] {
  return [
    document.lineStarts.buffer,
    document.lineEnds.buffer,
    document.textStarts.buffer,
    document.kinds.buffer,
    document.lineNumbers.buffer
  ] as ArrayBuffer[]
}

function getEncodedDiffKind(marker: string, text: string): number {
  if (marker === '+') return DIFF_KIND_ADDED
  if (marker === '-') return DIFF_KIND_REMOVED
  return text.trim() === '...' ? DIFF_KIND_SKIPPED : DIFF_KIND_CONTEXT
}

function getDecodedDiffKind(kind: number): DiffLineKind {
  if (kind === DIFF_KIND_ADDED) return 'added'
  if (kind === DIFF_KIND_REMOVED) return 'removed'
  if (kind === DIFF_KIND_CONTEXT) return 'context'
  return 'skipped'
}

function getDisplayColumnLength(value: string): number {
  return Array.from(value).reduce((length, char) => {
    const codePoint = char.codePointAt(0) ?? 0
    return length + (codePoint > 0x2e80 ? 2 : 1)
  }, 0)
}
