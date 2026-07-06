import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext'
import type { VirtualItem } from '@tanstack/vue-virtual'

export type DiffLineKind = 'added' | 'removed' | 'context' | 'skipped'

export interface DiffLine {
  key: string
  kind: DiffLineKind
  lineNumber?: number
  marker: '' | '+' | '-'
  text: string
}

export interface ParsedDisplayDiff {
  lines: DiffLine[]
  contentColumns: number
}

export interface VirtualDiffLineRow {
  line: DiffLine
  virtualItem: VirtualItem
  transform: string
}

export function parseDisplayDiff(diff: string): ParsedDisplayDiff {
  let contentColumns = 48
  const lines: DiffLine[] = []

  diff.split('\n').forEach((line, index) => {
    const match = line.match(/^([+\- ])(\s*\d+)\s(.*)$/)
    if (!match) {
      const text = line.trim() === '...' ? '...' : line
      const columns = getDisplayColumnLength(text) + 2
      contentColumns = Math.max(contentColumns, columns)
      lines.push({
        key: `${index}:skipped:`,
        kind: 'skipped',
        marker: '',
        text
      })
      return
    }

    const [, marker, rawLineNumber = '', text = ''] = match
    const lineNumber = Number.parseInt(rawLineNumber.trim(), 10)
    const key = `${index}:${marker}:${Number.isNaN(lineNumber) ? '' : lineNumber}`
    const columns = getDisplayColumnLength(text) + 2
    contentColumns = Math.max(contentColumns, columns)

    if (marker === '+') {
      lines.push({ key, kind: 'added', lineNumber, marker: '+', text })
      return
    }
    if (marker === '-') {
      lines.push({ key, kind: 'removed', lineNumber, marker: '-', text })
      return
    }
    lines.push({
      key,
      kind: text.trim() === '...' ? 'skipped' : 'context',
      lineNumber: Number.isNaN(lineNumber) ? undefined : lineNumber,
      marker: '',
      text
    })
  })

  return { lines, contentColumns }
}

export function createVirtualDiffLineRows(
  virtualItems: VirtualItem[],
  lines: DiffLine[]
): VirtualDiffLineRow[] {
  const rows: VirtualDiffLineRow[] = []
  for (const virtualItem of virtualItems) {
    const line = lines[virtualItem.index]
    if (line) {
      rows.push({
        line,
        virtualItem,
        transform: `translateY(${virtualItem.start}px)`
      })
    }
  }
  return rows
}

export function countDisplayDiffStats(value: unknown): { additions: number; deletions: number } {
  if (typeof value !== 'string') {
    return { additions: 0, deletions: 0 }
  }

  let additions = 0
  let deletions = 0
  for (const line of value.split('\n')) {
    if (/^\+\s*\d+\s/.test(line)) additions += 1
    if (/^-\s*\d+\s/.test(line)) deletions += 1
  }
  return { additions, deletions }
}

export function measureDiffContentWidth(lines: DiffLine[], style: CSSStyleDeclaration): number {
  const font = getCanvasFont(style)
  const letterSpacing = readPixelValue(style.letterSpacing)
  const maxWidth = lines.reduce((width, line) => {
    const measured = measureNaturalWidth(
      prepareWithSegments(line.text, font, {
        letterSpacing,
        whiteSpace: 'pre-wrap'
      })
    )
    return Math.max(width, measured)
  }, 0)
  return Math.max(1, Math.ceil(maxWidth) + 1)
}

function getDisplayColumnLength(value: string): number {
  return Array.from(value).reduce((length, char) => {
    const codePoint = char.codePointAt(0) ?? 0
    return length + (codePoint > 0x2e80 ? 2 : 1)
  }, 0)
}

function getCanvasFont(style: CSSStyleDeclaration): string {
  if (style.font) return style.font
  const fontStyle = style.fontStyle || 'normal'
  const fontVariant = style.fontVariant || 'normal'
  const fontWeight = style.fontWeight || '400'
  const fontSize = style.fontSize || '12px'
  const fontFamily = style.fontFamily || 'monospace'
  return `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} ${fontFamily}`
}

function readPixelValue(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}
