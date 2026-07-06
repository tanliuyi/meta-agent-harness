export function getTruncationLabel(value: Record<string, unknown> | undefined): string {
  if (!value) {
    return '输出已截断'
  }

  const totalLines = readNumber(value.totalLines)
  const outputLines = readNumber(value.outputLines)
  const outputBytes = readNumber(value.outputBytes)
  const truncatedBy = readString(value.truncatedBy)

  if (totalLines !== undefined && outputLines !== undefined && outputLines > 0) {
    const startLine = Math.max(1, totalLines - outputLines + 1)
    return `显示 ${startLine}-${totalLines} / ${totalLines} 行`
  }

  if (outputBytes !== undefined) {
    return `${formatBytes(outputBytes)} 输出片段`
  }

  if (truncatedBy) {
    return `按 ${truncatedBy} 截断`
  }

  return '输出已截断'
}

export function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`
  }
  return `${value} B`
}

export function extractFullOutputPath(value: string | undefined): string | undefined {
  return value?.match(/Full output:\s*([^\]\n]+)/)?.[1]?.trim()
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

export function readString(value: unknown, key?: string): string | undefined {
  const raw = key ? readRecord(value)?.[key] : value
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readBoolean(value: unknown): boolean {
  return value === true
}
