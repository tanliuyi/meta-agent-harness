import type { ThreadMessage } from '@shared/coding-agent/types'

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
export function getMessageText(message: ThreadMessage): string | undefined {
  if (message.text) {
    return message.text
  }
  const raw = getMessageRawRecord(message)
  const content = raw.content
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return undefined
  }
  const text = content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string'
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
export function getUserMessageDisplayText(message: ThreadMessage): string | undefined {
  const text = getMessageText(message)
  if (!text) {
    return undefined
  }
  const skillBlock = parseDisplaySkillBlock(text)
  if (skillBlock) {
    const userMessage = skillBlock.userMessage ? stripHiddenFileBlocks(skillBlock.userMessage) : ''
    return userMessage
      ? `${getSkillReferenceLabel(skillBlock.name)}\n\n${userMessage}`
      : getSkillReferenceLabel(skillBlock.name)
  }

  const displayText = stripHiddenFileBlocks(text)
  return displayText || undefined
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

/**
 * 获取 user message 的展示片段，识别纯文本、@file 引用和 skill 引用。
 * @param message - Thread message。
 * @returns 用户可见展示片段。
 */
export function getUserMessageDisplaySegments(message: ThreadMessage): UserMessageDisplaySegment[] {
  const text = getMessageText(message)
  if (!text) {
    return []
  }
  const fileReferenceNames = getHiddenFileBlockNames(text)

  const skillBlock = parseDisplaySkillBlock(text)
  if (skillBlock) {
    const segments: UserMessageDisplaySegment[] = [
      {
        type: 'skillReference',
        name: skillBlock.name,
        label: getSkillReferenceLabel(skillBlock.name),
        location: skillBlock.location
      }
    ]
    const userMessage = skillBlock.userMessage ? stripHiddenFileBlocks(skillBlock.userMessage) : ''
    if (userMessage) {
      pushTextSegment(segments, '\n\n')
      segments.push(
        ...parseUserMessageDisplaySegments(userMessage, {
          allowedFileArgs: fileReferenceNames
        })
      )
    }
    return segments
  }

  const displayText = stripHiddenFileBlocks(text)
  return displayText
    ? parseUserMessageDisplaySegments(displayText, {
        allowedFileArgs: fileReferenceNames
      })
    : []
}

interface ParseUserMessageDisplaySegmentsOptions {
  allowedFileArgs?: readonly string[]
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
  const fileReferencePattern = /(^|[\s([{（【])@(?:"((?:\\.|[^"\\])*)"|([^\s`"'<>]+))/g
  let cursor = 0
  for (const match of text.matchAll(fileReferencePattern)) {
    const matchStart = match.index ?? 0
    const [rawMatch, prefix = '', quotedValue, bareValue] = match
    const rawValue = quotedValue !== undefined ? quotedValue.replace(/\\"/g, '"') : bareValue
    const fileArg = rawValue ? trimTrailingFileReferencePunctuation(rawValue) : ''
    if (!fileArg) {
      continue
    }
    if (!isAllowedFileReference(fileArg, options.allowedFileArgs)) {
      continue
    }

    const fileReferenceStart = matchStart + prefix.length
    pushTextSegment(segments, text.slice(cursor, fileReferenceStart))
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

interface ParsedDisplaySkillBlock {
  name: string
  location: string
  userMessage: string | undefined
}

function parseDisplaySkillBlock(text: string): ParsedDisplaySkillBlock | null {
  return parseSkillBlock(text) ?? parseSkillBlock(stripHiddenFileBlocks(text))
}

function parseSkillBlock(text: string): ParsedDisplaySkillBlock | null {
  const match = text.match(
    /^<skill\s+name="([^"]+)"\s+location="([^"]+)">\n?[\s\S]*?\n?<\/skill>(?:\n\n([\s\S]+))?$/
  )
  if (!match) {
    return null
  }
  return {
    name: match[1],
    location: match[2],
    userMessage: match[3]?.trim() || undefined
  }
}

function stripHiddenFileBlocks(text: string): string {
  return text.replace(/<file\b[^>]*>[\s\S]*?<\/file>\s*/g, '').trim()
}

function getHiddenFileBlockNames(text: string): string[] {
  const names: string[] = []
  const fileBlockPattern = /<file\b[^>]*\bname="([^"]+)"[^>]*>[\s\S]*?<\/file>/g
  for (const match of text.matchAll(fileBlockPattern)) {
    if (match[1]) {
      names.push(match[1])
    }
  }
  return names
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
export function getMessageFileAttachments(message: ThreadMessage): MessageFileAttachment[] {
  const text = getMessageText(message)
  if (!text) {
    return []
  }
  const attachments: MessageFileAttachment[] = []
  const fileBlockPattern = /<file\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/file>/g
  const images = getMessageImages(message)
  let imageIndex = 0
  for (const match of text.matchAll(fileBlockPattern)) {
    const [, name, body] = match
    if (!name) {
      continue
    }
    const note = body?.trim()
    const fileImageSrc = getFileAttachmentImageSrc(name)
    const inlineImage = fileImageSrc ? images[imageIndex++] : undefined
    const imageSrc = inlineImage ? getMessageImageSrc(inlineImage) : fileImageSrc
    if (!imageSrc) {
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

/**
 * 获取文件附件图片预览 URL。
 * @param filePath - 文件路径。
 * @returns 可用于 img 的 file URL。
 */
export function getFileAttachmentImageSrc(filePath: string): string | undefined {
  if (!/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(filePath)) {
    return undefined
  }
  return toFileUrl(filePath)
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
export function getMessageThinkingText(message: ThreadMessage): string | undefined {
  const raw = getMessageRawRecord(message)
  const content = raw.content
  if (!Array.isArray(content)) {
    return undefined
  }
  const thinking = content
    .filter(
      (part): part is { type: 'thinking'; thinking: string } =>
        isRecord(part) && part.type === 'thinking' && typeof part.thinking === 'string'
    )
    .map((part) => part.thinking)
    .join('')
  return thinking || undefined
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
export function getMessageImages(message: ThreadMessage): MessageImage[] {
  const content = getMessageRawRecord(message).content
  if (!Array.isArray(content)) {
    return []
  }
  return content.filter(
    (part): part is MessageImage & { type: 'image' } =>
      isRecord(part) &&
      part.type === 'image' &&
      typeof part.data === 'string' &&
      typeof part.mimeType === 'string'
  )
}

/**
 * 获取未被 <file> 附件行消费的消息图片内容。
 * @param message - Thread message。
 * @returns 独立图片列表。
 */
export function getStandaloneMessageImages(message: ThreadMessage): MessageImage[] {
  const images = getMessageImages(message)
  if (images.length === 0) {
    return []
  }
  const attachmentImageCount = getMessageFileAttachments(message).filter(
    (attachment) => attachment.isImage
  ).length
  return images.slice(attachmentImageCount)
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
 * 获取消息 raw 的对象视图。
 * @param message - Thread message。
 * @returns raw 对象。
 */
export function getMessageRawRecord(message: ThreadMessage): Record<string, unknown> {
  return isRecord(message.raw) ? message.raw : {}
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
