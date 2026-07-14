import {
  parsePromptContext,
  stripPromptContextBlocks,
  type PromptSkillContextBlock
} from '@shared/coding-agent/prompt-context'
import type { Message } from '@ag-ui/core'

/**
 * 格式化消息时间。
 * @param value - ISO 时间。
 * @returns 本地时间。
 */
export function formatMessageTime(value: string | undefined): string {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

/**
 * 获取消息文本，优先使用派生 text，随后回退到 raw content。
 * @param message - Thread message。
 * @returns 文本。
 */
export function getMessageText(message: Message): string | undefined {
  if (typeof message.content === 'string') return message.content || undefined
  if (message.role !== 'user' || !Array.isArray(message.content)) return undefined
  const text = message.content
    .filter(
      (part): part is Extract<(typeof message.content)[number], { type: 'text' }> =>
        part.type === 'text'
    )
    .map((part) => part.text)
    .join('')
  return text || undefined
}

/**
 * 获取 user message 的桌面展示文本，隐藏 Pi @file 与 skill 上下文块。
 * @param message - Thread message。
 * @returns 用户可见文本。
 */
export function getUserMessageDisplayText(message: Message): string | undefined {
  const text = getMessageText(message)
  if (!text) {
    return undefined
  }
  const segments = getUserMessageDisplaySegmentsFromText(text)
  const quoteText = segments
    .filter(
      (segment): segment is Extract<UserMessageDisplaySegment, { type: 'quoteReference' }> =>
        segment.type === 'quoteReference'
    )
    .map((segment) => segment.text)
    .join('\n')
  const messageText = segments
    .filter((segment) => segment.type !== 'quoteReference')
    .map((segment) => {
      if (segment.type === 'text') return segment.text
      if (segment.type === 'fileReference') return `@${segment.fileArg}`
      return segment.label
    })
    .join('')
    .trim()
  const displayText = [quoteText, messageText].filter(Boolean).join('\n\n')
  return displayText || undefined
}

/**
 * 获取排队消息的展示文本，仅移除附件、引用与 skill 注入的 XML 块。
 * @param text - Pi 队列中的完整消息文本。
 * @returns XML 块之外的文本；没有剩余文本时返回 undefined。
 */
export function getQueuedUserPromptDisplayText(text: string): string | undefined {
  return stripPromptContextBlocks(text)
}

/**
 * 用户消息展示片段。
 */
export type UserMessageDisplaySegment =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'fileReference'
      fileArg: string
      label: string
    }
  | {
      type: 'skillReference'
      name: string
      label: string
      location: string
    }
  | {
      type: 'quoteReference'
      messageId?: string
      sessionEntryId?: string
      label: string
      text: string
      kind?: 'quote' | 'browser-element'
      browserRef?: string
      browserId?: string
      tagName?: string
    }

/**
 * 获取 user message 的展示片段，识别纯文本、@file 引用和 skill 引用。
 * @param message - Thread message。
 * @returns 用户可见展示片段。
 */
export function getUserMessageDisplaySegments(message: Message): UserMessageDisplaySegment[] {
  const text = getMessageText(message)
  return text ? getUserMessageDisplaySegmentsFromText(text) : []
}

interface ParseUserMessageDisplaySegmentsOptions {
  allowedFileArgs?: readonly string[]
  skillLocations?: Map<string, string>
}

/**
 * 将 Pi @file 文本解析为文件引用 chip 片段，其余内容保持纯文本。
 * @param text - 用户消息展示文本。
 * @param options - 解析选项。
 * @returns 展示片段。
 */
export function parseUserMessageDisplaySegments(
  text: string,
  options: ParseUserMessageDisplaySegmentsOptions = {}
): UserMessageDisplaySegment[] {
  const segments: UserMessageDisplaySegment[] = []
  const referencePattern =
    /(^|[\s([{（【])(?:@(?:"((?:\\.|[^"\\])*)"|([^\s`"'<>]+))|\$skill:([A-Za-z0-9_.-]+))/g
  let cursor = 0
  for (const match of text.matchAll(referencePattern)) {
    const matchStart = match.index ?? 0
    const [rawMatch, prefix = '', quotedValue, bareValue, skillName] = match
    const referenceStart = matchStart + prefix.length
    if (skillName) {
      pushTextSegment(segments, text.slice(cursor, referenceStart))
      segments.push({
        type: 'skillReference',
        name: skillName,
        label: getSkillReferenceLabel(skillName),
        location: options.skillLocations?.get(skillName) ?? ''
      })
      cursor = matchStart + rawMatch.length
      continue
    }

    const rawValue = quotedValue !== undefined ? quotedValue.replace(/\\"/g, '"') : bareValue
    const fileArg = rawValue ? trimTrailingFileReferencePunctuation(rawValue) : ''
    if (!fileArg) {
      continue
    }
    if (!isAllowedFileReference(fileArg, options.allowedFileArgs)) {
      continue
    }

    pushTextSegment(segments, text.slice(cursor, referenceStart))
    segments.push({
      type: 'fileReference',
      fileArg,
      label: getFileReferenceDisplayName(fileArg)
    })
    const trailing = rawValue.slice(fileArg.length)
    if (trailing) {
      pushTextSegment(segments, trailing)
    }
    cursor = matchStart + rawMatch.length
  }
  pushTextSegment(segments, text.slice(cursor))
  return segments
}

function isAllowedFileReference(
  fileArg: string,
  allowedFileArgs: readonly string[] | undefined
): boolean {
  if (allowedFileArgs === undefined) {
    return true
  }
  if (allowedFileArgs.length === 0) {
    return false
  }
  const normalizedFileArg = normalizeFileReferencePath(fileArg)
  return allowedFileArgs.some((allowedFileArg) => {
    const normalizedAllowed = normalizeFileReferencePath(allowedFileArg)
    return (
      normalizedAllowed === normalizedFileArg || normalizedAllowed.endsWith(`/${normalizedFileArg}`)
    )
  })
}

function pushTextSegment(segments: UserMessageDisplaySegment[], text: string): void {
  if (!text) {
    return
  }
  const previous = segments[segments.length - 1]
  if (previous?.type === 'text') {
    previous.text += text
    return
  }
  segments.push({ type: 'text', text })
}

function getSkillContextDisplaySegments(
  skills: readonly PromptSkillContextBlock[],
  userMessage: string,
  fileReferenceNames: readonly string[]
): UserMessageDisplaySegment[] {
  const skillLocations = new Map(skills.map((skill) => [skill.name, skill.location]))
  const userSegments = userMessage
    ? parseUserMessageDisplaySegments(userMessage, {
        allowedFileArgs: fileReferenceNames,
        skillLocations
      })
    : []
  const referencedSkills = new Set(
    userSegments
      .filter(
        (segment): segment is Extract<UserMessageDisplaySegment, { type: 'skillReference' }> =>
          segment.type === 'skillReference'
      )
      .map((segment) => segment.name)
  )
  const prefixSkillSegments: UserMessageDisplaySegment[] = skills
    .filter((skill) => !referencedSkills.has(skill.name))
    .map((skill) => ({
      type: 'skillReference',
      name: skill.name,
      label: getSkillReferenceLabel(skill.name),
      location: skill.location
    }))
  if (prefixSkillSegments.length === 0) {
    return userSegments
  }
  if (userSegments.length === 0) {
    return prefixSkillSegments
  }
  return [...prefixSkillSegments, { type: 'text', text: '\n\n' }, ...userSegments]
}

function getSkillReferenceLabel(name: string): string {
  return `skill:${name}`
}

function trimTrailingFileReferencePunctuation(value: string): string {
  return value.replace(/[),.，。!?！？;；:：、\]}）】]+$/g, '')
}

function getFileReferenceDisplayName(value: string): string {
  const normalized = normalizeFileReferencePath(value)
  const separatorIndex = normalized.lastIndexOf('/')
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized
}

function normalizeFileReferencePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** 用户消息中的文件附件上下文。 */
export interface MessageFileAttachment {
  /** 文件名或路径。 */
  name: string
  /** 文件上下文说明，例如图片处理失败或缩放提示。 */
  note?: string
  /** 是否为图片附件。 */
  isImage: boolean
  /** 图片附件预览 URL。 */
  imageSrc?: string
}

/**
 * 从 Pi @file 上下文块提取桌面附件行。
 * @param message - Thread message。
 * @returns 附件列表。
 */
export function getMessageFileAttachments(message: Message): MessageFileAttachment[] {
  const text = getMessageText(message)
  if (!text) {
    return []
  }
  const attachments: MessageFileAttachment[] = []
  const context = parsePromptContext(text)
  const referencedFileArgs = getUserMessageReferencedFileArgs(text)
  const images = getMessageImages(message)
  let imageIndex = 0
  for (const file of context.files) {
    const name = file.name
    const note = file.content.trim()
    const isImageName = isImageFileName(name)
    const inlineImage = isImageName ? images[imageIndex++] : undefined
    if (isImageName && isReferencedFileArg(name, referencedFileArgs)) {
      continue
    }
    const fileImageSrc = getFileAttachmentImageSrc(name)
    const imageSrc = inlineImage ? getMessageImageSrc(inlineImage) : fileImageSrc
    if (!imageSrc) {
      if (isSkippedFileAttachmentNote(note)) {
        attachments.push({
          name,
          isImage: false
        })
      }
      continue
    }
    attachments.push({
      name,
      isImage: true,
      imageSrc,
      ...(note ? { note } : {})
    })
  }
  return attachments
}

function getUserMessageReferencedFileArgs(text: string): string[] {
  return getUserMessageDisplaySegmentsFromText(text)
    .filter(
      (segment): segment is Extract<UserMessageDisplaySegment, { type: 'fileReference' }> =>
        segment.type === 'fileReference'
    )
    .map((segment) => segment.fileArg)
}

function getUserMessageDisplaySegmentsFromText(text: string): UserMessageDisplaySegment[] {
  const context = parsePromptContext(text)
  const fileReferenceNames = context.files.map((file) => file.name)
  const contentSegments =
    context.skills.length > 0
      ? getSkillContextDisplaySegments(context.skills, context.message, fileReferenceNames)
      : context.message
        ? parseUserMessageDisplaySegments(context.message, {
            allowedFileArgs: fileReferenceNames
          })
        : []
  const quoteSegments: UserMessageDisplaySegment[] = context.quotes.map((quote) => {
    const isBrowserElement = quote.messageId.startsWith('browser-element:')
    const browserTabMatch = isBrowserElement
      ? quote.text.match(/^\[Browser tab ([^,]+), element ([^:]+): <([^>]+)>(?: (.*))?\]$/s)
      : undefined
    const legacyBrowserMatch =
      isBrowserElement && !browserTabMatch
        ? quote.text.match(/^\[Browser element ([^:]+): <([^>]+)>(?: (.*))?\]$/s)
        : undefined
    return {
      type: 'quoteReference',
      label: isBrowserElement
        ? browserTabMatch?.[4] || legacyBrowserMatch?.[3] || 'Element'
        : '文本引用',
      messageId: quote.messageId,
      ...(quote.sessionEntryId ? { sessionEntryId: quote.sessionEntryId } : {}),
      text: quote.text,
      ...(isBrowserElement
        ? {
            kind: 'browser-element' as const,
            browserRef:
              browserTabMatch?.[2] ||
              legacyBrowserMatch?.[1] ||
              quote.messageId.slice('browser-element:'.length),
            ...(browserTabMatch?.[1] ? { browserId: browserTabMatch[1] } : {}),
            tagName: browserTabMatch?.[3] || legacyBrowserMatch?.[2] || 'element'
          }
        : {})
    }
  })
  if (quoteSegments.length === 0) return contentSegments
  return contentSegments.length > 0
    ? [...quoteSegments, { type: 'text', text: '\n\n' }, ...contentSegments]
    : quoteSegments
}

function isReferencedFileArg(filePath: string, referencedFileArgs: readonly string[]): boolean {
  if (referencedFileArgs.length === 0) {
    return false
  }
  const normalizedFilePath = normalizeFileReferencePath(filePath)
  return referencedFileArgs.some((fileArg) => {
    const normalizedFileArg = normalizeFileReferencePath(fileArg)
    return (
      normalizedFilePath === normalizedFileArg ||
      normalizedFilePath.endsWith(`/${normalizedFileArg}`)
    )
  })
}

function isSkippedFileAttachmentNote(note: string | undefined): boolean {
  return Boolean(note?.startsWith('[Skipped:'))
}

/**
 * 获取文件附件图片预览 URL。
 * @param filePath - 文件路径。
 * @returns 可用于 img 的 file URL。
 */
export function getFileAttachmentImageSrc(filePath: string): string | undefined {
  if (!isImageFileName(filePath) || !isAbsoluteLocalFilePath(filePath)) {
    return undefined
  }
  return toFileUrl(filePath)
}

function isImageFileName(filePath: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(filePath)
}

function isAbsoluteLocalFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/')
}

/**
 * 将本地文件路径转换为 file URL。
 * @param filePath - 本地文件路径。
 * @returns file URL。
 */
function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized[0]}:${encodePathSegments(normalized.slice(2))}`
  }
  if (normalized.startsWith('//')) {
    return `file:${encodePathSegments(normalized)}`
  }
  return `file://${encodePathSegments(normalized.startsWith('/') ? normalized : `/${normalized}`)}`
}

/**
 * 编码路径片段并保留分隔符。
 * @param path - 已归一化路径。
 * @returns 编码后的路径。
 */
function encodePathSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/**
 * 获取 assistant thinking 文本。
 * @param message - Thread message。
 * @returns thinking 文本。
 */
export function getMessageThinkingText(message: Message): string | undefined {
  return message.role === 'reasoning' ? message.content || undefined : undefined
}

/** 消息中的图片内容。 */
export interface MessageImage {
  /** MIME 类型。 */
  mimeType: string
  /** base64 图片数据。 */
  data: string
}

/**
 * 获取消息图片内容。
 * @param message - Thread message。
 * @returns 图片列表。
 */
export function getMessageImages(message: Message): MessageImage[] {
  if (message.role !== 'user' || !Array.isArray(message.content)) return []
  return message.content.flatMap((part): MessageImage[] =>
    part.type === 'image' && part.source.type === 'data'
      ? [{ mimeType: part.source.mimeType, data: part.source.value }]
      : []
  )
}

/**
 * 获取未被 <file> 附件行消费的消息图片内容。
 * @param message - Thread message。
 * @returns 独立图片列表。
 */
export function getStandaloneMessageImages(message: Message): MessageImage[] {
  const images = getMessageImages(message)
  if (images.length === 0) {
    return []
  }
  const attachmentImageCount = getImageFileContextCount(getMessageText(message))
  return images.slice(attachmentImageCount)
}

function getImageFileContextCount(text: string | undefined): number {
  if (!text) return 0
  return parsePromptContext(text).files.filter((file) => isImageFileName(file.name)).length
}

/**
 * 构造 data URL。
 * @param image - 图片内容。
 * @returns data URL。
 */
export function getMessageImageSrc(image: MessageImage): string {
  return `data:${image.mimeType};base64,${image.data}`
}

/**
 * 把未知结构转成适合 UI 展示的短 JSON。
 * @param value - 未知值。
 * @returns 展示文本。
 */
export function formatUnknown(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * 判断普通对象。
 * @param value - 值。
 * @returns 是否普通对象。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
