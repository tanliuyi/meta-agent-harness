import { describe, expect, it } from 'vitest'
import {
  assertPromptImagePayload,
  assertResolvedPromptImages,
  MAX_PROMPT_IMAGE_COUNT
} from '../coding-agent/prompt-image-limits'

const image = { type: 'image' as const, mimeType: 'image/png', data: 'YQ==' }

describe('prompt image limits', () => {
  it('合并 inline 与 file fallback 后统一限制数量', () => {
    expect(() =>
      assertPromptImagePayload({
        images: Array.from({ length: MAX_PROMPT_IMAGE_COUNT }, () => image),
        imageFiles: [{ path: 'extra.png', inlineFallback: image }]
      })
    ).toThrow('最多添加')
  })

  it('拒绝伪造或非规范 base64', () => {
    expect(() =>
      assertPromptImagePayload({
        images: [{ ...image, data: 'not-base64' }]
      })
    ).toThrow('base64')
  })

  it('最终 worker 图片集合再次执行同一配额', () => {
    expect(() =>
      assertResolvedPromptImages(
        Array.from({ length: MAX_PROMPT_IMAGE_COUNT + 1 }, () => image)
      )
    ).toThrow('最多添加')
  })
})
