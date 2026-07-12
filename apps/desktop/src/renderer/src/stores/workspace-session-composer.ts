import type { JSONContent } from '@tiptap/vue-3'
import {
  parsePromptContext,
  type PromptSkillContextBlock
} from '@shared/coding-agent/prompt-context'
import type {
  PromptImage,
  PromptImageAttachment,
  PromptImageFile,
  PromptQuoteContext
} from '@shared/coding-agent/types'

/** Composer 中尚未发送的图片附件。 */
export type ComposerImageAttachment = PromptImageAttachment & {
  /** 前端稳定 ID。 */
  id: string
}

/** Composer 中尚未发送的文件路径附件。 */
export type ComposerFileAttachment = {
  /** 前端稳定 ID。 */
  id: string
  /** 本地文件绝对路径。 */
  path: string
  /** 原始文件名。 */
  name: string
  /** 原始文件大小，字节。 */
  size: number
}

/** Composer 中尚未发送的 assistant 文本引用。 */
export type ComposerQuoteAttachment = PromptQuoteContext & {
  /** 前端稳定 ID。 */
  id: string
  /** Browser element references reuse the quote chip without becoming quote context. */
  kind?: 'quote' | 'browser-element'
  browserRef?: string
  tagName?: string
  label?: string
}

/**
 * 创建空白 Composer 文档。
 * @returns Tiptap 空文档。
 */
export function createEmptyComposerContent(): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph'
      }
    ]
  }
}

/**
 * 从纯文本创建 Composer 文档。
 * @param text - 纯文本。
 * @returns Tiptap 文档。
 */
export function createComposerContentFromText(text: string): JSONContent {
  const lines = text.split('\n')
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: lines.flatMap((line, index) => {
          const nodes: JSONContent[] = []
          if (index > 0) {
            nodes.push({ type: 'hardBreak' })
          }
          if (line) {
            nodes.push({ type: 'text', text: line })
          }
          return nodes
        })
      }
    ]
  }
}

/** 从 session tree 回传的原始 prompt 恢复 Composer 结构化草稿。 */
export function restoreComposerPromptDraft(
  text: string,
  cwd: string
): {
  content: JSONContent
  files: ComposerFileAttachment[]
  quotes: ComposerQuoteAttachment[]
} {
  const context = parsePromptContext(text, { requireDesktopOrigin: true })
  const referencedFileNames = new Set<string>()
  const referencedSkillNames = new Set<string>()
  const content = createComposerContentFromPromptMessage(
    context.message,
    context.files.map((file) => file.name),
    context.skills,
    referencedFileNames,
    referencedSkillNames,
    cwd
  )
  const paragraph = content.content?.[0]
  const unreferencedSkills = context.skills.filter((skill) => !referencedSkillNames.has(skill.name))
  if (paragraph && unreferencedSkills.length > 0) {
    const prefix = unreferencedSkills.flatMap((skill, index): JSONContent[] => [
      ...(index > 0 ? [{ type: 'text', text: ' ' }] : []),
      createSkillReferenceNode(skill)
    ])
    paragraph.content = [
      ...prefix,
      ...(paragraph.content?.length
        ? [{ type: 'hardBreak' }, { type: 'hardBreak' }, ...paragraph.content]
        : [])
    ]
  }

  return {
    content,
    files: context.files
      .filter((file) => !referencedFileNames.has(file.name))
      .map((file) => ({
        id: `file-${crypto.randomUUID()}`,
        path: file.name,
        name: getPathBaseName(file.name),
        size: new TextEncoder().encode(file.content).byteLength
      })),
    quotes: context.quotes.map((quote) => ({
      id: `quote-${crypto.randomUUID()}`,
      messageId: quote.messageId,
      ...(quote.sessionEntryId ? { sessionEntryId: quote.sessionEntryId } : {}),
      text: quote.text
    }))
  }
}

function createComposerContentFromPromptMessage(
  text: string,
  fileNames: readonly string[],
  skills: readonly PromptSkillContextBlock[],
  referencedFileNames: Set<string>,
  referencedSkillNames: Set<string>,
  cwd: string
): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text
          .split('\n')
          .flatMap((line, index) => [
            ...(index > 0 ? [{ type: 'hardBreak' }] : []),
            ...parsePromptLine(
              line,
              fileNames,
              skills,
              referencedFileNames,
              referencedSkillNames,
              cwd
            )
          ])
      }
    ]
  }
}

function parsePromptLine(
  line: string,
  fileNames: readonly string[],
  skills: readonly PromptSkillContextBlock[],
  referencedFileNames: Set<string>,
  referencedSkillNames: Set<string>,
  cwd: string
): JSONContent[] {
  const nodes: JSONContent[] = []
  const referencePattern = /@(?:"((?:\\.|[^"\\])*)"|([^\s`"'<>]+))|\$skill:([A-Za-z0-9_.-]+)/g
  let cursor = 0
  for (const match of line.matchAll(referencePattern)) {
    const start = match.index ?? 0
    const [rawMatch, quotedFileArg, bareFileArg, skillName] = match
    if (skillName) {
      const skill = skills.find((candidate) => candidate.name === skillName)
      if (!skill) continue
      pushComposerTextNode(nodes, line.slice(cursor, start))
      nodes.push(createSkillReferenceNode(skill))
      referencedSkillNames.add(skill.name)
      cursor = start + rawMatch.length
      continue
    }

    const rawFileArg =
      quotedFileArg !== undefined ? quotedFileArg.replace(/\\"/g, '"') : bareFileArg
    const fileArg = rawFileArg ? trimTrailingFileReferencePunctuation(rawFileArg) : ''
    const fileName = fileArg ? findMatchingFileName(fileArg, fileNames, cwd) : undefined
    if (!fileName) continue
    pushComposerTextNode(nodes, line.slice(cursor, start))
    nodes.push({
      type: 'fileReference',
      attrs: { fileArg, label: getPathBaseName(fileArg) }
    })
    referencedFileNames.add(fileName)
    const trailing = rawFileArg?.slice(fileArg.length)
    if (trailing) pushComposerTextNode(nodes, trailing)
    cursor = start + rawMatch.length
  }
  pushComposerTextNode(nodes, line.slice(cursor))
  return nodes
}

function createSkillReferenceNode(skill: PromptSkillContextBlock): JSONContent {
  return {
    type: 'skillReference',
    attrs: {
      name: `skill:${skill.name}`,
      label: `skill:${skill.name}`,
      path: skill.location,
      baseDir: skill.baseDir ?? getPathDirectory(skill.location)
    }
  }
}

function pushComposerTextNode(nodes: JSONContent[], text: string): void {
  if (!text) return
  const previous = nodes.at(-1)
  if (previous?.type === 'text') {
    previous.text = `${previous.text ?? ''}${text}`
  } else {
    nodes.push({ type: 'text', text })
  }
}

function findMatchingFileName(
  fileArg: string,
  fileNames: readonly string[],
  cwd: string
): string | undefined {
  const resolvedFileArg = resolvePromptPath(fileArg, cwd)
  return fileNames.find((fileName) => resolvePromptPath(fileName, cwd) === resolvedFileArg)
}

function resolvePromptPath(value: string, cwd: string): string {
  const normalizedValue = normalizePath(value)
  const combined = isAbsolutePath(normalizedValue)
    ? normalizedValue
    : `${normalizePath(cwd).replace(/\/+$/, '')}/${normalizedValue}`
  return normalizeAbsolutePath(combined)
}

function normalizeAbsolutePath(value: string): string {
  const normalized = normalizePath(value)
  const drive = normalized.match(/^([A-Za-z]:)(?:\/|$)/)?.[1]
  const isUnc = normalized.startsWith('//')
  const absolute = Boolean(drive) || isUnc || normalized.startsWith('/')
  const body = drive ? normalized.slice(drive.length) : isUnc ? normalized.slice(2) : normalized
  const parts: string[] = []
  for (const part of body.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const prefix = drive ? `${drive}/` : isUnc ? '//' : absolute ? '/' : ''
  const result = `${prefix}${parts.join('/')}`
  return drive ? result.toLowerCase() : result
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || value.startsWith('/')
}

function trimTrailingFileReferencePunctuation(value: string): string {
  return value.replace(/[),.，。!?！？;；:：、\]}）】]+$/g, '')
}

function getPathBaseName(value: string): string {
  const normalized = normalizePath(value).replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function getPathDirectory(value: string): string {
  const normalized = normalizePath(value)
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

/**
 * 确保指定会话存在 Composer 草稿。
 * @param composerDrafts - Composer 草稿桶。
 * @param threadId - thread ID。
 * @returns Composer 草稿。
 */
export function ensureComposerDraft(
  composerDrafts: Record<string, JSONContent>,
  threadId: string
): JSONContent {
  composerDrafts[threadId] ??= createEmptyComposerContent()
  return composerDrafts[threadId]
}

/**
 * 确保指定会话存在图片附件草稿。
 * @param composerImages - 图片附件草稿桶。
 * @param threadId - thread ID。
 * @returns 图片附件列表。
 */
export function ensureComposerImages(
  composerImages: Record<string, ComposerImageAttachment[]>,
  threadId: string
): ComposerImageAttachment[] {
  composerImages[threadId] ??= []
  return composerImages[threadId]
}

/**
 * 确保指定会话存在文件附件草稿。
 * @param composerFiles - 文件附件草稿桶。
 * @param threadId - thread ID。
 * @returns 文件附件列表。
 */
export function ensureComposerFiles(
  composerFiles: Record<string, ComposerFileAttachment[]>,
  threadId: string
): ComposerFileAttachment[] {
  composerFiles[threadId] ??= []
  return composerFiles[threadId]
}

/**
 * 确保指定会话存在文本引用附件草稿。
 * @param composerQuotes - 文本引用附件草稿桶。
 * @param threadId - thread ID。
 * @returns 文本引用附件列表。
 */
export function ensureComposerQuotes(
  composerQuotes: Record<string, ComposerQuoteAttachment[]>,
  threadId: string
): ComposerQuoteAttachment[] {
  composerQuotes[threadId] ??= []
  return composerQuotes[threadId]
}

/**
 * 将 Composer 图片草稿拆成 Pi @file 图片和 inline 图片。
 * @param images - Composer 图片附件。
 * @returns prompt 图片 payload。
 */
export function getPromptImagePayload(images: ComposerImageAttachment[]): {
  images?: PromptImage[]
  imageFiles?: PromptImageFile[]
} {
  const imageFiles = images
    .filter((image): image is ComposerImageAttachment & { path: string } => Boolean(image.path))
    .map((image) => ({ path: image.path, inlineFallback: toPromptImage(image) }))
  const inlineImages = images.filter((image) => !image.path).map(toPromptImage)
  return {
    ...(inlineImages.length > 0 ? { images: inlineImages } : {}),
    ...(imageFiles.length > 0 ? { imageFiles } : {})
  }
}

/**
 * 去除仅供 Composer UI 使用的附件元信息。
 * @param image - Composer 图片附件。
 * @returns Prompt 图片内容。
 */
function toPromptImage(image: ComposerImageAttachment): PromptImage {
  return {
    type: image.type,
    mimeType: image.mimeType,
    data: image.data
  }
}
