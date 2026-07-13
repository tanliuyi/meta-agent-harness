export const MAX_BROWSER_LOG_ENTRIES = 500
export const MAX_BROWSER_LOG_MESSAGE_BYTES = 16 * 1024
export const MAX_BROWSER_LOG_SOURCE_BYTES = 2 * 1024
export const MAX_BROWSER_LOG_BUFFER_BYTES = 256 * 1024

export interface BrowserLogEntry {
  level: string
  message: string
  source?: string
  line?: number
  time: string
}

export interface BrowserLogBudgetState {
  bufferedBytes: number
  entrySizes: number[]
}

export function createBrowserLogBudgetState(): BrowserLogBudgetState {
  return { bufferedBytes: 0, entrySizes: [] }
}

export function appendBoundedBrowserLog(
  entries: BrowserLogEntry[],
  budget: BrowserLogBudgetState,
  input: Omit<BrowserLogEntry, 'time'>
): void {
  const entry: BrowserLogEntry = {
    level: boundedUtf8String(input.level, 32),
    message: boundedUtf8String(input.message, MAX_BROWSER_LOG_MESSAGE_BYTES),
    ...(input.source
      ? { source: boundedUtf8String(input.source, MAX_BROWSER_LOG_SOURCE_BYTES) }
      : {}),
    ...(Number.isFinite(input.line) ? { line: input.line } : {}),
    time: new Date().toISOString()
  }
  const entryBytes = serializedBytes(entry)
  entries.push(entry)
  budget.entrySizes.push(entryBytes)
  budget.bufferedBytes += entryBytes
  while (
    entries.length > MAX_BROWSER_LOG_ENTRIES ||
    budget.bufferedBytes > MAX_BROWSER_LOG_BUFFER_BYTES
  ) {
    entries.shift()
    budget.bufferedBytes -= budget.entrySizes.shift() ?? 0
  }
}

export function clearBoundedBrowserLogs(
  entries: BrowserLogEntry[],
  budget: BrowserLogBudgetState
): void {
  entries.length = 0
  budget.entrySizes.length = 0
  budget.bufferedBytes = 0
}

export function serializedBrowserLogBytes(entries: BrowserLogEntry[]): number {
  return serializedBytes(entries)
}

function boundedUtf8String(value: string, maxBytes: number): string {
  const candidate = value.slice(0, maxBytes)
  const encoder = new TextEncoder()
  if (encoder.encode(candidate).byteLength <= maxBytes) return candidate
  const characters = Array.from(candidate)
  let lower = 0
  let upper = characters.length
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2)
    if (encoder.encode(characters.slice(0, middle).join('')).byteLength <= maxBytes) {
      lower = middle
    } else {
      upper = middle - 1
    }
  }
  return characters.slice(0, lower).join('')
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
