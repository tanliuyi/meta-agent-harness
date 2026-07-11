import type { VirtualItem } from '@tanstack/vue-virtual'

const DIFF_TEXT_WIDTH_CACHE_LIMIT = 4096
const diffTextWidthCache = new Map<string, number>()
let pretextModulePromise: Promise<PretextModule> | null = null

type PretextModule = {
  measureNaturalWidth: (typeof import('@chenglou/pretext'))['measureNaturalWidth']
  prepareWithSegments: (typeof import('@chenglou/pretext'))['prepareWithSegments']
}

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

export function createStaticDiffLineRows(
  lines: DiffLine[],
  lineHeight: number,
  startIndex = 0,
  startOffset = startIndex * lineHeight
): VirtualDiffLineRow[] {
  return lines.map((line, localIndex) => {
    const index = startIndex + localIndex
    const start = startOffset + localIndex * lineHeight
    return {
      line,
      virtualItem: {
        index,
        start,
        size: lineHeight,
        end: start + lineHeight,
        key: index,
        lane: 0
      } as VirtualItem,
      transform: `translateY(${start}px)`
    }
  })
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

export async function measureDiffContentWidth(
  lines: DiffLine[],
  style: CSSStyleDeclaration
): Promise<number> {
  const font = getCanvasFont(style)
  const letterSpacing = readPixelValue(style.letterSpacing)
  const pretext = await loadPretextModule()
  let maxWidth = 0
  for (const line of lines) {
    const measured = measureDiffLineTextWidth(line.text, font, letterSpacing, pretext)
    maxWidth = Math.max(maxWidth, measured)
  }
  return Math.max(1, Math.ceil(maxWidth) + 1)
}

function measureDiffLineTextWidth(
  text: string,
  font: string,
  letterSpacing: number,
  pretext: PretextModule
): number {
  const cacheKey = getDiffTextWidthCacheKey(text, font, letterSpacing)
  const cached = diffTextWidthCache.get(cacheKey)
  if (cached !== undefined) {
    diffTextWidthCache.delete(cacheKey)
    diffTextWidthCache.set(cacheKey, cached)
    return cached
  }

  const measured = pretext.measureNaturalWidth(
    pretext.prepareWithSegments(text, font, {
      letterSpacing,
      whiteSpace: 'pre-wrap'
    })
  )
  diffTextWidthCache.set(cacheKey, measured)
  trimDiffTextWidthCache()
  return measured
}

function getDiffTextWidthCacheKey(text: string, font: string, letterSpacing: number): string {
  return `${font}\n${letterSpacing}\n${text}`
}

function trimDiffTextWidthCache(): void {
  if (diffTextWidthCache.size <= DIFF_TEXT_WIDTH_CACHE_LIMIT) return

  const staleKey = diffTextWidthCache.keys().next().value
  if (staleKey !== undefined) {
    diffTextWidthCache.delete(staleKey)
  }
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

function loadPretextModule(): Promise<PretextModule> {
  pretextModulePromise ??= import('@chenglou/pretext').then((pretext) => ({
    measureNaturalWidth: pretext.measureNaturalWidth,
    prepareWithSegments: pretext.prepareWithSegments
  }))
  return pretextModulePromise
}
