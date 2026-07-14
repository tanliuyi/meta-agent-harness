import { describe, expect, it } from 'vitest'
import {
  getMessageFileAttachments,
  getQueuedUserPromptDisplayText,
  getStandaloneMessageImages,
  getUserMessageDisplaySegments,
  getUserMessageDisplayText,
  parseUserMessageDisplaySegments
} from '../support/message-format'
import type { Message } from '@ag-ui/core'

describe('message-format', () => {
  it('hides Pi file context blocks from user message display text', () => {
    const message = {
      id: 'message-a',
      role: 'user',
      content:
        '<file name="/tmp/a.png">[Image omitted: could not be resized below the inline image size limit.]</file>\n' +
        '<file name="/tmp/b.png"></file>\n' +
        '请看这些图片'
    } satisfies Message

    expect(getUserMessageDisplayText(message)).toBe('请看这些图片')
    expect(getMessageFileAttachments(message)).toEqual([
      {
        name: '/tmp/a.png',
        isImage: true,
        imageSrc: 'file:///tmp/a.png',
        note: '[Image omitted: could not be resized below the inline image size limit.]'
      },
      {
        name: '/tmp/b.png',
        isImage: true,
        imageSrc: 'file:///tmp/b.png'
      }
    ])
  })

  it('removes only injected XML blocks from queued message summaries', () => {
    expect(getQueuedUserPromptDisplayText('请分析这些图片')).toBe('请分析这些图片')
    expect(
      getQueuedUserPromptDisplayText(
        '<file name="/repo/src/App.vue">source</file>\n请修复 @src/App.vue'
      )
    ).toBe('请修复 @src/App.vue')
    expect(
      getQueuedUserPromptDisplayText(
        '<quoted_context><quote message_id="message-a">引用正文</quote></quoted_context>\n\n请检查结论'
      )
    ).toBe('请检查结论')
    expect(
      getQueuedUserPromptDisplayText(
        '<skill name="review" location="/skills/review/SKILL.md">skill body</skill>\n\n$skill:review 检查代码'
      )
    ).toBe('$skill:review 检查代码')
  })

  it('hides queued entries only when XML block removal leaves no text', () => {
    expect(
      getQueuedUserPromptDisplayText('<file name="E:\\Temp\\image.png"></file>')
    ).toBeUndefined()
    expect(
      getQueuedUserPromptDisplayText(
        '<quoted_context><quote message_id="message-a">引用正文</quote></quoted_context>'
      )
    ).toBeUndefined()
    expect(
      getQueuedUserPromptDisplayText('<file name="E:\\Temp\\image.png"></file>\n请分析这些图片')
    ).toBe('请分析这些图片')
    expect(
      getQueuedUserPromptDisplayText(
        '<quoted_context><quote message_id="message-a">引用正文</quote></quoted_context>\n\n请基于引用内容回答'
      )
    ).toBe('请基于引用内容回答')
  })

  it('keeps Windows drive separators valid in image file URLs', () => {
    const message = {
      id: 'message-b',
      role: 'user',
      content: '<file name="E:\\Temp\\image with space.png"></file>'
    } satisfies Message

    expect(getMessageFileAttachments(message)[0]?.imageSrc).toBe(
      'file:///E:/Temp/image%20with%20space.png'
    )
  })

  it('renders file attachment image rows from raw image content without duplicating standalone images', () => {
    const message = {
      id: 'message-c',
      role: 'user',
      content: [
        { type: 'text', text: '<file name="E:\\Temp\\pasted.png"></file>\n看这张' },
        {
          type: 'image',
          source: { type: 'data', value: 'abc', mimeType: 'image/png' }
        }
      ]
    } satisfies Message

    expect(getMessageFileAttachments(message)[0]).toMatchObject({
      name: 'E:\\Temp\\pasted.png',
      isImage: true,
      imageSrc: 'data:image/png;base64,abc'
    })
    expect(getStandaloneMessageImages(message)).toEqual([])
  })

  it('does not render visible @image path references as image attachments', () => {
    const message = {
      id: 'message-relative-image',
      role: 'user',
      content: [
        { type: 'text', text: '<file name="hero.jpg"></file>\n使用 @hero.jpg 作为背景' },
        {
          type: 'image',
          source: { type: 'data', value: 'abc', mimeType: 'image/jpeg' }
        }
      ]
    } satisfies Message

    expect(getMessageFileAttachments(message)).toEqual([])
    expect(getStandaloneMessageImages(message)).toEqual([])
  })

  it('does not render relative @image references as broken file URLs without image content', () => {
    const message = {
      id: 'message-relative-image-missing-content',
      role: 'user',
      content: '<file name="hero.jpg"></file>\n使用 @hero.jpg 作为背景'
    } satisfies Message

    expect(getMessageFileAttachments(message)).toEqual([])
  })

  it('does not render absolute image file blocks when represented by a visible relative @path', () => {
    const message = {
      id: 'message-absolute-image-reference',
      role: 'user',
      content:
        '<file name="/Users/tanliuyi/projects/meta-agent-harness/apps/desktop/resources/icon.png">' +
        '[Image omitted: could not be resized below the inline image size limit.]</file>\n' +
        '@apps/desktop/resources/icon.png 这是测试'
    } satisfies Message

    expect(getMessageFileAttachments(message)).toEqual([])
    expect(getUserMessageDisplaySegments(message)).toEqual([
      {
        type: 'fileReference',
        fileArg: 'apps/desktop/resources/icon.png',
        label: 'icon.png'
      },
      { type: 'text', text: ' 这是测试' }
    ])
  })

  it('does not render text @file blocks as expanded attachment rows', () => {
    const message = {
      id: 'message-d',
      role: 'user',
      content: '<file name="README.md">\nHello\n</file>\n请看 @README.md'
    } satisfies Message

    expect(getMessageFileAttachments(message)).toEqual([])
    expect(getUserMessageDisplayText(message)).toBe('请看 @README.md')
  })

  it('renders skipped non-image file paths as attachment rows without skipped text', () => {
    const message = {
      id: 'message-docx',
      role: 'user',
      content:
        '<file name="E:\\Temp\\只看气温系统需求变更文档_v1.3.docx">[Skipped: 不是支持的文本或图片文件.]</file>\n' +
        '请处理这些文件'
    } satisfies Message

    expect(getMessageFileAttachments(message)).toEqual([
      {
        name: 'E:\\Temp\\只看气温系统需求变更文档_v1.3.docx',
        isImage: false
      }
    ])
    expect(getUserMessageDisplayText(message)).toBe('请处理这些文件')
  })

  it('renders quoted context as text reference chips without exposing its body', () => {
    const message = {
      id: 'message-quote',
      role: 'user',
      content:
        '<quoted_context>\n' +
        '<quote message_id="message-186" session_entry_id="entry-a">\n' +
        '第一段 &lt;引用&gt; &amp; 正文\n' +
        '</quote>\n' +
        '<quote message_id="message-187">\n' +
        '另一段引用正文\n' +
        '</quote>\n' +
        '</quoted_context>\n\n' +
        '请基于引用内容回答'
    } satisfies Message

    expect(getUserMessageDisplayText(message)).toBe(
      '第一段 <引用> & 正文\n另一段引用正文\n\n请基于引用内容回答'
    )
    expect(getUserMessageDisplaySegments(message)).toEqual([
      {
        type: 'quoteReference',
        label: '文本引用',
        messageId: 'message-186',
        sessionEntryId: 'entry-a',
        text: '第一段 <引用> & 正文'
      },
      {
        type: 'quoteReference',
        label: '文本引用',
        messageId: 'message-187',
        text: '另一段引用正文'
      },
      { type: 'text', text: '\n\n' },
      { type: 'text', text: '请基于引用内容回答' }
    ])
  })

  it('renders Browser element context as a typed reference chip', () => {
    const message = {
      id: 'message-browser-element',
      role: 'user',
      content:
        '<quoted_context data-meta-agent-context="true">\n' +
        '<quote message_id="browser-element:ref-picked-1">\n' +
        '[Browser tab tab-a, element ref-picked-1: &lt;button&gt; Save changes]\n' +
        '</quote>\n' +
        '</quoted_context>\n\n' +
        '请基于引用内容回答'
    } satisfies Message

    expect(getUserMessageDisplaySegments(message)).toEqual([
      {
        type: 'quoteReference',
        kind: 'browser-element',
        label: 'Save changes',
        messageId: 'browser-element:ref-picked-1',
        browserRef: 'ref-picked-1',
        browserId: 'tab-a',
        tagName: 'button',
        text: '[Browser tab tab-a, element ref-picked-1: <button> Save changes]'
      },
      { type: 'text', text: '\n\n' },
      { type: 'text', text: '请基于引用内容回答' }
    ])
  })

  it('parses bare @file references as inline display segments', () => {
    expect(parseUserMessageDisplaySegments('请看 @src/App.vue。')).toEqual([
      { type: 'text', text: '请看 ' },
      { type: 'fileReference', fileArg: 'src/App.vue', label: 'App.vue' },
      { type: 'text', text: '。' }
    ])
  })

  it('parses quoted @file references while keeping markdown syntax as plain text', () => {
    expect(parseUserMessageDisplaySegments('请看 @"docs/a b.md"，**重点** `code`')).toEqual([
      { type: 'text', text: '请看 ' },
      { type: 'fileReference', fileArg: 'docs/a b.md', label: 'a b.md' },
      { type: 'text', text: '，**重点** `code`' }
    ])
  })

  it('keeps @text literal when no real file context backs it', () => {
    const message = {
      id: 'message-text-at',
      role: 'user',
      content: 'Select 选项使用 @tanstack 的虚拟库'
    } satisfies Message

    expect(getUserMessageDisplaySegments(message)).toEqual([
      { type: 'text', text: 'Select 选项使用 @tanstack 的虚拟库' }
    ])
  })

  it('only renders @file chips when they match hidden file context blocks', () => {
    expect(
      parseUserMessageDisplaySegments('请看 @src/App.vue 和 @tanstack', {
        allowedFileArgs: ['/Users/me/project/src/App.vue']
      })
    ).toEqual([
      { type: 'text', text: '请看 ' },
      { type: 'fileReference', fileArg: 'src/App.vue', label: 'App.vue' },
      { type: 'text', text: ' 和 @tanstack' }
    ])
  })

  it('builds user message display segments after hiding Pi file context blocks', () => {
    const message = {
      id: 'message-e',
      role: 'user',
      content: '<file name="/Users/me/project/src/App.vue">Hello</file>\n修复 @src/App.vue'
    } satisfies Message

    expect(getUserMessageDisplaySegments(message)).toEqual([
      { type: 'text', text: '修复 ' },
      { type: 'fileReference', fileArg: 'src/App.vue', label: 'App.vue' }
    ])
  })

  it('renders Pi skill command wrappers as a compact skill segment', () => {
    const message = {
      id: 'message-f',
      role: 'user',
      content:
        '<skill name="pdf" location="/Users/me/.agents/skills/pdf/SKILL.md">\n' +
        'References are relative to /Users/me/.agents/skills/pdf.\n\n' +
        '# PDF\n\nUse the skill body.\n' +
        '</skill>'
    } satisfies Message

    expect(getUserMessageDisplayText(message)).toBe('skill:pdf')
    expect(getUserMessageDisplaySegments(message)).toEqual([
      {
        type: 'skillReference',
        name: 'pdf',
        label: 'skill:pdf',
        location: '/Users/me/.agents/skills/pdf/SKILL.md'
      }
    ])
  })

  it('keeps skill command arguments visible and parses file chips inside them', () => {
    const message = {
      id: 'message-g',
      role: 'user',
      content:
        '<file name="/Users/me/project/src/App.vue">Hello</file>\n' +
        '<skill name="review" location="/Users/me/.agents/skills/review/SKILL.md">\n' +
        '# Review\n\nUse the skill body.\n' +
        '</skill>\n\n' +
        '检查 @src/App.vue'
    } satisfies Message

    expect(getUserMessageDisplayText(message)).toBe('skill:review\n\n检查 @src/App.vue')
    expect(getUserMessageDisplaySegments(message)).toEqual([
      {
        type: 'skillReference',
        name: 'review',
        label: 'skill:review',
        location: '/Users/me/.agents/skills/review/SKILL.md'
      },
      { type: 'text', text: '\n\n' },
      { type: 'text', text: '检查 ' },
      { type: 'fileReference', fileArg: 'src/App.vue', label: 'App.vue' }
    ])
  })
})
