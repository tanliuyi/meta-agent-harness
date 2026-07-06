/**
 * 本文件实现 prompt、steer、followUp 和 abort 操作。
 */

import { clipboard } from 'electron'
import { readFileSync } from 'fs'
import { getChangelogPath, getShareViewerUrl } from '../../../../../packages/coding-agent/src/config'
import { KEYBINDINGS, KeybindingsManager } from '../../../../../packages/coding-agent/src/core/keybindings'
import { parseChangelog } from '../../../../../packages/coding-agent/src/utils/changelog'
import type {
  PromptImage,
  PromptImageFile,
  PromptInput,
  RunCommandResult,
  RunCommandInput,
  TextInput
} from '@shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'
import { processFileArguments } from '../../../../../packages/coding-agent/src/cli/file-processor'
import {
  dedupeFileArgs,
  parseFileReferenceTokens
} from '../../../../../packages/coding-agent/src/core/file-reference'
import { resolveReadPath } from '../../../../../packages/coding-agent/src/core/tools/path-utils'

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
      return { handled: true, result: { message: `已重命名为 ${args}` } }
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
        result: { message: `已切换模型到 ${model.provider}/${model.modelId}`, refreshSnapshot: true }
      }
    }
    case 'changelog': {
      const details = getChangelogCommandDetails(args)
      return {
        handled: true,
        result: {
          message: details ? '已打开 Changelog' : '没有可显示的 changelog',
          ...(details ? { details } : {})
        }
      }
    }
    case 'hotkeys': {
      const details = getHotkeysCommandDetails()
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
    | { id?: unknown; message?: unknown }
    | undefined
  if (!response.ok) {
    throw new Error(`GitHub gist 创建失败：${typeof body?.message === 'string' ? body.message : response.statusText}`)
  }
  if (typeof body?.id !== 'string' || !body.id) {
    throw new Error('GitHub gist 创建成功但未返回 gist ID')
  }
  return {
    gistId: body.id,
    url: getShareViewerUrl(body.id)
  }
}

function getChangelogCommandDetails(args: string | undefined): RunCommandResult['details'] {
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
    title: versionFilter ? `Changelog ${trimmedArgs}` : `Changelog 最近 ${selectedEntries.length} 条`,
    body: body || '没有匹配的 changelog 条目'
  }
}

function getHotkeysCommandDetails(): NonNullable<RunCommandResult['details']> {
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
  if (
    (!input.imageFiles || input.imageFiles.length === 0) &&
    (!input.fileArgs || input.fileArgs.length === 0) &&
    !input.message.includes('@')
  ) {
    return { message: input.message, images: input.images }
  }
  const cwd = getPromptCwd(core, input.threadId)
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
    return { message: input.message, images: input.images }
  }
  const autoResizeImages = await core.getAgentSettingsService().getImageAutoResize()
  const processed = await processPromptFileArgs(
    fileArgs,
    input.imageFiles ?? [],
    cwd,
    autoResizeImages
  )
  const images = [...processed.images, ...(input.images ?? [])]
  return {
    message: `${processed.text}${input.message}`,
    ...(images.length > 0 ? { images } : {})
  }
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
  const imageFallbacks = createImageFallbackMap(imageFiles, cwd)
  for (const fileArg of fileArgs) {
    const absolutePath = resolveReadPath(fileArg, cwd)
    const processed = await processFileArguments([absolutePath], { autoResizeImages })
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
 * 创建图片 fallback 映射。
 * @param imageFiles - 图片文件引用。
 * @param cwd - prompt cwd。
 * @returns 绝对路径到图片文件引用的映射。
 */
function createImageFallbackMap(
  imageFiles: PromptImageFile[],
  cwd: string
): Map<string, PromptImageFile> {
  const map = new Map<string, PromptImageFile>()
  for (const imageFile of imageFiles) {
    map.set(resolveReadPath(imageFile.path, cwd), imageFile)
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
