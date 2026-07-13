import type { JSONContent } from '@tiptap/core'

/** 比较完整 Tiptap JSON，不能只比较投影后的纯文本。 */
export function isSamePlainTextEditorDocument(left: JSONContent, right: JSONContent): boolean {
  if (left === right) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}
