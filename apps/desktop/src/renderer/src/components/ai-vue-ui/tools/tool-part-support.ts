export type ToolState = 'pending' | 'running' | 'complete' | 'error' | 'cancelled'
export type RecordValue = Record<string, unknown>

export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

export function parseToolArgs(value: unknown): RecordValue {
  return toRecord(parseMaybeJson(value)) ?? {}
}

export function toRecord(value: unknown): RecordValue | undefined {
  return typeof value === 'object' && value !== null ? (value as RecordValue) : undefined
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function pushNumberMeta(meta: string[], label: string, value: unknown): void {
  const numberValue = readNumber(value)
  if (numberValue !== undefined) meta.push(`${label}=${numberValue}`)
}

export function formatBytes(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}
