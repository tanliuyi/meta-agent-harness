/**
 * 本文件实现 prompt、steer、followUp 和 abort 操作。
 */

import type { PromptImage, PromptInput, TextInput } from '@shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'
import { processFileArguments } from '../../../../../packages/coding-agent/src/cli/file-processor'

/**
 * 向线程发送 prompt 消息。
 * @param core - thread 管理核心。
 * @param input - prompt 输入。
 */
export async function prompt(core: ThreadManagerCore, input: PromptInput): Promise<void> {
  core.requireThread(input.threadId)
  const promptInput = await resolvePromptInput(core, input)
  core.updateThread(input.threadId, { status: 'running' })
  await core.sendOk(input.threadId, {
    type: 'prompt',
    message: promptInput.message,
    images: promptInput.images as never,
    streamingBehavior: input.streamingBehavior
  })
}

/**
 * 向线程发送 steer 指令。
 * @param core - thread 管理核心。
 * @param input - 文本输入。
 */
export async function steer(core: ThreadManagerCore, input: TextInput): Promise<void> {
  const promptInput = await resolvePromptInput(core, input)
  await core.sendOk(input.threadId, {
    type: 'steer',
    message: promptInput.message,
    images: promptInput.images as never
  })
}

/**
 * 向线程发送 follow up 消息。
 * @param core - thread 管理核心。
 * @param input - 文本输入。
 */
export async function followUp(core: ThreadManagerCore, input: TextInput): Promise<void> {
  const promptInput = await resolvePromptInput(core, input)
  await core.sendOk(input.threadId, {
    type: 'follow_up',
    message: promptInput.message,
    images: promptInput.images as never
  })
}

/**
 * 中止线程当前任务。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 */
export async function abort(core: ThreadManagerCore, threadId: string): Promise<void> {
  await core.sendOk(threadId, { type: 'abort' })
  core.updateThread(threadId, { status: 'idle' })
}

/**
 * 通过命令形式触发 prompt。
 * @param core - thread 管理核心。
 * @param input - 包含 threadId 与 command 的输入。
 */
export async function runCommand(
  core: ThreadManagerCore,
  input: { threadId: string; command: string }
): Promise<void> {
  await prompt(core, { threadId: input.threadId, message: `/${input.command}` })
}

/**
 * 按 Pi CLI @file 语义展开 desktop 图片文件引用。
 * @param core - thread 管理核心。
 * @param input - prompt 输入。
 * @returns 展开后的 prompt 文本和图片。
 */
async function resolvePromptInput(
  core: ThreadManagerCore,
  input: TextInput
): Promise<Pick<TextInput, 'message' | 'images'>> {
  if (!input.imageFiles || input.imageFiles.length === 0) {
    return { message: input.message, images: input.images }
  }
  const autoResizeImages = await core.getAgentSettingsService().getImageAutoResize()
  const processed = await processPromptImageFiles(input.imageFiles, autoResizeImages)
  const images = [...processed.images, ...(input.images ?? [])]
  return {
    message: `${processed.text}${input.message}`,
    ...(images.length > 0 ? { images } : {})
  }
}

/**
 * 逐个展开图片文件，以便在某个文件 resize/convert 失败时使用桌面粘贴已持有的图片数据兜底。
 * @param imageFiles - 图片文件引用。
 * @param autoResizeImages - 是否启用 Pi 图片自动 resize。
 * @returns 展开后的文本与图片。
 */
async function processPromptImageFiles(
  imageFiles: NonNullable<TextInput['imageFiles']>,
  autoResizeImages: boolean
): Promise<{ text: string; images: PromptImage[] }> {
  let text = ''
  const images: PromptImage[] = []
  for (const imageFile of imageFiles) {
    const processed = await processFileArguments([imageFile.path], { autoResizeImages })
    text += getPromptImageFileText(processed.text, imageFile)
    if (processed.images.length > 0) {
      images.push(...processed.images)
      continue
    }
    if (imageFile.inlineFallback) {
      images.push(imageFile.inlineFallback)
    }
  }
  return { text, images }
}

/**
 * 当 inline fallback 可用时，避免把“图片已省略”的提示写进模型上下文。
 * @param text - Pi file processor 生成的文本。
 * @param imageFile - 图片文件引用。
 * @returns 用于 prompt 的文件上下文文本。
 */
function getPromptImageFileText(
  text: string,
  imageFile: NonNullable<TextInput['imageFiles']>[number]
): string {
  if (!imageFile.inlineFallback) {
    return text
  }
  return text.replace(
    /<file\b([^>]*)>(?:\[Image omitted:[\s\S]*?\])<\/file>/g,
    '<file$1></file>'
  )
}
