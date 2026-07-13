/**
 * 本文件实现 prompt、steer、followUp 和 abort 操作。
 */

import { clipboard } from 'electron'
import { readFileSync, type Stats } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  serializePromptFileContext,
  serializePromptQuoteContexts,
  serializePromptSkillContext
} from '@shared/coding-agent/prompt-context'
import {
  assertPromptImagePayload,
  assertPromptImageTotalBytes,
  assertResolvedPromptImages,
  MAX_PROMPT_IMAGE_BYTES
} from '@shared/coding-agent/prompt-image-limits'
import type {
  PromptImage,
  PromptImageFile,
  PromptSkillReference,
  PromptInput,
  RunCommandResult,
  RunCommandInput,
  TextInput
} from '@shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'
import { readDesktopRuntimeConfig } from './desktop-runtime-config'
type ConfigModule = typeof import('@coding-agent-src/config')
type ShareViewerConfigModule = {
  getShareViewerUrl: ConfigModule['getShareViewerUrl']
}
type FileReferenceModule = typeof import('@coding-agent-src/core/file-reference')
type PromptFileReferenceModule = {
  dedupeFileArgs: FileReferenceModule['dedupeFileArgs']
  parseFileReferenceTokens: FileReferenceModule['parseFileReferenceTokens']
}

type PathUtilsModule = typeof import('@coding-agent-src/core/tools/path-utils')
type ImageProcessModule = typeof import('@coding-agent-src/utils/image-process')
type MimeModule = typeof import('@coding-agent-src/utils/mime')
type PromptFileSupportModule = {
  resolveReadPath: PathUtilsModule['resolveReadPath']
  detectSupportedImageMimeTypeFromFile: MimeModule['detectSupportedImageMimeTypeFromFile']
  processImage: ImageProcessModule['processImage']
}

type PromptFilePreflight = {
  absolutePath: string
  fileStats?: Stats
  mimeType: string | null
}

let shareViewerConfigModulePromise: Promise<ShareViewerConfigModule> | undefined
let promptFileReferenceModulePromise: Promise<PromptFileReferenceModule> | undefined
let promptFileSupportModulePromise: Promise<PromptFileSupportModule> | undefined

const maxPromptTextFileBytes = 512 * 1024
const maxTextProbeBytes = 4096

function loadShareViewerConfigModule(): Promise<ShareViewerConfigModule> {
  shareViewerConfigModulePromise ??= import('@coding-agent-src/config').then((config) => ({
    getShareViewerUrl: config.getShareViewerUrl
  }))
  return shareViewerConfigModulePromise
}

function loadPromptFileReferenceModule(): Promise<PromptFileReferenceModule> {
  promptFileReferenceModulePromise ??= import('@coding-agent-src/core/file-reference').then(
    (fileReference) => ({
      dedupeFileArgs: fileReference.dedupeFileArgs,
      parseFileReferenceTokens: fileReference.parseFileReferenceTokens
    })
  )
  return promptFileReferenceModulePromise
}

function loadPromptFileSupportModule(): Promise<PromptFileSupportModule> {
  promptFileSupportModulePromise ??= Promise.all([
    import('@coding-agent-src/core/tools/path-utils'),
    import('@coding-agent-src/utils/image-process'),
    import('@coding-agent-src/utils/mime')
  ]).then(([pathUtils, imageProcess, mime]) => ({
    resolveReadPath: pathUtils.resolveReadPath,
    detectSupportedImageMimeTypeFromFile: mime.detectSupportedImageMimeTypeFromFile,
    processImage: imageProcess.processImage
  }))
  return promptFileSupportModulePromise
}

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
  input: RunCommandInput
): Promise<RunCommandResult | undefined> {
  if (isSkillCommandName(input.command)) {
    throw new Error('Skill commands must be inserted into the prompt with $ instead of run-command')
  }
  const builtinResult = await runBuiltinCommand(core, input)
  if (builtinResult.handled) {
    return builtinResult.result
  }
  await prompt(core, {
    threadId: input.threadId,
    message: toSlashCommand(input.command, input.args)
  })
  return { message: `已运行 ${formatCommandLabel(input.command, input.args)}` }
}

/**
 * 将命令名称与参数还原为 Pi slash command 输入。
 * @param command - command 名称。
 * @param args - command 参数。
 * @returns slash command 文本。
 */
export function toSlashCommand(command: string, args?: string): string {
  const commandName = command.trim().replace(/^\/+/, '')
  const commandArgs = args ?? ''
  return commandArgs ? `/${commandName} ${commandArgs}` : `/${commandName}`
}

/**
 * 判断是否为 desktop worker 已支持的 Pi 内建 runtime 命令。
 * @param command - command 名称。
 * @returns 是否由 runtime control channel 处理。
 */
async function runBuiltinCommand(
  core: ThreadManagerCore,
  input: RunCommandInput
): Promise<{ handled: boolean; result?: RunCommandResult }> {
  const command = normalizeCommandName(input.command)
  const args = input.args?.trim()
  switch (command) {
    case 'reload':
      await core.sendOk(input.threadId, { type: 'reload' })
      return { handled: true, result: { message: '已重载扩展与资源', refreshSnapshot: true } }
    case 'compact': {
      const result = await core.sendData<unknown>(input.threadId, {
        type: 'compact',
        customInstructions: args || undefined
      })
      return {
        handled: true,
        result: {
          message:
            typeof result === 'object' && result && 'cancelled' in result && result.cancelled
              ? '压缩已取消'
              : '已压缩当前会话上下文',
          refreshSnapshot: true
        }
      }
    }
    case 'clone':
      await core.sendOk(input.threadId, { type: 'clone' })
      await syncThreadFromSnapshot(core, input.threadId)
      return { handled: true, result: { message: '已克隆当前会话', refreshSnapshot: true } }
    case 'name':
      if (!args) {
        throw new Error('/name 需要提供会话名称')
      }
      await core.sendOk(input.threadId, { type: 'set_session_name', name: args })
      core.updateThread(input.threadId, { title: args })
      return { handled: true, result: { message: `已重命名为 ${args}`, refreshSnapshot: true } }
    case 'session': {
      const stats = await core.sendData<{
        userMessages?: number
        assistantMessages?: number
        toolCalls?: number
        tokens?: { total?: number }
      }>(input.threadId, { type: 'get_session_stats' })
      return {
        handled: true,
        result: {
          message: `会话统计：用户 ${stats.userMessages ?? 0}，助手 ${
            stats.assistantMessages ?? 0
          }，工具 ${stats.toolCalls ?? 0}，tokens ${stats.tokens?.total ?? 0}`
        }
      }
    }
    case 'copy': {
      const result = await core.sendData<{ text?: string }>(input.threadId, {
        type: 'get_last_assistant_text'
      })
      if (!result.text) {
        throw new Error('没有可复制的助手消息')
      }
      clipboard.writeText(result.text)
      return { handled: true, result: { message: '已复制最后一条助手消息' } }
    }
    case 'export': {
      if (args && readDesktopRuntimeConfig().filesystemAccess !== 'full') {
        throw new Error('/export 在 Desktop 中不接受输出路径')
      }
      const result = await core.sendData<{ path?: string }>(input.threadId, {
        type: 'export_html',
        ...(args ? { outputPath: args } : {})
      })
      return {
        handled: true,
        result: { message: result.path ? `已导出到 ${result.path}` : '已导出会话' }
      }
    }
    case 'import':
      if (!args) {
        throw new Error('/import 需要提供 JSONL 文件路径')
      }
      await core.sendOk(input.threadId, { type: 'import_session', inputPath: args })
      await syncThreadFromSnapshot(core, input.threadId)
      return { handled: true, result: { message: '已导入会话', refreshSnapshot: true } }
    case 'fork':
      if (!args) {
        throw new Error('/fork 需要提供 entry ID，或通过 Desktop Session Tree 选择分叉位置')
      }
      await core.sendOk(input.threadId, { type: 'fork', entryId: args })
      await syncThreadFromSnapshot(core, input.threadId)
      return { handled: true, result: { message: '已分叉当前会话', refreshSnapshot: true } }
    case 'tree':
      if (!args) {
        throw new Error('/tree 需要提供 entry ID，或通过 Desktop Session Tree 导航')
      }
      await core.sendOk(input.threadId, { type: 'navigate_tree', entryId: args })
      await syncThreadFromSnapshot(core, input.threadId)
      return { handled: true, result: { message: '已导航 session tree', refreshSnapshot: true } }
    case 'resume':
      if (!args) {
        throw new Error('/resume 需要提供 session 文件路径，或通过 Desktop 会话列表恢复')
      }
      await core.sendOk(input.threadId, { type: 'switch_session', sessionPath: args })
      await syncThreadFromSnapshot(core, input.threadId)
      return { handled: true, result: { message: '已恢复指定会话', refreshSnapshot: true } }
    case 'model': {
      if (!args) {
        throw new Error('/model 需要提供 provider/model，或使用 Composer 模型选择器')
      }
      const model = parseModelArg(args)
      if (!model) {
        throw new Error('/model 参数格式应为 provider/model')
      }
      await core.sendOk(input.threadId, {
        type: 'set_model',
        provider: model.provider,
        modelId: model.modelId
      })
      return {
        handled: true,
        result: {
          message: `已切换模型到 ${model.provider}/${model.modelId}`,
          refreshSnapshot: true
        }
      }
    }
    case 'share': {
      const result = await shareSession(core, input.threadId)
      clipboard.writeText(result.url)
      return {
        handled: true,
        result: {
          message: `已创建分享链接：${result.url}`,
          details: {
            title: 'Share',
            body: result.url
          }
        }
      }
    }
    case 'settings':
    case 'scoped-models':
    case 'trust':
    case 'login':
    case 'logout':
    case 'quit':
      throw new Error(`/${command} 需要通过 Desktop 对应 UI 入口执行`)
    default:
      return { handled: false }
  }
}

async function shareSession(
  core: ThreadManagerCore,
  threadId: string
): Promise<{ gistId: string; url: string }> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token) {
    throw new Error('/share 需要设置 GITHUB_TOKEN 或 GH_TOKEN 以创建 secret GitHub gist')
  }
  const snapshot = await core.getSnapshot(threadId)
  if (!snapshot.sessionFile) {
    throw new Error('/share 需要当前 session 已写入 JSONL 文件')
  }
  const content = readFileSync(snapshot.sessionFile, 'utf-8')
  const response = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'pi-coding-agent-desktop'
    },
    body: JSON.stringify({
      description: 'Pi coding-agent session',
      public: false,
      files: {
        'session.jsonl': {
          content
        }
      }
    })
  })
  const body = (await response.json().catch(() => undefined)) as
    { id?: unknown; message?: unknown } | undefined
  if (!response.ok) {
    throw new Error(
      `GitHub gist 创建失败：${typeof body?.message === 'string' ? body.message : response.statusText}`
    )
  }
  if (typeof body?.id !== 'string' || !body.id) {
    throw new Error('GitHub gist 创建成功但未返回 gist ID')
  }
  const { getShareViewerUrl } = await loadShareViewerConfigModule()
  return {
    gistId: body.id,
    url: getShareViewerUrl(body.id)
  }
}

function normalizeCommandName(command: string): string {
  return command.trim().replace(/^\/+/, '')
}

function isSkillCommandName(command: string): boolean {
  return normalizeCommandName(command).startsWith('skill:')
}

function formatCommandLabel(command: string, args?: string): string {
  return args ? `${command} ${args}` : command
}

function parseModelArg(value: string): { provider: string; modelId: string } | undefined {
  const separatorIndex = value.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return undefined
  }
  const provider = value.slice(0, separatorIndex).trim()
  const modelId = value.slice(separatorIndex + 1).trim()
  if (!provider || !modelId) {
    return undefined
  }
  return {
    provider,
    modelId
  }
}

async function syncThreadFromSnapshot(core: ThreadManagerCore, threadId: string): Promise<void> {
  const snapshot = await core.getSnapshot(threadId)
  core.updateThread(threadId, {
    sessionFile: snapshot.sessionFile,
    title: snapshot.title
  })
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
  assertPromptImagePayload(input)
  const initialImages = input.images ?? []
  assertResolvedPromptImages(initialImages)
  const messageWithSkills = await resolvePromptSkillReferences(input.message, input.skillReferences)
  const message = serializePromptQuoteContexts(messageWithSkills, input.quoteContexts ?? [])
  if (
    (!input.imageFiles || input.imageFiles.length === 0) &&
    (!input.fileArgs || input.fileArgs.length === 0) &&
    !input.message.includes('@')
  ) {
    return { message, images: initialImages.length > 0 ? initialImages : undefined }
  }
  const cwd = getPromptCwd(core, input.threadId)
  const { dedupeFileArgs, parseFileReferenceTokens } = await loadPromptFileReferenceModule()
  const parsedTokens = await parseFileReferenceTokens(input.message, cwd)
  const fileArgs = dedupeFileArgs(
    [
      ...(input.fileArgs ?? []),
      ...parsedTokens.map((token) => token.fileArg),
      ...(input.imageFiles ?? []).map((imageFile) => imageFile.path)
    ],
    cwd
  )
  if (fileArgs.length === 0) {
    return { message, images: initialImages.length > 0 ? initialImages : undefined }
  }
  const autoResizeImages = await (await core.getAgentSettingsService()).getImageAutoResize()
  const processed = await processPromptFileArgs(
    fileArgs,
    input.imageFiles ?? [],
    cwd,
    autoResizeImages,
    initialImages
  )
  return {
    message: `${processed.text}${message}`,
    ...(processed.images.length > 0 ? { images: processed.images } : {})
  }
}

/**
 * 展开 desktop Composer 中的 $skill:name 引用，避免修改 Pi core。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 * @param message - 用户 prompt。
 * @returns 带 skill 上下文块的 prompt。
 */
async function resolvePromptSkillReferences(
  message: string,
  skillReferences: readonly PromptSkillReference[] = []
): Promise<string> {
  if (skillReferences.length === 0) {
    return message
  }
  const blocks: string[] = []
  for (const reference of skillReferences) {
    const block = await createSkillReferenceBlockFromReference(reference)
    if (block) {
      blocks.push(block)
    }
  }
  return blocks.length > 0 ? `${blocks.join('\n\n')}\n\n${message}` : message
}

function normalizeSkillReferenceName(name: string): string {
  return name.trim().replace(/^\$?skill:/, '')
}

async function createSkillReferenceBlockFromReference(
  reference: PromptSkillReference
): Promise<string | undefined> {
  if (!reference.path) {
    return undefined
  }
  const content = await readFile(reference.path, 'utf-8').catch(() => undefined)
  if (content === undefined) {
    return undefined
  }
  const name = normalizeSkillReferenceName(reference.name)
  const baseDir = reference.baseDir ?? dirname(reference.path)
  const body = stripSkillFrontmatter(content).trim()
  return serializePromptSkillContext(name, reference.path, baseDir, body)
}

/**
 * 移除 skill 文件 frontmatter。
 * @param content - skill 文件内容。
 * @returns 正文。
 */
function stripSkillFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

/**
 * 逐个展开文件参数，以便在某个图片文件 resize/convert 失败时使用桌面粘贴已持有的图片数据兜底。
 * @param fileArgs - Pi @file 参数。
 * @param imageFiles - 图片文件引用，提供 inline fallback。
 * @param cwd - prompt cwd。
 * @param autoResizeImages - 是否启用 Pi 图片自动 resize。
 * @param initialImages - renderer 直接提交的 inline 图片。
 * @returns 展开后的文本与图片。
 */
async function processPromptFileArgs(
  fileArgs: string[],
  imageFiles: PromptImageFile[],
  cwd: string,
  autoResizeImages: boolean,
  initialImages: PromptImage[]
): Promise<{ text: string; images: PromptImage[] }> {
  let text = ''
  const images: PromptImage[] = [...initialImages]
  let actualSourceImageBytes = 0
  const support = await loadPromptFileSupportModule()
  const imageFallbacks = createImageFallbackMap(imageFiles, cwd, support.resolveReadPath)
  const preflightFiles = await preflightPromptFileArgs(fileArgs, cwd, support)
  for (const preflight of preflightFiles) {
    const processed = await processPromptFileArg(preflight, support, autoResizeImages)
    actualSourceImageBytes += processed.sourceImageBytes ?? 0
    assertPromptImageTotalBytes(actualSourceImageBytes)
    const { absolutePath } = preflight
    const imageFile = imageFallbacks.get(absolutePath)
    text += imageFile ? getPromptImageFileText(processed.text, imageFile) : processed.text
    if (processed.images.length > 0) {
      images.push(...processed.images)
      assertResolvedPromptImages(images)
      continue
    }
    if (imageFile?.inlineFallback) {
      images.push(imageFile.inlineFallback)
      assertResolvedPromptImages(images)
    }
  }
  return { text, images }
}

async function preflightPromptFileArgs(
  fileArgs: string[],
  cwd: string,
  support: PromptFileSupportModule
): Promise<PromptFilePreflight[]> {
  const files: PromptFilePreflight[] = []
  let sourceImageBytes = 0
  for (const fileArg of fileArgs) {
    const absolutePath = support.resolveReadPath(fileArg, cwd)
    const fileStats = await stat(absolutePath).catch(() => undefined)
    const mimeType =
      fileStats?.isFile() && fileStats.size > 0
        ? await support.detectSupportedImageMimeTypeFromFile(absolutePath).catch(() => null)
        : null
    if (mimeType && fileStats && fileStats.size <= MAX_PROMPT_IMAGE_BYTES) {
      sourceImageBytes += fileStats.size
      assertPromptImageTotalBytes(sourceImageBytes)
    }
    files.push({ absolutePath, fileStats, mimeType })
  }
  return files
}

/**
 * 安全展开单个 prompt 文件参数，避免 desktop main 因 CLI process.exit 行为退出。
 * @param preflight - 文件路径、stat 与 MIME 预检结果。
 * @param support - 文件处理依赖。
 * @param autoResizeImages - 是否启用图片自动 resize。
 * @returns 展开后的文本与图片。
 */
async function processPromptFileArg(
  preflight: PromptFilePreflight,
  support: PromptFileSupportModule,
  autoResizeImages: boolean
): Promise<{ text: string; images: PromptImage[]; sourceImageBytes?: number }> {
  const { absolutePath, fileStats, mimeType } = preflight
  if (!fileStats) {
    return { text: createSkippedPromptFileText(absolutePath, '文件不存在或不可访问'), images: [] }
  }
  if (!fileStats.isFile()) {
    return { text: createSkippedPromptFileText(absolutePath, '不是普通文件'), images: [] }
  }
  if (fileStats.size === 0) {
    return { text: '', images: [] }
  }

  if (mimeType) {
    return processPromptImageFile(absolutePath, fileStats.size, mimeType, support, autoResizeImages)
  }
  return processPromptTextFile(absolutePath, fileStats.size)
}

/**
 * 安全展开 prompt 图片文件。
 */
async function processPromptImageFile(
  absolutePath: string,
  size: number,
  mimeType: string,
  support: PromptFileSupportModule,
  autoResizeImages: boolean
): Promise<{ text: string; images: PromptImage[]; sourceImageBytes?: number }> {
  if (size > MAX_PROMPT_IMAGE_BYTES) {
    return {
      text: createSkippedPromptFileText(
        absolutePath,
        `图片超过 ${formatBytes(MAX_PROMPT_IMAGE_BYTES)} 限制`
      ),
      images: []
    }
  }

  let sourceImageBytes = 0
  try {
    const read = await readFileUpTo(absolutePath, MAX_PROMPT_IMAGE_BYTES)
    sourceImageBytes = read.bytes.byteLength
    if (read.exceeded) {
      return {
        text: createSkippedPromptFileText(
          absolutePath,
          `图片超过 ${formatBytes(MAX_PROMPT_IMAGE_BYTES)} 限制`
        ),
        images: [],
        sourceImageBytes
      }
    }
    const content = read.bytes
    const processed = await support.processImage(content, mimeType, { autoResizeImages })
    if (!processed.ok) {
      return {
        text: serializePromptFileContext(absolutePath, processed.message),
        images: [],
        sourceImageBytes
      }
    }
    const attachment: PromptImage = {
      type: 'image',
      mimeType: processed.mimeType,
      data: processed.data
    }
    const hints = processed.hints.length > 0 ? processed.hints.join('\n') : ''
    return {
      text: serializePromptFileContext(absolutePath, hints),
      images: [attachment],
      sourceImageBytes
    }
  } catch (error) {
    return {
      text: createSkippedPromptFileText(absolutePath, getFileReadErrorMessage(error)),
      images: [],
      ...(sourceImageBytes > 0 ? { sourceImageBytes } : {})
    }
  }
}

/**
 * 安全展开 prompt 文本文件。
 */
async function processPromptTextFile(
  absolutePath: string,
  size: number
): Promise<{ text: string; images: PromptImage[] }> {
  if (size > maxPromptTextFileBytes) {
    return {
      text: createSkippedPromptFileText(
        absolutePath,
        `文件超过 ${formatBytes(maxPromptTextFileBytes)} 限制`
      ),
      images: []
    }
  }

  try {
    const read = await readFileUpTo(absolutePath, maxPromptTextFileBytes)
    if (read.exceeded) {
      return {
        text: createSkippedPromptFileText(
          absolutePath,
          `文件超过 ${formatBytes(maxPromptTextFileBytes)} 限制`
        ),
        images: []
      }
    }
    const content = read.bytes
    if (!isLikelyTextBuffer(content)) {
      return {
        text: createSkippedPromptFileText(absolutePath, '不是支持的文本或图片文件'),
        images: []
      }
    }
    return {
      text: serializePromptFileContext(absolutePath, content.toString('utf8'), { multiline: true }),
      images: []
    }
  } catch (error) {
    return {
      text: createSkippedPromptFileText(absolutePath, getFileReadErrorMessage(error)),
      images: []
    }
  }
}

async function readFileUpTo(
  path: string,
  maximumBytes: number
): Promise<{ bytes: Buffer; exceeded: boolean }> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(maximumBytes + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return {
      bytes: buffer.subarray(0, offset),
      exceeded: offset > maximumBytes
    }
  } finally {
    await handle.close()
  }
}

function createSkippedPromptFileText(absolutePath: string, reason: string): string {
  return serializePromptFileContext(absolutePath, `[Skipped: ${reason}.]`)
}

function getFileReadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `无法读取文件：${message}`
}

function isLikelyTextBuffer(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, maxTextProbeBytes)
  if (length === 0) {
    return true
  }
  let controlBytes = 0
  for (let index = 0; index < length; index += 1) {
    const byte = buffer[index] ?? 0
    if (byte === 0) {
      return false
    }
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) {
      controlBytes += 1
    }
  }
  return controlBytes / length < 0.02
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/**
 * 创建图片 fallback 映射。
 * @param imageFiles - 图片文件引用。
 * @param cwd - prompt cwd。
 * @returns 绝对路径到图片文件引用的映射。
 */
function createImageFallbackMap(
  imageFiles: PromptImageFile[],
  cwd: string,
  resolvePath: (inputPath: string, cwd: string) => string
): Map<string, PromptImageFile> {
  const map = new Map<string, PromptImageFile>()
  for (const imageFile of imageFiles) {
    map.set(resolvePath(imageFile.path, cwd), imageFile)
  }
  return map
}

/**
 * 获取 prompt 使用的 cwd。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 * @returns prompt cwd。
 */
function getPromptCwd(core: ThreadManagerCore, threadId: string): string {
  const thread = core.requireThread(threadId)
  try {
    return core.getThreadCwd(thread)
  } catch {
    return process.cwd()
  }
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
  return text.replace(/<file\b([^>]*)>(?:\[Image omitted:[\s\S]*?\])<\/file>/g, '<file$1></file>')
}
