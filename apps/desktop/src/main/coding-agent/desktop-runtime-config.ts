/**
 * Desktop-only runtime 配置。
 *
 * 这里的字段不写入 Pi settings.json，避免 CLI 读取到 Desktop 承载进程细节。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AgentWorkerMode,
  BrowserWebPermissionMode,
  BrowserCdpAccessMode,
  DesktopCapabilityAccessMode,
  DesktopUiPreferences
} from '@shared/coding-agent/types'

/** Desktop runtime 配置。 */
export interface DesktopRuntimeConfig {
  /** Desktop worker 承载模式。 */
  workerMode: AgentWorkerMode
  /** Node sidecar 可执行文件路径。 */
  nodeSidecarExecPath?: string
  /** Desktop renderer UI 偏好。 */
  uiPreferences?: DesktopUiPreferences
  /** Browser Preview 的 Chrome DevTools Protocol 权限级别。 */
  browserCdpAccess: BrowserCdpAccessMode
  /** Browser Preview 网页权限策略。 */
  browserWebPermissions: BrowserWebPermissionMode
  /** renderer 任意文件系统操作权限。 */
  filesystemAccess: DesktopCapabilityAccessMode
  /** URL extension panel 跨源能力。 */
  extensionUrlAccess: DesktopCapabilityAccessMode
  /** 自定义外部 URI scheme 能力。 */
  externalProtocolAccess: DesktopCapabilityAccessMode
}

/** Desktop runtime 配置更新输入。 */
export type DesktopRuntimeConfigInput = Partial<DesktopRuntimeConfig>

type DesktopRuntimeConfigListener = (config: DesktopRuntimeConfig, configPath: string) => void

const desktopRuntimeConfigListeners = new Set<DesktopRuntimeConfigListener>()

const defaultRuntimeConfig: DesktopRuntimeConfig = {
  workerMode: 'nodeSidecar',
  browserCdpAccess: 'safe',
  browserWebPermissions: 'prompt',
  filesystemAccess: 'safe',
  extensionUrlAccess: 'safe',
  externalProtocolAccess: 'safe'
}

/**
 * 解析 Desktop runtime 配置文件路径。
 * @returns 配置文件路径。
 */
export function getDesktopRuntimeConfigPath(): string {
  return join(app.getPath('userData'), 'desktop-runtime.json')
}

/**
 * 读取 Desktop runtime 配置，并应用环境变量覆盖。
 * @param configPath - 可选配置文件路径。
 * @returns Desktop runtime 配置。
 */
export function readDesktopRuntimeConfig(
  configPath = getDesktopRuntimeConfigPath()
): DesktopRuntimeConfig {
  const fileConfig = readDesktopRuntimeConfigFile(configPath)
  return normalizeDesktopRuntimeConfig({
    ...defaultRuntimeConfig,
    ...fileConfig,
    ...getDesktopRuntimeConfigEnvOverride()
  })
}

/**
 * 写入 Desktop runtime 配置文件。
 * @param input - 配置更新。
 * @param configPath - 可选配置文件路径。
 * @returns 写入后的文件配置，不含环境变量覆盖。
 */
export function writeDesktopRuntimeConfig(
  input: DesktopRuntimeConfigInput,
  configPath = getDesktopRuntimeConfigPath()
): DesktopRuntimeConfig {
  const current = readDesktopRuntimeConfigFile(configPath)
  const next = normalizeDesktopRuntimeConfig({
    ...defaultRuntimeConfig,
    ...current,
    ...input,
    ...(input.uiPreferences
      ? {
          uiPreferences: {
            ...current.uiPreferences,
            ...input.uiPreferences,
            appearance: {
              ...current.uiPreferences?.appearance,
              ...input.uiPreferences.appearance
            },
            workspace: {
              ...current.uiPreferences?.workspace,
              ...input.uiPreferences.workspace
            }
          }
        }
      : {})
  })
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`)
  const effectiveConfig = normalizeDesktopRuntimeConfig({
    ...next,
    ...getDesktopRuntimeConfigEnvOverride()
  })
  for (const listener of desktopRuntimeConfigListeners) {
    listener(effectiveConfig, configPath)
  }
  return next
}

/** 订阅当前进程内 Desktop runtime 配置写入。 */
export function onDesktopRuntimeConfigChanged(listener: DesktopRuntimeConfigListener): () => void {
  desktopRuntimeConfigListeners.add(listener)
  return () => desktopRuntimeConfigListeners.delete(listener)
}

/**
 * 读取配置文件，不应用环境变量。
 * @param configPath - 配置文件路径。
 * @returns 文件内配置。
 */
function readDesktopRuntimeConfigFile(configPath: string): DesktopRuntimeConfigInput {
  if (!existsSync(configPath)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as DesktopRuntimeConfigInput
  } catch {
    return {}
  }
}

/**
 * 获取环境变量配置覆盖。
 * @returns 环境变量覆盖。
 */
function getDesktopRuntimeConfigEnvOverride(): DesktopRuntimeConfigInput {
  return {
    ...(process.env.CODING_AGENT_WORKER_MODE
      ? { workerMode: process.env.CODING_AGENT_WORKER_MODE as AgentWorkerMode }
      : {}),
    ...(process.env.CODING_AGENT_NODE_SIDECAR_EXEC_PATH
      ? { nodeSidecarExecPath: process.env.CODING_AGENT_NODE_SIDECAR_EXEC_PATH }
      : {}),
    ...(process.env.CODING_AGENT_BROWSER_CDP_ACCESS
      ? {
          browserCdpAccess: process.env.CODING_AGENT_BROWSER_CDP_ACCESS as BrowserCdpAccessMode
        }
      : {}),
    ...(process.env.CODING_AGENT_BROWSER_WEB_PERMISSIONS
      ? {
          browserWebPermissions: process.env
            .CODING_AGENT_BROWSER_WEB_PERMISSIONS as BrowserWebPermissionMode
        }
      : {}),
    ...(process.env.CODING_AGENT_FILESYSTEM_ACCESS
      ? {
          filesystemAccess: process.env
            .CODING_AGENT_FILESYSTEM_ACCESS as DesktopCapabilityAccessMode
        }
      : {}),
    ...(process.env.CODING_AGENT_EXTENSION_URL_ACCESS
      ? {
          extensionUrlAccess: process.env
            .CODING_AGENT_EXTENSION_URL_ACCESS as DesktopCapabilityAccessMode
        }
      : {}),
    ...(process.env.CODING_AGENT_EXTERNAL_PROTOCOL_ACCESS
      ? {
          externalProtocolAccess: process.env
            .CODING_AGENT_EXTERNAL_PROTOCOL_ACCESS as DesktopCapabilityAccessMode
        }
      : {})
  }
}

/**
 * 标准化 Desktop runtime 配置。
 * @param input - 原始配置。
 * @returns 标准配置。
 */
function normalizeDesktopRuntimeConfig(input: DesktopRuntimeConfigInput): DesktopRuntimeConfig {
  const workerMode = input.workerMode === 'utilityProcess' ? 'utilityProcess' : 'nodeSidecar'
  return {
    workerMode,
    browserCdpAccess: isOneOf(input.browserCdpAccess, ['disabled', 'safe', 'full'])
      ? input.browserCdpAccess
      : 'safe',
    browserWebPermissions: isOneOf(input.browserWebPermissions, ['disabled', 'prompt', 'full'])
      ? input.browserWebPermissions
      : 'prompt',
    filesystemAccess: isOneOf(input.filesystemAccess, ['safe', 'full'])
      ? input.filesystemAccess
      : 'safe',
    extensionUrlAccess: isOneOf(input.extensionUrlAccess, ['safe', 'full'])
      ? input.extensionUrlAccess
      : 'safe',
    externalProtocolAccess: isOneOf(input.externalProtocolAccess, ['safe', 'full'])
      ? input.externalProtocolAccess
      : 'safe',
    ...(input.nodeSidecarExecPath?.trim()
      ? { nodeSidecarExecPath: input.nodeSidecarExecPath.trim() }
      : {}),
    ...(input.uiPreferences
      ? { uiPreferences: normalizeDesktopUiPreferences(input.uiPreferences) }
      : {})
  }
}

function normalizeDesktopUiPreferences(input: DesktopUiPreferences): DesktopUiPreferences {
  const appearance = {
    ...(isOneOf(input.appearance?.themeMode, ['light', 'dark', 'system'])
      ? { themeMode: input.appearance.themeMode }
      : {}),
    ...(isFiniteNumber(input.appearance?.uiFontSize)
      ? { uiFontSize: input.appearance.uiFontSize }
      : {}),
    ...(typeof input.appearance?.customUiFontFamily === 'string'
      ? { customUiFontFamily: input.appearance.customUiFontFamily.slice(0, 120) }
      : {}),
    ...(isFiniteNumber(input.appearance?.codeFontSize)
      ? { codeFontSize: input.appearance.codeFontSize }
      : {}),
    ...(typeof input.appearance?.customCodeFontFamily === 'string'
      ? { customCodeFontFamily: input.appearance.customCodeFontFamily.slice(0, 120) }
      : {}),
    ...(typeof input.appearance?.showAvatars === 'boolean'
      ? { showAvatars: input.appearance.showAvatars }
      : {}),
    ...(isOneOf(input.appearance?.density, ['compact', 'standard', 'comfortable'])
      ? { density: input.appearance.density }
      : {}),
    ...(isOneOf(input.appearance?.chatContentWidth, ['narrow', 'standard', 'wide'])
      ? { chatContentWidth: input.appearance.chatContentWidth }
      : {}),
    ...(isOneOf(input.appearance?.messageTimeDisplay, ['always', 'hover', 'hidden'])
      ? { messageTimeDisplay: input.appearance.messageTimeDisplay }
      : {}),
    ...(typeof input.appearance?.wrapCode === 'boolean'
      ? { wrapCode: input.appearance.wrapCode }
      : {}),
    ...(isOneOf(input.appearance?.toolExpansion, ['auto', 'expanded', 'collapsed'])
      ? { toolExpansion: input.appearance.toolExpansion }
      : {}),
    ...(isOneOf(input.appearance?.sidebarDisplay, ['persistent', 'auto'])
      ? { sidebarDisplay: input.appearance.sidebarDisplay }
      : {}),
    ...(isOneOf(input.appearance?.markdownFontStyle, ['sans', 'serif', 'custom'])
      ? { markdownFontStyle: input.appearance.markdownFontStyle }
      : {}),
    ...(typeof input.appearance?.customMarkdownFontFamily === 'string'
      ? { customMarkdownFontFamily: input.appearance.customMarkdownFontFamily.slice(0, 120) }
      : {}),
    ...(isOneOf(input.appearance?.motion, ['full', 'reduced'])
      ? { motion: input.appearance.motion }
      : {}),
    ...(isOneOf(input.appearance?.avatarStyle, ['pixel', 'circle', 'hidden'])
      ? { avatarStyle: input.appearance.avatarStyle }
      : {}),
    ...(isOneOf(input.appearance?.userMessageAlignment, ['right', 'left'])
      ? { userMessageAlignment: input.appearance.userMessageAlignment }
      : {}),
    ...(isOneOf(input.appearance?.activityDisplay, ['full', 'compact', 'hidden'])
      ? { activityDisplay: input.appearance.activityDisplay }
      : {}),
    ...(isOneOf(input.appearance?.activityIndicatorStyle, ['pixels', 'pulse', 'hidden'])
      ? { activityIndicatorStyle: input.appearance.activityIndicatorStyle }
      : {}),
    ...(typeof input.appearance?.customActivityText === 'string'
      ? { customActivityText: input.appearance.customActivityText.slice(0, 80) }
      : {})
  }
  const workspace = {
    ...(isFiniteNumber(input.workspace?.sidebarWidth)
      ? { sidebarWidth: input.workspace.sidebarWidth }
      : {}),
    ...(isOneOf(input.workspace?.threadSortMode, ['recent', 'threaded'])
      ? { threadSortMode: input.workspace.threadSortMode }
      : {})
  }
  return {
    ...(Object.keys(appearance).length > 0 ? { appearance } : {}),
    ...(Object.keys(workspace).length > 0 ? { workspace } : {})
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T)
}
