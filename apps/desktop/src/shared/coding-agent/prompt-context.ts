/** Desktop user prompt 中与 Pi CLI 兼容的结构化上下文。 */

export interface PromptFileContextBlock {
  type: 'file'
  name: string
  content: string
}

export interface PromptQuoteContextBlock {
  type: 'quote'
  messageId: string
  sessionEntryId?: string
  text: string
}

export interface PromptSkillContextBlock {
  type: 'skill'
  name: string
  location: string
  baseDir?: string
  content: string
}

export interface ParsedPromptContext {
  files: PromptFileContextBlock[]
  quotes: PromptQuoteContextBlock[]
  skills: PromptSkillContextBlock[]
  message: string
}

export interface ParsePromptContextOptions {
  /** 仅解析由 Desktop 序列化器生成并带来源标记的上下文。 */
  requireDesktopOrigin?: boolean
}

const desktopOriginAttribute = 'data-meta-agent-context="true"'

/**
 * 生成 Pi CLI 风格的文件上下文块。默认保持图片和 skipped 文件使用的单行格式。
 */
export function serializePromptFileContext(
  name: string,
  content: string,
  options: { multiline?: boolean } = {}
): string {
  return options.multiline
    ? `<file name="${name}" ${desktopOriginAttribute}>\n${content}\n</file>\n`
    : `<file name="${name}" ${desktopOriginAttribute}>${content}</file>\n`
}

/** 生成 Desktop skill 引用使用的 Pi CLI 兼容上下文块。 */
export function serializePromptSkillContext(
  name: string,
  location: string,
  baseDir: string,
  content: string
): string {
  return `<skill name="${name}" location="${location}" ${desktopOriginAttribute}>\nReferences are relative to ${baseDir}.\n\n${content}\n</skill>`
}

/** 将 assistant 文本引用添加到 user prompt 前方。 */
export function serializePromptQuoteContexts(
  message: string,
  quotes: readonly (Omit<PromptQuoteContextBlock, 'type'> & { type?: 'quote' })[]
): string {
  if (quotes.length === 0) return message

  const blocks = quotes.map((quote) => {
    const attributes = [
      `message_id="${escapePromptXml(quote.messageId)}"`,
      ...(quote.sessionEntryId
        ? [`session_entry_id="${escapePromptXml(quote.sessionEntryId)}"`]
        : [])
    ].join(' ')
    return `<quote ${attributes}>\n${escapePromptXml(quote.text)}\n</quote>`
  })
  return `<quoted_context ${desktopOriginAttribute}>\n${blocks.join('\n')}\n</quoted_context>\n\n${message}`
}

/**
 * 解析 Desktop user prompt 的前置上下文。
 *
 * 默认兼容历史消息；编辑恢复可要求 Desktop 来源标记，避免把用户正文提升为本地附件。
 * 所有上下文都必须位于 prompt 开头且完整可解析，否则原块保留为普通消息文本。
 */
export function parsePromptContext(
  text: string,
  options: ParsePromptContextOptions = {}
): ParsedPromptContext {
  const requireDesktopOrigin = options.requireDesktopOrigin ?? false
  const fileContext = extractFileContexts(text, requireDesktopOrigin)
  const quoteContext = extractQuoteContext(fileContext.message, requireDesktopOrigin)
  const skillContext = extractSkillContexts(quoteContext.message, requireDesktopOrigin)
  return {
    files: fileContext.files,
    quotes: quoteContext.quotes,
    skills: skillContext.skills,
    message: skillContext.message
  }
}

/** 移除排队 user prompt 中注入的上下文块，仅保留用户正文。 */
export function stripPromptContextBlocks(text: string): string | undefined {
  const message = parsePromptContext(text).message.trim()
  return message || undefined
}

/** 转义 quote 上下文中的 XML 特殊字符。 */
export function escapePromptXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 解码由 escapePromptXml 生成的 XML entity。 */
export function decodePromptXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
}

function extractFileContexts(
  text: string,
  requireDesktopOrigin: boolean
): { files: PromptFileContextBlock[]; message: string } {
  const files: PromptFileContextBlock[] = []
  let message = text
  while (true) {
    const match = message.match(/^<file\b([^>]*)>([\s\S]*?)<\/file>\s*/)
    if (!match) break
    const attributes = match[1] ?? ''
    const name = attributes.match(/\bname="([^"]+)"/)?.[1]
    if (!name || (requireDesktopOrigin && !hasDesktopOrigin(attributes))) break
    files.push({ type: 'file', name, content: match[2] ?? '' })
    message = message.slice(match[0].length)
  }
  return { files, message }
}

function extractQuoteContext(
  text: string,
  requireDesktopOrigin: boolean
): {
  quotes: PromptQuoteContextBlock[]
  message: string
} {
  const match = text.match(/^<quoted_context\b([^>]*)>\s*([\s\S]*?)\s*<\/quoted_context>\s*/)
  if (!match) return { quotes: [], message: text }
  if (requireDesktopOrigin && !hasDesktopOrigin(match[1] ?? '')) {
    return { quotes: [], message: text }
  }

  const quotes: PromptQuoteContextBlock[] = []
  const quotePattern = /<quote\b([^>]*)>([\s\S]*?)<\/quote>\s*/g
  const body = match[2] ?? ''
  let cursor = 0
  for (const quoteMatch of body.matchAll(quotePattern)) {
    if (body.slice(cursor, quoteMatch.index).trim()) return { quotes: [], message: text }
    const attributes = quoteMatch[1] ?? ''
    const encodedMessageId = attributes.match(/\bmessage_id="([^"]*)"/)?.[1]
    const encodedSessionEntryId = attributes.match(/\bsession_entry_id="([^"]*)"/)?.[1]
    const messageId = encodedMessageId ? decodePromptXml(encodedMessageId) : undefined
    const sessionEntryId = encodedSessionEntryId
      ? decodePromptXml(encodedSessionEntryId)
      : undefined
    const quoteText = decodePromptXml(quoteMatch[2] ?? '').trim()
    if (!messageId || !quoteText) return { quotes: [], message: text }
    quotes.push({
      type: 'quote',
      messageId,
      ...(sessionEntryId ? { sessionEntryId } : {}),
      text: quoteText
    })
    cursor = quoteMatch.index + quoteMatch[0].length
  }
  if (body.slice(cursor).trim()) return { quotes: [], message: text }
  return quotes.length > 0
    ? { quotes, message: text.slice(match[0].length) }
    : { quotes: [], message: text }
}

function extractSkillContexts(
  text: string,
  requireDesktopOrigin: boolean
): {
  skills: PromptSkillContextBlock[]
  message: string
} {
  let message = text
  const skills: PromptSkillContextBlock[] = []
  while (true) {
    const match = message.match(/^<skill\b([^>]*)>\n?([\s\S]*?)\n?<\/skill>\s*/)
    if (!match) break
    const attributes = match[1] ?? ''
    const name = attributes.match(/\bname="([^"]+)"/)?.[1]
    const location = attributes.match(/\blocation="([^"]+)"/)?.[1]
    if (!name || !location || (requireDesktopOrigin && !hasDesktopOrigin(attributes))) break
    const rawContent = match[2] ?? ''
    const referenceMatch = rawContent.match(/^References are relative to ([\s\S]*?)\.\n\n/)
    skills.push({
      type: 'skill',
      name,
      location,
      ...(referenceMatch?.[1] ? { baseDir: referenceMatch[1] } : {}),
      content: referenceMatch ? rawContent.slice(referenceMatch[0].length) : rawContent
    })
    message = message.slice(match[0].length)
  }
  return { skills, message }
}

function hasDesktopOrigin(attributes: string): boolean {
  return /\bdata-meta-agent-context\s*=\s*"true"/.test(attributes)
}
