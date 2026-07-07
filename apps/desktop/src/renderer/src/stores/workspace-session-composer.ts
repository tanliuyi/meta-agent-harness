import type { JSONContent } from '@tiptap/vue-3'
import type {
  PromptImage,
  PromptImageAttachment,
  PromptImageFile
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
