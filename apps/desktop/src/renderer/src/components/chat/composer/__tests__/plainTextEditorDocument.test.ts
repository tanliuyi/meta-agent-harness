import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { isSamePlainTextEditorDocument } from '../plainTextEditorDocument'

function skillDocument(path: string, baseDir: string): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'skillReference',
            attrs: {
              name: 'deploy',
              label: 'skill:deploy',
              path,
              baseDir
            }
          }
        ]
      }
    ]
  }
}

describe('plainTextEditorDocument', () => {
  it('相同纯文本下仍识别 skill 结构化 metadata 变化', () => {
    const previous = skillDocument('C:/skills/deploy/SKILL.md', 'C:/skills/deploy')
    const next = skillDocument('D:/project/.agents/deploy/SKILL.md', 'D:/project/.agents/deploy')

    expect(isSamePlainTextEditorDocument(previous, next)).toBe(false)
  })

  it('接受结构完全相同但引用不同的 JSON 文档', () => {
    const document = skillDocument('C:/skills/deploy/SKILL.md', 'C:/skills/deploy')

    expect(isSamePlainTextEditorDocument(document, structuredClone(document))).toBe(true)
  })
})
