import { describe, expect, it } from 'vitest'
import {
  parsePromptContext,
  serializePromptFileContext,
  serializePromptQuoteContexts,
  serializePromptSkillContext,
  stripPromptContextBlocks
} from '../prompt-context'

describe('prompt-context', () => {
  it('preserves Pi CLI-compatible file layouts exactly', () => {
    expect(serializePromptFileContext('C:\\repo\\image.png', 'resized')).toBe(
      '<file name="C:\\repo\\image.png" data-meta-agent-context="true">resized</file>\n'
    )
    expect(
      serializePromptFileContext('C:\\repo\\README.md', 'line one\r\nline two', {
        multiline: true
      })
    ).toBe(
      '<file name="C:\\repo\\README.md" data-meta-agent-context="true">\nline one\r\nline two\n</file>\n'
    )
  })

  it('preserves skill and quote wire formats exactly', () => {
    const skill = serializePromptSkillContext(
      'review',
      'C:\\skills\\review\\SKILL.md',
      'C:\\skills\\review',
      '# Review\n\nCheck carefully.'
    )
    expect(skill).toBe(
      '<skill name="review" location="C:\\skills\\review\\SKILL.md" data-meta-agent-context="true">\n' +
        'References are relative to C:\\skills\\review.\n\n' +
        '# Review\n\nCheck carefully.\n' +
        '</skill>'
    )
    expect(
      serializePromptQuoteContexts(`${skill}\n\nanswer`, [
        {
          messageId: 'assistant-<1>',
          sessionEntryId: 'entry-"1"',
          text: 'a < b && c > d'
        }
      ])
    ).toBe(
      '<quoted_context data-meta-agent-context="true">\n' +
        '<quote message_id="assistant-&lt;1&gt;" session_entry_id="entry-&quot;1&quot;">\n' +
        'a &lt; b &amp;&amp; c &gt; d\n' +
        '</quote>\n' +
        '</quoted_context>\n\n' +
        skill +
        '\n\nanswer'
    )
  })

  it('round-trips escaped quote identifiers without double escaping', () => {
    const serialized = serializePromptQuoteContexts('answer', [
      {
        messageId: 'assistant-<1>',
        sessionEntryId: 'entry-"1"',
        text: 'quoted & text'
      }
    ])
    const parsed = parsePromptContext(serialized)

    expect(parsed.quotes).toEqual([
      {
        type: 'quote',
        messageId: 'assistant-<1>',
        sessionEntryId: 'entry-"1"',
        text: 'quoted & text'
      }
    ])
    expect(serializePromptQuoteContexts(parsed.message, parsed.quotes)).toBe(serialized)
  })

  it('parses combined historical prompt context for renderer and editor restoration', () => {
    const text =
      '<file name="C:\\repo\\src\\App.vue">\nsource\n</file>\n' +
      '<quoted_context>\n' +
      '<quote message_id="assistant-a" session_entry_id="entry-a">\n' +
      'x &lt; y\n' +
      '</quote>\n' +
      '</quoted_context>\n\n' +
      '<skill name="review" location="C:\\skills\\review\\SKILL.md">\n' +
      'References are relative to C:\\skills\\review.\n\n' +
      '# Review\n' +
      '</skill>\n\n' +
      '检查 @src/App.vue'

    expect(parsePromptContext(text)).toEqual({
      files: [
        {
          type: 'file',
          name: 'C:\\repo\\src\\App.vue',
          content: '\nsource\n'
        }
      ],
      quotes: [
        {
          type: 'quote',
          messageId: 'assistant-a',
          sessionEntryId: 'entry-a',
          text: 'x < y'
        }
      ],
      skills: [
        {
          type: 'skill',
          name: 'review',
          location: 'C:\\skills\\review\\SKILL.md',
          baseDir: 'C:\\skills\\review',
          content: '# Review'
        }
      ],
      message: '检查 @src/App.vue'
    })
    expect(stripPromptContextBlocks(text)).toBe('检查 @src/App.vue')
  })

  it('only elevates Desktop-marked context during editor restoration', () => {
    const userXml =
      '<file name="config.txt">sample</file>\n' +
      '<skill name="review" location="C:\\secrets\\token.txt">body</skill>\n' +
      'explain this XML'

    expect(parsePromptContext(userXml, { requireDesktopOrigin: true })).toEqual({
      files: [],
      quotes: [],
      skills: [],
      message: userXml
    })

    const generated = serializePromptFileContext('C:\\repo\\config.txt', 'sample') + 'explain'
    expect(parsePromptContext(generated, { requireDesktopOrigin: true })).toMatchObject({
      files: [{ type: 'file', name: 'C:\\repo\\config.txt', content: 'sample' }],
      message: 'explain'
    })
  })

  it('preserves plain editor text exactly when no context was injected', () => {
    expect(parsePromptContext('  hello\n')).toEqual({
      files: [],
      quotes: [],
      skills: [],
      message: '  hello\n'
    })
  })

  it('keeps malformed or partially parsed context visible instead of swallowing user text', () => {
    const malformed = '<quoted_context><quote message_id="a">missing close</quoted_context>\nhello'
    expect(parsePromptContext(malformed)).toMatchObject({
      quotes: [],
      message: malformed
    })

    const unnamedFile = '<file>must stay visible</file>\nhello'
    expect(parsePromptContext(unnamedFile)).toMatchObject({ files: [], message: unnamedFile })

    const partialQuote =
      '<quoted_context><quote message_id="a">valid</quote>unparsed</quoted_context>\nhello'
    expect(parsePromptContext(partialQuote)).toMatchObject({
      quotes: [],
      message: partialQuote
    })
  })
})
