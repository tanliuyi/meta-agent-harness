/**
 * 本文件实现 prompt、steer、followUp 和 abort 操作。
 */

import { clipboard } from 'electron'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
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
type ConfigModule = typeof import('@coding-agent-src/config')
type ChangelogModule = typeof import('@coding-agent-src/utils/changelog')
type KeybindingsModule =
  typeof import('@coding-agent-src/core/keybindings')
type ShareViewerConfigModule = {
  getShareViewerUrl: ConfigModule['getShareViewerUrl']
}
type ChangelogSupportModule = {
  getChangelogPath: ChangelogModule['getChangelogPath']
  parseChangelog: ChangelogModule['parseChangelog']
}
type HotkeysSupportModule = {
  KEYBINDINGS: KeybindingsModule['KEYBINDINGS']
  KeybindingsManager: KeybindingsModule['KeybindingsManager']
}
type FileReferenceModule =
  typeof import('@coding-agent-src/core/file-reference')
type PromptFileReferenceModule = {
  dedupeFileArgs: FileReferenceModule['dedupeFileArgs']
  parseFileReferenceTokens: FileReferenceModule['parseFileReferenceTokens']
}

type PathUtilsModule =
  typeof import('@coding-agent-src/core/tools/path-utils')
type ImageProcessModule =
  typeof import('@coding-agent-src/utils/image-process')
type MimeModule = typeof import('@coding-agent-src/utils/mime')
type PromptFileSupportModule = {
  resolveReadPath: PathUtilsModule['resolveReadPath']
  detectSupportedImageMimeTypeFromFile: MimeModule['detectSupportedImageMimeTypeFromFile']
  processImage: ImageProcessModule['processImage']
}

let shareViewerConfigModulePromise: Promise<ShareViewerConfigModule> | undefined
let changelogSupportModulePromise: Promise<ChangelogSupportModule> | undefined
let hotkeysSupportModulePromise: Promise<HotkeysSupportModule> | undefined
let promptFileReferenceModulePromise: Promise<PromptFileReferenceModule> | undefined
let promptFileSupportModulePromise: Promise<PromptFileSupportModule> | undefined

const maxPromptTextFileBytes = 512 * 1024
const maxPromptImageFileBytes = 20 * 1024 * 1024
const maxTextProbeBytes = 4096

function loadShareViewerConfigModule(): Promise<ShareViewerConfigModule> {
  shareViewerConfigModulePromise ??= import(
    '@coding-agent-src/config'
  ).then((config) => ({
    getShareViewerUrl: config.getShareViewerUrl
  }))
  return shareViewerConfigModulePromise
}

function loadChangelogSupportModule(): Promise<ChangelogSupportModule> {
  changelogSupportModulePromise ??= import(
    '@coding-agent-src/utils/changelog'
  ).then((changelog) => ({
    getChangelogPath: changelog.getChangelogPath,
    parseChangelog: changelog.parseChangelog
  }))
  return changelogSupportModulePromise
}

function loadHotkeysSupportModule(): Promise<HotkeysSupportModule> {
  hotkeysSupportModulePromise ??= import(
    '@coding-agent-src/core/keybindings'
  ).then((keybindings) => ({
    KEYBINDINGS: keybindings.KEYBINDINGS,
    KeybindingsManager: keybindings.KeybindingsManager
  }))
  return hotkeysSupportModulePromise
}

function loadPromptFileReferenceModule(): Promise<PromptFileReferenceModule> {
  promptFileReferenceModulePromise ??= import(
    '@coding-agent-src/core/file-reference'
  ).then((fileReference) => ({
    dedupeFileArgs: fileReference.dedupeFileArgs,
    parseFileReferenceTokens: fileReference.parseFileReferenceTokens
  }))
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
    case 'new':
      await core.sendOk(input.threadId, { type: 'new_session' })
      await syncThreadFromSnapshot(core, input.threadId)
      return { handled: true, result: { message: '已开始新会话', refreshSnapshot: true } }
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
      const result = await core.sendData<{ path?: string }>(input.threadId, {
        type: 'export_html',
        outputPath: args || undefined
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
    case 'changelog': {
      const details = await getChangelogCommandDetails(args)
      return {
        handled: true,
        result: {
          message: details ? '已打开 Changelog' : '没有可显示的 changelog',
          ...(details ? { details } : {})
        }
      }
    }
    case 'hotkeys': {
      const details = await getHotkeysCommandDetails()
      return {
        handled: true,
        result: {
          message: '已打开 Hotkeys',
          details
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

async function getChangelogCommandDetails(
  args: string | undefined
): Promise<RunCommandResult['details']> {
  const { getChangelogPath, parseChangelog } = await loadChangelogSupportModule()
  const entries = parseChangelog(getChangelogPath())
  if (entries.length === 0) {
    return undefined
  }
  const trimmedArgs = args?.trim()
  const versionFilter = trimmedArgs?.match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  const count = trimmedArgs && /^\d+$/.test(trimmedArgs) ? Number.parseInt(trimmedArgs, 10) : 5
  const selectedEntries = versionFilter
    ? entries.filter(
        (entry) =>
          entry.major === Number.parseInt(versionFilter[1], 10) &&
          entry.minor === Number.parseInt(versionFilter[2], 10) &&
          entry.patch === Number.parseInt(versionFilter[3], 10)
      )
    : entries.slice(0, Math.max(1, Math.min(count, 20)))
  const body = selectedEntries.map((entry) => entry.content).join('\n\n')
  return {
    title: versionFilter
      ? `Changelog ${trimmedArgs}`
      : `Changelog 最近 ${selectedEntries.length} 条`,
    body: body || '没有匹配的 changelog 条目'
  }
}

async function getHotkeysCommandDetails(): Promise<NonNullable<RunCommandResult['details']>> {
  const { KEYBINDINGS, KeybindingsManager } = await loadHotkeysSupportModule()
  const effectiveConfig = KeybindingsManager.create().getEffectiveConfig()
  const rows = Object.entries(KEYBINDINGS).map(([id, definition]) => {
    const keys = effectiveConfig[id]
    const keyLabel = Array.isArray(keys) ? keys.join(', ') : keys || '未绑定'
    return `${keyLabel.padEnd(18)} ${definition.description ?? id}`
  })
  return {
    title: 'Hotkeys',
    body: rows.join('\n')
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
  const message = await resolvePromptSkillReferences(input.message, input.skillReferences)
  if (
    (!input.imageFiles || input.imageFiles.length === 0) &&
    (!input.fileArgs || input.fileArgs.length === 0) &&
    !input.message.includes('@')
  ) {
    return { message, images: input.images }
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
    return { message, images: input.images }
  }
  const autoResizeImages = await (await core.getAgentSettingsService()).getImageAutoResize()
  const processed = await processPromptFileArgs(
    fileArgs,
    input.imageFiles ?? [],
    cwd,
    autoResizeImages
  )
  const images = [...processed.images, ...(input.images ?? [])]
  return {
    message: `${processed.text}${message}`,
    ...(images.length > 0 ? { images } : {})
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
  return `<skill name="${name}" location="${reference.path}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`
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
 * @returns 展开后的文本与图片。
 */
async function processPromptFileArgs(
  fileArgs: string[],
  imageFiles: PromptImageFile[],
  cwd: string,
  autoResizeImages: boolean
): Promise<{ text: string; images: PromptImage[] }> {
  let text = ''
  const images: PromptImage[] = []
  const support = await loadPromptFileSupportModule()
  const imageFallbacks = createImageFallbackMap(imageFiles, cwd, support.resolveReadPath)
  for (const fileArg of fileArgs) {
    const absolutePath = support.resolveReadPath(fileArg, cwd)
    const processed = await processPromptFileArg(absolutePath, support, autoResizeImages)
    const imageFile = imageFallbacks.get(absolutePath)
    text += imageFile ? getPromptImageFileText(processed.text, imageFile) : processed.text
    if (processed.images.length > 0) {
      images.push(...processed.images)
      continue
    }
    if (imageFile?.inlineFallback) {
      images.push(imageFile.inlineFallback)
    }
  }
  return { text, images }
}

/**
 * 安全展开单个 prompt 文件参数，避免 desktop main 因 CLI process.exit 行为退出。
 * @param absolutePath - 已解析的绝对路径。
 * @param support - 文件处理依赖。
 * @param autoResizeImages - 是否启用图片自动 resize。
 * @returns 展开后的文本与图片。
 */
async function processPromptFileArg(
  absolutePath: string,
  support: PromptFileSupportModule,
  autoResizeImages: boolean
): Promise<{ text: string; images: PromptImage[] }> {
  const fileStats = await stat(absolutePath).catch(() => undefined)
  if (!fileStats) {
    return { text: createSkippedPromptFileText(absolutePath, '文件不存在或不可访问'), images: [] }
  }
  if (!fileStats.isFile()) {
    return { text: createSkippedPromptFileText(absolutePath, '不是普通文件'), images: [] }
  }
  if (fileStats.size === 0) {
    return { text: '', images: [] }
  }

  const mimeType = await support.detectSupportedImageMimeTypeFromFile(absolutePath).catch(() => null)
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
): Promise<{ text: string; images: PromptImage[] }> {
  if (size > maxPromptImageFileBytes) {
    return {
      text: createSkippedPromptFileText(
        absolutePath,
        `图片超过 ${formatBytes(maxPromptImageFileBytes)} 限制`
      ),
      images: []
    }
  }

  try {
    const content = await readFile(absolutePath)
    const processed = await support.processImage(content, mimeType, { autoResizeImages })
    if (!processed.ok) {
      return { text: `<file name="${absolutePath}">${processed.message}</file>\n`, images: [] }
    }
    const attachment: PromptImage = {
      type: 'image',
      mimeType: processed.mimeType,
      data: processed.data
    }
    const hints = processed.hints.length > 0 ? processed.hints.join('\n') : ''
    return { text: `<file name="${absolutePath}">${hints}</file>\n`, images: [attachment] }
  } catch (error) {
    return {
      text: createSkippedPromptFileText(absolutePath, getFileReadErrorMessage(error)),
      images: []
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
    const content = await readFile(absolutePath)
    if (!isLikelyTextBuffer(content)) {
      return {
        text: createSkippedPromptFileText(absolutePath, '不是支持的文本或图片文件'),
        images: []
      }
    }
    return { text: `<file name="${absolutePath}">\n${content.toString('utf8')}\n</file>\n`, images: [] }
  } catch (error) {
    return {
      text: createSkippedPromptFileText(absolutePath, getFileReadErrorMessage(error)),
      images: []
    }
  }
}

function createSkippedPromptFileText(absolutePath: string, reason: string): string {
  return `<file name="${absolutePath}">[Skipped: ${reason}.]</file>\n`
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
