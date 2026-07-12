/**
 * Desktop argv compatibility runner for extension-spawned child agents.
 *
 * This supports Pi argv protocols without depending on the CLI entrypoint.
 */

import { createInterface } from 'node:readline'
import { type ImageContent, modelsAreEqual } from '@earendil-works/pi-ai'
import chalk from 'chalk'
import { type Args, type Mode, parseArgs, printHelp } from '@earendil-works/pi-coding-agent'
import { processFileArguments } from '@earendil-works/pi-coding-agent'
import { buildInitialMessage } from '@earendil-works/pi-coding-agent'
import { listModels } from '@earendil-works/pi-coding-agent'
import {
  ENV_SESSION_DIR,
  expandTildePath,
  getAgentDir,
  getPackageDir,
  VERSION
} from '@earendil-works/pi-coding-agent'
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionRuntime
} from '@earendil-works/pi-coding-agent'
import {
  type AgentSessionRuntimeDiagnostic,
  createAgentSessionFromServices,
  createAgentSessionServices
} from '@earendil-works/pi-coding-agent'
import { formatNoModelsAvailableMessage } from '@earendil-works/pi-coding-agent'
import { AuthStorage } from '@earendil-works/pi-coding-agent'
import { exportFromFile } from '@earendil-works/pi-coding-agent'
import type { ProjectTrustContext } from '@earendil-works/pi-coding-agent'
import { applyHttpProxySettings, configureHttpDispatcher } from '@earendil-works/pi-coding-agent'
import type { ModelRegistry } from '@earendil-works/pi-coding-agent'
import {
  resolveCliModel,
  resolveModelScope,
  type ScopedModel
} from '@earendil-works/pi-coding-agent'
import { restoreStdout, takeOverStdout } from '@earendil-works/pi-coding-agent'
import { type AppMode, resolveProjectTrusted } from '@earendil-works/pi-coding-agent'
import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent'
import {
  formatMissingSessionCwdPrompt,
  getMissingSessionCwdIssue,
  MissingSessionCwdError
} from '@earendil-works/pi-coding-agent'
import { assertValidSessionId, SessionManager } from '@earendil-works/pi-coding-agent'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { printTimings, resetTimings, time } from '@earendil-works/pi-coding-agent'
import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore
} from '@earendil-works/pi-coding-agent'
import { runMigrations } from '@earendil-works/pi-coding-agent'
import { runPrintMode } from '@earendil-works/pi-coding-agent'
import { runRpcMode } from '@earendil-works/pi-coding-agent'
import { handleConfigCommand, handlePackageCommand } from '@earendil-works/pi-coding-agent'
import { isLocalPath, normalizePath, resolvePath } from '@earendil-works/pi-coding-agent'
import { cleanupWindowsSelfUpdateQuarantine } from '@earendil-works/pi-coding-agent'

const EXTENSION_LOAD_FAILURE_HINT = 'Hint: Start without extensions using "pi -ne".'

type ResolvedSession =
  | { type: 'path'; path: string }
  | { type: 'local'; path: string }
  | { type: 'global'; path: string; cwd: string }
  | { type: 'not_found'; arg: string }

class DesktopRunnerExit extends Error {
  constructor(readonly code: number) {
    super(`Desktop runner exit ${code}`)
  }
}

export function isDesktopPrintModeArgs(args: readonly string[]): boolean {
  return args.length > 0
}

export async function runDesktopPrintMode(args: string[]): Promise<number> {
  resetTimings()
  if (process.platform === 'win32') {
    cleanupWindowsSelfUpdateQuarantine(getPackageDir())
  }

  const cwd = process.cwd()
  const agentDir = getAgentDir()
  const offlineMode = args.includes('--offline') || isTruthyEnvFlag(process.env.PI_OFFLINE)
  if (offlineMode) {
    process.env.PI_OFFLINE = '1'
    process.env.PI_SKIP_VERSION_CHECK = '1'
  }

  try {
    const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, {
      projectTrusted: false
    })
    applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy)
    configureHttpDispatcher()

    if (await handlePackageCommand(args)) {
      return getProcessExitCode()
    }
    if (await handleConfigCommand(args)) {
      return getProcessExitCode()
    }

    const parsed = parseArgs(args)
    if (parsed.diagnostics.length > 0) {
      reportDiagnostics(parsed.diagnostics)
      if (parsed.diagnostics.some((diagnostic) => diagnostic.type === 'error')) {
        return 1
      }
    }
    time('parseArgs')

    if (parsed.version) {
      console.log(VERSION)
      return 0
    }

    if (parsed.export) {
      try {
        const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined
        const result = await exportFromFile(parsed.export, outputPath)
        console.log(`Exported to: ${result}`)
        return 0
      } catch (error) {
        console.error(
          chalk.red(`Error: ${error instanceof Error ? error.message : 'Failed to export session'}`)
        )
        return 1
      }
    }

    const appMode = resolveAppMode(parsed)
    const shouldTakeOverStdout = !isPlainRuntimeMetadataCommand(parsed)
    if (shouldTakeOverStdout) {
      takeOverStdout()
    }

    if (parsed.mode === 'rpc' && parsed.fileArgs.length > 0) {
      console.error(chalk.red('Error: @file arguments are not supported in RPC mode'))
      return 1
    }

    const { deprecationWarnings } = runMigrations(cwd)
    time('runMigrations')
    const startupSettingsManager = SettingsManager.create(cwd, agentDir)
    reportDiagnostics(collectSettingsDiagnostics(startupSettingsManager, 'startup session lookup'))

    validateSessionIdFlags(parsed)
    validateForkFlags(parsed)

    const envSessionDir = process.env[ENV_SESSION_DIR]
    const sessionDir =
      (parsed.sessionDir ? normalizePath(parsed.sessionDir) : undefined) ??
      (envSessionDir ? expandTildePath(envSessionDir) : undefined) ??
      startupSettingsManager.getSessionDir()
    const sessionManager = await createDesktopPrintSessionManager(parsed, cwd, sessionDir)
    const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd)
    if (missingSessionCwdIssue) {
      console.error(chalk.yellow(formatMissingSessionCwdPrompt(missingSessionCwdIssue)))
      console.error(chalk.red(new MissingSessionCwdError(missingSessionCwdIssue).message))
      return 1
    }

    if (parsed.name !== undefined) {
      const name = parsed.name.trim()
      if (!name) {
        console.error(chalk.red('Error: --name requires a non-empty value'))
        return 1
      }
      sessionManager.appendSessionInfo(name)
    }
    time('createSessionManager')

    const runtime = await createDesktopPrintRuntime({
      parsed,
      startupCwd: cwd,
      agentDir,
      sessionManager,
      startupSettingsManager,
      appMode
    })
    const { settingsManager, modelRegistry, resourceLoader } = runtime.services
    applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy)
    configureHttpDispatcher(settingsManager.getHttpIdleTimeoutMs())

    if (parsed.help) {
      const extensionFlags = resourceLoader
        .getExtensions()
        .extensions.flatMap((extension) => Array.from(extension.flags.values()))
      printHelp(extensionFlags)
      await runtime.dispose()
      return 0
    }

    if (parsed.listModels !== undefined) {
      const searchPattern = typeof parsed.listModels === 'string' ? parsed.listModels : undefined
      await listModels(modelRegistry, searchPattern)
      await runtime.dispose()
      return 0
    }

    let stdinContent: string | undefined
    if (appMode !== 'rpc') {
      stdinContent = await readPipedStdin()
    }
    time('readPipedStdin')

    const { initialMessage, initialImages } = await prepareInitialMessage(
      parsed,
      settingsManager.getImageAutoResize(),
      stdinContent
    )
    time('prepareInitialMessage')
    for (const warning of deprecationWarnings) {
      console.error(chalk.yellow(`Warning: ${warning}`))
    }
    time('resolveModelScope')
    reportDiagnostics(runtime.diagnostics)
    if (runtime.diagnostics.some((diagnostic) => diagnostic.type === 'error')) {
      if (
        runtime.diagnostics.some((diagnostic) =>
          diagnostic.message.includes('Failed to load extension')
        )
      ) {
        console.error(chalk.yellow(EXTENSION_LOAD_FAILURE_HINT))
      }
      await runtime.dispose()
      return 1
    }
    time('createAgentSession')

    if (appMode !== 'interactive' && !runtime.session.model) {
      console.error(chalk.red(formatNoModelsAvailableMessage()))
      await runtime.dispose()
      return 1
    }

    if (isTruthyEnvFlag(process.env.PI_STARTUP_BENCHMARK)) {
      console.error(
        chalk.red('Error: PI_STARTUP_BENCHMARK is not supported by the desktop-only runtime')
      )
      await runtime.dispose()
      return 1
    }

    if (appMode === 'rpc') {
      printTimings()
      await runRpcMode(runtime)
      return getProcessExitCode()
    }

    printTimings()
    const exitCode = await runPrintMode(runtime, {
      mode: toPrintOutputMode(appMode),
      messages: parsed.messages,
      initialMessage,
      initialImages
    })
    restoreStdout()
    return exitCode
  } catch (error) {
    if (error instanceof DesktopRunnerExit) {
      return error.code
    }
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
    return 1
  }
}

async function createDesktopPrintRuntime(options: {
  parsed: Args
  startupCwd: string
  agentDir: string
  sessionManager: SessionManager
  startupSettingsManager: SettingsManager
  appMode: AppMode
}) {
  const { parsed, agentDir, startupSettingsManager, appMode } = options
  const trustStore = new ProjectTrustStore(agentDir)
  const projectTrustByCwd = new Map<string, boolean>()
  const trustPromptMode: AppMode =
    parsed.help || parsed.listModels !== undefined ? 'print' : appMode
  const resolvedExtensionPaths = resolveCliPaths(options.startupCwd, parsed.extensions)
  const resolvedSkillPaths = resolveCliPaths(options.startupCwd, parsed.skills)
  const resolvedPromptTemplatePaths = resolveCliPaths(options.startupCwd, parsed.promptTemplates)
  const resolvedThemePaths = resolveCliPaths(options.startupCwd, parsed.themes)
  const authStorage = AuthStorage.create()

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
    projectTrustContext
  }) => {
    const isInitialRuntime = sessionStartEvent === undefined
    const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = []
    const cachedProjectTrust = projectTrustByCwd.get(cwd)
    const hasTrustRequiringResources = hasTrustRequiringProjectResources(cwd)
    const shouldResolveProjectTrust =
      parsed.projectTrustOverride === undefined &&
      cachedProjectTrust === undefined &&
      hasTrustRequiringResources
    const projectTrusted = shouldResolveProjectTrust
      ? false
      : (cachedProjectTrust ??
        parsed.projectTrustOverride ??
        (!hasTrustRequiringResources || trustStore.get(cwd) === true))

    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted })
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      authStorage,
      settingsManager,
      extensionFlagValues: parsed.unknownFlags,
      resourceLoaderReloadOptions: shouldResolveProjectTrust
        ? {
            resolveProjectTrust: async ({ extensionsResult }) => {
              const trusted = await resolveProjectTrusted({
                cwd,
                trustStore,
                trustOverride: parsed.projectTrustOverride,
                defaultProjectTrust: startupSettingsManager.getDefaultProjectTrust(),
                extensionsResult,
                projectTrustContext:
                  projectTrustContext ??
                  createDesktopProjectTrustContext({
                    cwd,
                    mode: isInitialRuntime ? trustPromptMode : appMode
                  }),
                onExtensionError: (message) =>
                  projectTrustDiagnostics.push({ type: 'warning', message })
              })
              projectTrustByCwd.set(cwd, trusted)
              return trusted
            }
          }
        : undefined,
      resourceLoaderOptions: {
        additionalExtensionPaths: resolvedExtensionPaths,
        additionalSkillPaths: resolvedSkillPaths,
        additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
        additionalThemePaths: resolvedThemePaths,
        noExtensions: parsed.noExtensions,
        noSkills: parsed.noSkills,
        noPromptTemplates: parsed.noPromptTemplates,
        noThemes: parsed.noThemes,
        noContextFiles: parsed.noContextFiles,
        systemPrompt: parsed.systemPrompt,
        appendSystemPrompt: parsed.appendSystemPrompt
      }
    })
    const { settingsManager: runtimeSettings, modelRegistry, resourceLoader } = services
    const diagnostics: AgentSessionRuntimeDiagnostic[] = [
      ...projectTrustDiagnostics,
      ...services.diagnostics,
      ...collectSettingsDiagnostics(runtimeSettings, 'runtime creation'),
      ...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
        type: 'error' as const,
        message: `Failed to load extension "${path}": ${error}`
      }))
    ]

    const modelPatterns = parsed.models ?? runtimeSettings.getEnabledModels()
    const scopedModels =
      modelPatterns && modelPatterns.length > 0
        ? await resolveModelScope(modelPatterns, modelRegistry)
        : []
    const {
      options: sessionOptions,
      cliThinkingFromModel,
      diagnostics: sessionOptionDiagnostics
    } = buildSessionOptions(
      parsed,
      scopedModels,
      sessionManager.buildSessionContext().messages.length > 0,
      modelRegistry,
      runtimeSettings
    )
    diagnostics.push(...sessionOptionDiagnostics)

    if (parsed.apiKey) {
      if (!sessionOptions.model) {
        diagnostics.push({
          type: 'error',
          message:
            '--api-key requires a model to be specified via --model, --provider/--model, or --models'
        })
      } else {
        authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey)
      }
    }

    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model: sessionOptions.model,
      thinkingLevel: sessionOptions.thinkingLevel,
      scopedModels: sessionOptions.scopedModels,
      tools: sessionOptions.tools,
      excludeTools: sessionOptions.excludeTools,
      noTools: sessionOptions.noTools,
      customTools: sessionOptions.customTools
    })
    const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel
    if (created.session.model && cliThinkingOverride) {
      created.session.setThinkingLevel(created.session.thinkingLevel)
    }

    return { ...created, services, diagnostics }
  }

  time('createRuntime')
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: options.sessionManager.getCwd(),
    agentDir,
    sessionManager: options.sessionManager
  })
  time('createAgentSessionRuntime')
  return runtime
}

async function prepareInitialMessage(
  parsed: Args,
  autoResizeImages: boolean,
  stdinContent?: string
): Promise<{
  initialMessage?: string
  initialImages?: ImageContent[]
}> {
  if (parsed.fileArgs.length === 0) {
    return buildInitialMessage({ parsed, stdinContent })
  }

  const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages })
  return buildInitialMessage({
    parsed,
    fileText: text,
    fileImages: images,
    stdinContent
  })
}

async function createDesktopPrintSessionManager(
  parsed: Args,
  cwd: string,
  sessionDir: string | undefined
): Promise<SessionManager> {
  if (parsed.noSession || parsed.help || parsed.listModels !== undefined) {
    return SessionManager.inMemory(
      cwd,
      parsed.sessionId !== undefined ? { id: parsed.sessionId } : undefined
    )
  }

  if (parsed.fork) {
    if (parsed.sessionId) {
      const existingTarget = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir)
      if (existingTarget) {
        throw new Error(`Session already exists with id '${parsed.sessionId}'`)
      }
    }
    const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir)
    if (resolved.type === 'not_found') {
      throw new Error(`No session found matching '${resolved.arg}'`)
    }
    return SessionManager.forkFrom(resolved.path, cwd, sessionDir, { id: parsed.sessionId })
  }

  if (parsed.session) {
    const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir)
    if (resolved.type === 'not_found') {
      throw new Error(`No session found matching '${resolved.arg}'`)
    }
    if (resolved.type === 'global') {
      console.log(chalk.yellow(`Session found in different project: ${resolved.cwd}`))
      const shouldFork = await promptConfirm('Fork this session into current directory?')
      if (!shouldFork) {
        console.log(chalk.dim('Aborted.'))
        throw new DesktopRunnerExit(0)
      }
      return SessionManager.forkFrom(resolved.path, cwd, sessionDir)
    }
    return SessionManager.open(resolved.path, sessionDir, undefined)
  }

  if (parsed.resume || parsed.continue) {
    return SessionManager.continueRecent(cwd, sessionDir)
  }

  if (parsed.sessionId) {
    const existingSession = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir)
    if (existingSession) {
      return SessionManager.open(existingSession.path, sessionDir)
    }
  }

  return SessionManager.create(cwd, sessionDir, { id: parsed.sessionId })
}

async function readPipedStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined
  }

  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      resolve(data.trim() || undefined)
    })
    process.stdin.resume()
  })
}

async function promptConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    })
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

async function findLocalSessionByExactId(
  sessionId: string,
  cwd: string,
  sessionDir?: string
): Promise<{ type: 'local'; path: string } | undefined> {
  const localSessions = await SessionManager.list(cwd, sessionDir)
  const localMatch = localSessions.find((session) => session.id === sessionId)
  return localMatch ? { type: 'local', path: localMatch.path } : undefined
}

async function resolveSessionPath(
  sessionArg: string,
  cwd: string,
  sessionDir?: string
): Promise<ResolvedSession> {
  if (sessionArg.includes('/') || sessionArg.includes('\\') || sessionArg.endsWith('.jsonl')) {
    return { type: 'path', path: resolvePath(sessionArg, cwd) }
  }

  const localSessions = await SessionManager.list(cwd, sessionDir)
  const localMatch =
    localSessions.find((session) => session.id === sessionArg) ??
    localSessions.find((session) => session.id.startsWith(sessionArg))
  if (localMatch) {
    return { type: 'local', path: localMatch.path }
  }

  const allSessions = await SessionManager.listAll(sessionDir)
  const globalMatch =
    allSessions.find((session) => session.id === sessionArg) ??
    allSessions.find((session) => session.id.startsWith(sessionArg))
  if (globalMatch) {
    return { type: 'global', path: globalMatch.path, cwd: globalMatch.cwd }
  }

  return { type: 'not_found', arg: sessionArg }
}

function buildSessionOptions(
  parsed: Args,
  scopedModels: ScopedModel[],
  hasExistingSession: boolean,
  modelRegistry: ModelRegistry,
  settingsManager: SettingsManager
): {
  options: CreateAgentSessionOptions
  cliThinkingFromModel: boolean
  diagnostics: AgentSessionRuntimeDiagnostic[]
} {
  const options: CreateAgentSessionOptions = {}
  const diagnostics: AgentSessionRuntimeDiagnostic[] = []
  let cliThinkingFromModel = false

  if (parsed.model) {
    const resolved = resolveCliModel({
      cliProvider: parsed.provider,
      cliModel: parsed.model,
      cliThinking: parsed.thinking,
      modelRegistry
    })
    if (resolved.warning) diagnostics.push({ type: 'warning', message: resolved.warning })
    if (resolved.error) diagnostics.push({ type: 'error', message: resolved.error })
    if (resolved.model) {
      options.model = resolved.model
      if (!parsed.thinking && resolved.thinkingLevel) {
        options.thinkingLevel = resolved.thinkingLevel
        cliThinkingFromModel = true
      }
    }
  }

  if (!options.model && scopedModels.length > 0 && !hasExistingSession) {
    const savedProvider = settingsManager.getDefaultProvider()
    const savedModelId = settingsManager.getDefaultModel()
    const savedModel =
      savedProvider && savedModelId ? modelRegistry.find(savedProvider, savedModelId) : undefined
    const savedInScope = savedModel
      ? scopedModels.find((scoped) => modelsAreEqual(scoped.model, savedModel))
      : undefined
    const selected = savedInScope ?? scopedModels[0]
    options.model = selected.model
    if (!parsed.thinking && selected.thinkingLevel) {
      options.thinkingLevel = selected.thinkingLevel
    }
  }

  if (parsed.thinking) {
    options.thinkingLevel = parsed.thinking
  }
  if (scopedModels.length > 0) {
    options.scopedModels = scopedModels.map((scoped) => ({
      model: scoped.model,
      thinkingLevel: scoped.thinkingLevel
    }))
  }
  if (parsed.noTools) {
    options.noTools = 'all'
  } else if (parsed.noBuiltinTools) {
    options.noTools = 'builtin'
  }
  if (parsed.tools) {
    options.tools = [...parsed.tools]
  }
  if (parsed.excludeTools) {
    options.excludeTools = [...parsed.excludeTools]
  }

  return { options, cliThinkingFromModel, diagnostics }
}

function collectSettingsDiagnostics(
  settingsManager: SettingsManager,
  context: string
): AgentSessionRuntimeDiagnostic[] {
  return settingsManager.drainErrors().map(({ scope, error }) => ({
    type: 'warning',
    message: `(${context}, ${scope} settings) ${error.message}`
  }))
}

function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const color =
      diagnostic.type === 'error'
        ? chalk.red
        : diagnostic.type === 'warning'
          ? chalk.yellow
          : chalk.dim
    const prefix =
      diagnostic.type === 'error' ? 'Error: ' : diagnostic.type === 'warning' ? 'Warning: ' : ''
    console.error(color(`${prefix}${diagnostic.message}`))
  }
}

function createDesktopProjectTrustContext(options: {
  cwd: string
  mode: AppMode
}): ProjectTrustContext {
  return {
    cwd: options.cwd,
    mode: options.mode === 'interactive' ? 'print' : options.mode,
    hasUI: false,
    ui: {
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      notify: (message, type = 'info') => {
        const color = type === 'error' ? chalk.red : type === 'warning' ? chalk.yellow : chalk.cyan
        console.error(color(message))
      }
    }
  }
}

function resolveAppMode(parsed: Args): AppMode {
  if (parsed.mode === 'rpc') {
    return 'rpc'
  }
  if (parsed.mode === 'json') {
    return 'json'
  }
  return 'print'
}

function toPrintOutputMode(appMode: AppMode): Exclude<Mode, 'rpc'> {
  return appMode === 'json' ? 'json' : 'text'
}

function isPlainRuntimeMetadataCommand(parsed: Args): boolean {
  return (
    !parsed.print &&
    parsed.mode === undefined &&
    (parsed.help === true || parsed.listModels !== undefined)
  )
}

function validateForkFlags(parsed: Args): void {
  if (!parsed.fork) return
  const conflictingFlags = [
    parsed.session ? '--session' : undefined,
    parsed.continue ? '--continue' : undefined,
    parsed.resume ? '--resume' : undefined,
    parsed.noSession ? '--no-session' : undefined
  ].filter((flag): flag is string => flag !== undefined)
  if (conflictingFlags.length > 0) {
    throw new Error(`--fork cannot be combined with ${conflictingFlags.join(', ')}`)
  }
}

function validateSessionIdFlags(parsed: Args): void {
  if (parsed.sessionId === undefined) return
  const conflictingFlags = [
    parsed.session ? '--session' : undefined,
    parsed.continue ? '--continue' : undefined,
    parsed.resume ? '--resume' : undefined
  ].filter((flag): flag is string => flag !== undefined)
  if (conflictingFlags.length > 0) {
    throw new Error(`--session-id cannot be combined with ${conflictingFlags.join(', ')}`)
  }
  assertValidSessionId(parsed.sessionId)
}

function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] | undefined {
  return paths?.map((value) => (isLocalPath(value) ? resolvePath(value, cwd) : value))
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'
}

function getProcessExitCode(): number {
  return typeof process.exitCode === 'number' ? process.exitCode : 0
}
