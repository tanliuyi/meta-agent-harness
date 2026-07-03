import { describe, expect, it } from 'vitest'
import {
  getMessageFileAttachments,
  getStandaloneMessageImages,
  getUserMessageDisplayText
} from '../message-format'
import type { ThreadMessage } from '@shared/coding-agent/types'

describe('message-format', () => {
  it('hides Pi file context blocks from user message display text', () => {
    const message = {
      id: 'message-a',
      role: 'user',
      text:
        '<file name="a.png">[Image omitted: could not be resized below the inline image size limit.]</file>\n' +
        '<file name="b.png"></file>\n' +
        '请看这些图片',
      raw: {
        role: 'user',
        content: '请看这些图片',
        timestamp: 1783036800000
      },
      createdAt: '2026-07-03T00:00:00.000Z'
    } satisfies ThreadMessage

    expect(getUserMessageDisplayText(message)).toBe('请看这些图片')
    expect(getMessageFileAttachments(message)).toEqual([
      {
        name: 'a.png',
        isImage: true,
        imageSrc: 'file:///a.png',
        note: '[Image omitted: could not be resized below the inline image size limit.]'
      },
      {
        name: 'b.png',
        isImage: true,
        imageSrc: 'file:///b.png'
      }
    ])
  })

  it('keeps Windows drive separators valid in image file URLs', () => {
    const message = {
      id: 'message-b',
      role: 'user',
      text: '<file name="E:\\Temp\\image with space.png"></file>',
      raw: {
        role: 'user',
        content: 'image',
        timestamp: 1783036800000
      },
      createdAt: '2026-07-03T00:00:00.000Z'
    } satisfies ThreadMessage

    expect(getMessageFileAttachments(message)[0]?.imageSrc).toBe(
      'file:///E:/Temp/image%20with%20space.png'
    )
  })

  it('renders file attachment image rows from raw image content without duplicating standalone images', () => {
    const message = {
      id: 'message-c',
      role: 'user',
      text: '<file name="E:\\Temp\\pasted.png"></file>\n看这张',
      raw: {
        role: 'user',
        content: [
          { type: 'text', text: '<file name="E:\\Temp\\pasted.png"></file>\n看这张' },
          { type: 'image', mimeType: 'image/png', data: 'abc' }
        ],
        timestamp: 1783036800000
      },
      createdAt: '2026-07-03T00:00:00.000Z'
    } satisfies ThreadMessage

    expect(getMessageFileAttachments(message)[0]).toMatchObject({
      name: 'E:\\Temp\\pasted.png',
      isImage: true,
      imageSrc: 'data:image/png;base64,abc'
    })
    expect(getStandaloneMessageImages(message)).toEqual([])
  })

  it('does not render text @file blocks as expanded attachment rows', () => {
    const message = {
      id: 'message-d',
      role: 'user',
      text: '<file name="README.md">\nHello\n</file>\n请看 @README.md',
      raw: {
        role: 'user',
        content: '<file name="README.md">\nHello\n</file>\n请看 @README.md',
        timestamp: 1783036800000
      },
      createdAt: '2026-07-03T00:00:00.000Z'
    } satisfies ThreadMessage

    expect(getMessageFileAttachments(message)).toEqual([])
    expect(getUserMessageDisplayText(message)).toBe('请看 @README.md')
  })
})
