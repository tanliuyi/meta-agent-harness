import { describe, expect, it } from 'vitest'
import {
  canReuseMarkdownAppendPrefix,
  createVirtualMarkdownChunkRows,
  stabilizeMarkdownNodeChunks,
  stabilizeMarkdownNodes
} from '../streamingMarkdownProjection'

describe('stabilizeMarkdownNodes', () => {
  it('复用结构未变化的 Markdown 前缀', () => {
    const initialNodes = [
      { type: 'heading', raw: '# Title' },
      { type: 'paragraph', raw: 'Stable' },
      { type: 'code_block', code: 'const a = 1' }
    ]
    const initial = stabilizeMarkdownNodes(initialNodes, undefined)
    const updated = stabilizeMarkdownNodes(
      [
        { type: 'heading', raw: '# Title' },
        { type: 'paragraph', raw: 'Stable' },
        { type: 'code_block', code: 'const a = 1\nconst b = 2' }
      ],
      initial
    )

    expect(updated.nodes[0]).toBe(initial.nodes[0])
    expect(updated.nodes[1]).toBe(initial.nodes[1])
    expect(updated.nodes[2]).not.toBe(initial.nodes[2])
  })

  it('结构完全相同时复用结果数组', () => {
    const initial = stabilizeMarkdownNodes([{ type: 'paragraph', raw: 'Stable' }], undefined)
    const unchanged = stabilizeMarkdownNodes([{ type: 'paragraph', raw: 'Stable' }], initial)

    expect(unchanged).toBe(initial)
  })

  it('append-only fast path 仅重新校验可能增长的尾节点', () => {
    const stablePrefix = { type: 'table', raw: 'large stable table' } as {
      type: string
      raw: string
      self?: unknown
    }
    stablePrefix.self = stablePrefix
    const initial = stabilizeMarkdownNodes(
      [stablePrefix, { type: 'code_block', code: 'const a = 1' }],
      undefined
    )
    const updated = stabilizeMarkdownNodes(
      [
        { type: 'table', raw: 'large stable table' },
        { type: 'code_block', code: 'const a = 1\nconst b = 2' }
      ],
      initial,
      { stablePrefixLength: 1 }
    )

    expect(updated.nodes[0]).toBe(initial.nodes[0])
    expect(updated.nodes[1]).not.toBe(initial.nodes[1])
  })

  it('仅为不含引用定义的 append 开启稳定前缀', () => {
    expect(canReuseMarkdownAppendPrefix('Paragraph\n', 'Paragraph\nmore')).toBe(true)
    expect(
      canReuseMarkdownAppendPrefix('Paragraph [ref]\n', 'Paragraph [ref]\n\n[ref]: /url')
    ).toBe(false)
    expect(canReuseMarkdownAppendPrefix('Paragraph\n[ref', 'Paragraph\n[ref]: /url')).toBe(false)
    expect(canReuseMarkdownAppendPrefix('Paragraph[^1].\n', 'Paragraph[^1].\n\n[^1]: note')).toBe(
      false
    )
    expect(canReuseMarkdownAppendPrefix('first', 'changed')).toBe(false)
  })

  it('仅替换包含变化尾节点的渲染 chunk', () => {
    const initialNodes = Array.from({ length: 34 }, (_, index) => ({ index }))
    const initial = stabilizeMarkdownNodeChunks(initialNodes, undefined, 16)
    const updatedNodes = [...initialNodes]
    updatedNodes[33] = { index: 34 }
    const updated = stabilizeMarkdownNodeChunks(updatedNodes, initial, 16)

    expect(updated).not.toBe(initial)
    expect(updated[0]).toBe(initial[0])
    expect(updated[1]).toBe(initial[1])
    expect(updated[2]).not.toBe(initial[2])
    expect(updated[2]?.nodes).toEqual([{ index: 32 }, { index: 34 }])
    expect(stabilizeMarkdownNodeChunks(updatedNodes, updated, 16)).toBe(updated)
  })

  it('将虚拟窗口映射到稳定 Markdown chunks', () => {
    const chunks = stabilizeMarkdownNodeChunks(
      Array.from({ length: 40 }, (_, index) => ({ index })),
      undefined,
      16
    )
    const virtualItems = [
      { index: 1, start: 320 },
      { index: 2, start: 640 }
    ]

    const rows = createVirtualMarkdownChunkRows(virtualItems, chunks)

    expect(rows).toEqual([
      { chunk: chunks[1], virtualItem: virtualItems[0] },
      { chunk: chunks[2], virtualItem: virtualItems[1] }
    ])
  })

  it('忽略虚拟窗口中过期的 chunk index', () => {
    const chunks = stabilizeMarkdownNodeChunks([{ index: 0 }], undefined, 16)
    const validItem = { index: 0, start: 0 }

    expect(createVirtualMarkdownChunkRows([validItem, { index: 3, start: 960 }], chunks)).toEqual([
      { chunk: chunks[0], virtualItem: validItem }
    ])
    expect(createVirtualMarkdownChunkRows([], chunks)).toEqual([])
  })

  it('中间节点变化时不复用后续节点', () => {
    const initial = stabilizeMarkdownNodes(
      [
        { type: 'heading', raw: 'A' },
        { type: 'paragraph', raw: 'B' },
        { type: 'paragraph', raw: 'C' }
      ],
      undefined
    )
    const updated = stabilizeMarkdownNodes(
      [
        { type: 'heading', raw: 'A' },
        { type: 'paragraph', raw: 'changed' },
        { type: 'paragraph', raw: 'C' }
      ],
      initial
    )

    expect(updated.nodes[0]).toBe(initial.nodes[0])
    expect(updated.nodes[1]).not.toBe(initial.nodes[1])
    expect(updated.nodes[2]).not.toBe(initial.nodes[2])
  })
})
