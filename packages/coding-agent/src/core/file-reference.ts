import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { resolveReadPath } from './tools/path-utils.ts'
import { formatPathRelativeToCwdOrAbsolute, resolvePath } from '../utils/paths.ts'
export { formatFileArgForInsertion } from './file-reference-format.ts'

const DEFAULT_LIMIT = 50
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next', '.nuxt'])

export interface FileReferenceQuery {
  raw: string
  query: string
  from: number
  to: number
  quoted: boolean
}

export interface FileReferenceToken {
  raw: string
  fileArg: string
  absolutePath: string
  from: number
  to: number
}

export interface FileReferenceCandidate {
  fileArg: string
  relativePath: string
  absolutePath: string
  label: string
}

interface ScoredFileReferenceCandidate {
  candidate: FileReferenceCandidate
  score: number
}

export interface CompleteFileReferenceOptions {
  cwd: string
  query: string
  limit?: number
}

export function extractFileReferenceQuery(
  textBeforeCursor: string
): FileReferenceQuery | undefined {
  const quotedStart = findQuotedAtStart(textBeforeCursor)
  if (quotedStart !== -1) {
    const raw = textBeforeCursor.slice(quotedStart)
    return {
      raw,
      query: raw.slice(2),
      from: quotedStart,
      to: textBeforeCursor.length,
      quoted: true
    }
  }

  const tokenStart = findUnquotedTokenStart(textBeforeCursor)
  if (tokenStart === -1 || textBeforeCursor[tokenStart] !== '@') {
    return undefined
  }

  const raw = textBeforeCursor.slice(tokenStart)
  return {
    raw,
    query: raw.slice(1),
    from: tokenStart,
    to: textBeforeCursor.length,
    quoted: false
  }
}

export async function parseFileReferenceTokens(
  text: string,
  cwd: string
): Promise<FileReferenceToken[]> {
  const tokens: FileReferenceToken[] = []
  for (const match of findFileReferenceTokens(text)) {
    const fileArg = match.fileArg
    const absolutePath = resolveReadPath(fileArg, cwd)
    try {
      const info = await stat(absolutePath)
      if (!info.isFile()) {
        continue
      }
    } catch {
      continue
    }
    tokens.push({
      raw: match.raw,
      fileArg,
      absolutePath,
      from: match.from,
      to: match.to
    })
  }
  return tokens
}

export function removeFileReferenceTokens(
  text: string,
  tokens: Pick<FileReferenceToken, 'from' | 'to'>[]
): string {
  if (tokens.length === 0) {
    return text
  }
  const ordered = [...tokens].sort((a, b) => b.from - a.from)
  let result = text
  for (const token of ordered) {
    result = `${result.slice(0, token.from)}${result.slice(token.to)}`
  }
  return result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function dedupeFileArgs(fileArgs: string[], cwd = process.cwd()): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const fileArg of fileArgs) {
    const key = resolveReadPath(fileArg, cwd)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(fileArg)
  }
  return result
}

export async function completeFileReference({
  cwd,
  query,
  limit = DEFAULT_LIMIT
}: CompleteFileReferenceOptions): Promise<FileReferenceCandidate[]> {
  const root = resolvePath(cwd)
  const normalizedQuery = query.split('\\').join('/').replace(/^@/, '')
  const candidates: ScoredFileReferenceCandidate[] = []
  await collectCandidates(root, root, normalizedQuery.toLowerCase(), candidates)
  return candidates
    .sort(compareScoredCandidates)
    .slice(0, Math.max(1, limit))
    .map(({ candidate }) => candidate)
}

function findQuotedAtStart(text: string): number {
  for (let index = text.length - 1; index >= 0; index--) {
    if (text[index] !== '@' || text[index + 1] !== '"') {
      continue
    }
    if (!isFileReferencePrefixBoundary(text[index - 1])) {
      continue
    }
    const suffix = text.slice(index + 2)
    if (!suffix.includes('"')) {
      return index
    }
  }
  return -1
}

function findUnquotedTokenStart(text: string): number {
  const lastDelimiter = Math.max(
    text.lastIndexOf(' '),
    text.lastIndexOf('\t'),
    text.lastIndexOf('\n')
  )
  const tokenStart = lastDelimiter + 1
  if (tokenStart >= text.length) {
    return -1
  }
  if (!isFileReferencePrefixBoundary(text[tokenStart - 1])) {
    return -1
  }
  const token = text.slice(tokenStart)
  if (/\s/.test(token) || token.includes('"')) {
    return -1
  }
  return tokenStart
}

function isFileReferencePrefixBoundary(char: string | undefined): boolean {
  return char === undefined || char === ' ' || char === '\t' || char === '\n'
}

function findFileReferenceTokens(
  text: string
): Array<{ raw: string; fileArg: string; from: number; to: number }> {
  const matches: Array<{ raw: string; fileArg: string; from: number; to: number }> = []
  const pattern = /(^|[ \t\n])@(?:"((?:\\"|[^"])*)"|([^\s"'<>]+))/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const boundary = match[1] ?? ''
    const rawValue = match[2] ?? match[3]
    if (!rawValue) {
      continue
    }
    const from = match.index + boundary.length
    const raw = text.slice(from, pattern.lastIndex)
    matches.push({
      raw,
      fileArg: rawValue.replace(/\\"/g, '"'),
      from,
      to: pattern.lastIndex
    })
  }
  return matches
}

async function collectCandidates(
  root: string,
  dir: string,
  query: string,
  candidates: ScoredFileReferenceCandidate[]
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort(
    (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
  )
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
      continue
    }
    const absolutePath = resolvePath(entry.name, dir)
    const relativePath = relative(root, absolutePath).split(sep).join('/')
    const score = entry.isFile() ? getMatchScore(relativePath, query) : undefined
    if (score !== undefined) {
      candidates.push({
        candidate: {
          fileArg: relativePath,
          relativePath,
          absolutePath,
          label: relativePath
        },
        score
      })
    }
    if (entry.isDirectory()) {
      await collectCandidates(root, absolutePath, query, candidates)
    }
  }
}

function getMatchScore(relativePath: string, query: string): number | undefined {
  if (!query) {
    return 0
  }
  const normalized = relativePath.toLowerCase()
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1)
  const pathIndex = normalized.indexOf(query)
  if (fileName === query) {
    return 0
  }
  if (fileName.startsWith(query)) {
    return 100 + fileName.length - query.length
  }
  if (isSegmentPrefixMatch(normalized, query)) {
    return 200 + normalized.indexOf(query)
  }
  const fileNameIndex = fileName.indexOf(query)
  if (fileNameIndex !== -1) {
    return 300 + fileNameIndex + fileName.length - query.length
  }
  if (pathIndex !== -1) {
    return 400 + pathIndex + normalized.length - query.length
  }
  return getFuzzyMatchScore(normalized, query)
}

function isSegmentPrefixMatch(relativePath: string, query: string): boolean {
  return (
    relativePath === query || relativePath.startsWith(query) || relativePath.includes(`/${query}`)
  )
}

function getFuzzyMatchScore(relativePath: string, query: string): number | undefined {
  let queryIndex = 0
  let firstMatchIndex = -1
  let lastMatchIndex = -1
  let gapCount = 0
  for (let index = 0; index < relativePath.length; index++) {
    const char = relativePath[index]
    if (char === query[queryIndex]) {
      if (firstMatchIndex === -1) {
        firstMatchIndex = index
      }
      if (lastMatchIndex !== -1 && index > lastMatchIndex + 1) {
        gapCount++
      }
      lastMatchIndex = index
      queryIndex++
      if (queryIndex === query.length) {
        const span = lastMatchIndex - firstMatchIndex + 1
        const boundaryPenalty = isPathBoundary(relativePath[firstMatchIndex - 1]) ? 0 : 50
        return 1000 + span * 10 + gapCount * 20 + firstMatchIndex + boundaryPenalty
      }
    }
  }
  return undefined
}

function isPathBoundary(char: string | undefined): boolean {
  return char === undefined || char === '/' || char === '-' || char === '_' || char === '.'
}

function compareScoredCandidates(
  a: ScoredFileReferenceCandidate,
  b: ScoredFileReferenceCandidate
): number {
  return (
    a.score - b.score ||
    a.candidate.relativePath.length - b.candidate.relativePath.length ||
    a.candidate.relativePath.localeCompare(b.candidate.relativePath)
  )
}

export function toDisplayFileArg(filePath: string, cwd: string): string {
  return formatPathRelativeToCwdOrAbsolute(
    isAbsolute(filePath) ? filePath : resolvePath(filePath, cwd),
    cwd
  )
}
