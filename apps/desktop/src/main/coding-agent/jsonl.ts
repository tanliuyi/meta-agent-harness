/**
 * 本文件提供 main 侧 worker stdio JSONL 编解码。
 */

/**
 * 将值序列化为 JSONL 记录。
 * @param value - 待序列化的值。
 * @returns JSONL 字符串行。
 */
export function serializeJsonlRecord(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

/**
 * 从 JSONL 行解析记录。
 * @param line - JSONL 行。
 * @returns 解析后的记录。
 * @throws 若行为空时抛出错误。
 */
export function parseJsonlRecord<T>(line: string): T {
  const text = line.trim()
  if (!text) {
    throw new Error('empty JSONL record')
  }
  return JSON.parse(text) as T
}
