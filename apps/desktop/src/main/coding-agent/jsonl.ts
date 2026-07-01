/**
 * 本文件提供 main 侧 worker stdio JSONL 编解码。
 */

export function serializeJsonlRecord(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

export function parseJsonlRecord<T>(line: string): T {
  const text = line.trim()
  if (!text) {
    throw new Error('empty JSONL record')
  }
  return JSON.parse(text) as T
}
