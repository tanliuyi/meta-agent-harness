const DEFAULT_BROWSER_COMMAND_RESULT_BYTES = 512 * 1024
const SCREENSHOT_BROWSER_COMMAND_RESULT_BYTES = 28 * 1024 * 1024

export function assertBrowserCommandResultBudget(command: string, value: unknown): void {
  const limit =
    command === 'screenshot'
      ? SCREENSHOT_BROWSER_COMMAND_RESULT_BYTES
      : DEFAULT_BROWSER_COMMAND_RESULT_BYTES
  if (estimateStructuredValueBytes(value, limit) > limit) {
    throw new Error(`Browser command result exceeds the byte budget: ${command}`)
  }
}

export function estimateStructuredValueBytes(value: unknown, limit: number): number {
  const pending: unknown[] = [value]
  const seen = new WeakSet<object>()
  let bytes = 0
  while (pending.length > 0 && bytes <= limit) {
    const item = pending.pop()
    if (typeof item === 'string') {
      bytes += new TextEncoder().encode(item.slice(0, limit + 1)).byteLength + 8
      continue
    }
    if (
      item === null ||
      item === undefined ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    ) {
      bytes += 16
      continue
    }
    if (typeof item !== 'object') {
      bytes += 32
      continue
    }
    if (seen.has(item)) {
      bytes += 8
      continue
    }
    seen.add(item)
    if (item instanceof ArrayBuffer) {
      bytes += item.byteLength + 16
      continue
    }
    if (ArrayBuffer.isView(item)) {
      bytes += item.byteLength + 16
      continue
    }
    bytes += 16
    for (const [key, child] of Object.entries(item)) {
      bytes += new TextEncoder().encode(key).byteLength + 8
      if (bytes > limit) break
      pending.push(child)
    }
  }
  return bytes
}
