/**
 * 本文件提供 desktop runtime 使用的快捷键配置与匹配能力。
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAgentDir } from '../config.ts'

export type KeyId = string
export type Keybinding = string
export type KeybindingsConfig = Record<string, KeyId | KeyId[]>
export type KeybindingDefinitions = Record<
  string,
  {
    defaultKeys: KeyId | KeyId[]
    description?: string
  }
>

export interface AppKeybindings {
  'app.interrupt': true
  'app.clear': true
  'app.exit': true
  'app.suspend': true
  'app.thinking.cycle': true
  'app.model.cycleForward': true
  'app.model.cycleBackward': true
  'app.model.select': true
  'app.tools.expand': true
  'app.thinking.toggle': true
  'app.session.toggleNamedFilter': true
  'app.editor.external': true
  'app.message.followUp': true
  'app.message.dequeue': true
  'app.clipboard.pasteImage': true
  'app.session.new': true
  'app.session.tree': true
  'app.session.fork': true
  'app.session.resume': true
  'app.tree.foldOrUp': true
  'app.tree.unfoldOrDown': true
  'app.tree.editLabel': true
  'app.tree.toggleLabelTimestamp': true
  'app.session.togglePath': true
  'app.session.toggleSort': true
  'app.session.rename': true
  'app.session.delete': true
  'app.session.deleteNoninvasive': true
  'app.models.save': true
  'app.models.enableAll': true
  'app.models.clearAll': true
  'app.models.toggleProvider': true
  'app.models.reorderUp': true
  'app.models.reorderDown': true
  'app.tree.filter.default': true
  'app.tree.filter.noTools': true
  'app.tree.filter.userOnly': true
  'app.tree.filter.labeledOnly': true
  'app.tree.filter.all': true
  'app.tree.filter.cycleForward': true
  'app.tree.filter.cycleBackward': true
}

export type AppKeybinding = keyof AppKeybindings

export const KEYBINDINGS = {
  'desktop.editor.cursorUp': { defaultKeys: 'up', description: 'Move cursor up' },
  'desktop.editor.cursorDown': { defaultKeys: 'down', description: 'Move cursor down' },
  'desktop.editor.cursorLeft': { defaultKeys: 'left', description: 'Move cursor left' },
  'desktop.editor.cursorRight': { defaultKeys: 'right', description: 'Move cursor right' },
  'desktop.editor.cursorWordLeft': {
    defaultKeys: 'ctrl+left',
    description: 'Move cursor word left'
  },
  'desktop.editor.cursorWordRight': {
    defaultKeys: 'ctrl+right',
    description: 'Move cursor word right'
  },
  'desktop.editor.cursorLineStart': {
    defaultKeys: 'home',
    description: 'Move cursor to line start'
  },
  'desktop.editor.cursorLineEnd': { defaultKeys: 'end', description: 'Move cursor to line end' },
  'desktop.editor.jumpForward': { defaultKeys: 'ctrl+]', description: 'Jump forward' },
  'desktop.editor.jumpBackward': { defaultKeys: 'ctrl+[', description: 'Jump backward' },
  'desktop.editor.pageUp': { defaultKeys: 'pageup', description: 'Page up' },
  'desktop.editor.pageDown': { defaultKeys: 'pagedown', description: 'Page down' },
  'desktop.editor.deleteCharBackward': {
    defaultKeys: 'backspace',
    description: 'Delete previous character'
  },
  'desktop.editor.deleteCharForward': {
    defaultKeys: 'delete',
    description: 'Delete next character'
  },
  'desktop.editor.deleteWordBackward': {
    defaultKeys: 'ctrl+backspace',
    description: 'Delete previous word'
  },
  'desktop.editor.deleteWordForward': {
    defaultKeys: 'ctrl+delete',
    description: 'Delete next word'
  },
  'desktop.editor.deleteToLineStart': {
    defaultKeys: 'ctrl+u',
    description: 'Delete to line start'
  },
  'desktop.editor.deleteToLineEnd': { defaultKeys: 'ctrl+k', description: 'Delete to line end' },
  'desktop.editor.yank': { defaultKeys: 'ctrl+y', description: 'Yank' },
  'desktop.editor.yankPop': { defaultKeys: 'alt+y', description: 'Yank pop' },
  'desktop.editor.undo': { defaultKeys: 'ctrl+z', description: 'Undo' },
  'desktop.input.newLine': { defaultKeys: 'shift+enter', description: 'Insert newline' },
  'desktop.input.submit': { defaultKeys: 'enter', description: 'Submit' },
  'desktop.input.tab': { defaultKeys: 'tab', description: 'Tab' },
  'desktop.input.copy': { defaultKeys: 'ctrl+c', description: 'Copy' },
  'desktop.select.up': { defaultKeys: 'up', description: 'Select previous item' },
  'desktop.select.down': { defaultKeys: 'down', description: 'Select next item' },
  'desktop.select.pageUp': { defaultKeys: 'pageup', description: 'Select previous page' },
  'desktop.select.pageDown': { defaultKeys: 'pagedown', description: 'Select next page' },
  'desktop.select.confirm': { defaultKeys: 'enter', description: 'Confirm selection' },
  'desktop.select.cancel': { defaultKeys: 'escape', description: 'Cancel selection' },
  'app.interrupt': { defaultKeys: 'escape', description: 'Cancel or abort' },
  'app.clear': { defaultKeys: 'ctrl+c', description: 'Clear editor' },
  'app.exit': { defaultKeys: 'ctrl+d', description: 'Exit when editor is empty' },
  'app.suspend': {
    defaultKeys: process.platform === 'win32' ? [] : 'ctrl+z',
    description: 'Suspend to background'
  },
  'app.thinking.cycle': {
    defaultKeys: 'shift+tab',
    description: 'Cycle thinking level'
  },
  'app.model.cycleForward': {
    defaultKeys: 'ctrl+p',
    description: 'Cycle to next model'
  },
  'app.model.cycleBackward': {
    defaultKeys: 'shift+ctrl+p',
    description: 'Cycle to previous model'
  },
  'app.model.select': { defaultKeys: 'ctrl+l', description: 'Open model selector' },
  'app.tools.expand': { defaultKeys: 'ctrl+o', description: 'Toggle tool output' },
  'app.thinking.toggle': {
    defaultKeys: 'ctrl+t',
    description: 'Toggle thinking blocks'
  },
  'app.session.toggleNamedFilter': {
    defaultKeys: 'ctrl+n',
    description: 'Toggle named session filter'
  },
  'app.editor.external': {
    defaultKeys: 'ctrl+g',
    description: 'Open external editor'
  },
  'app.message.followUp': {
    defaultKeys: 'alt+enter',
    description: 'Queue follow-up message'
  },
  'app.message.dequeue': {
    defaultKeys: 'alt+up',
    description: 'Restore queued messages'
  },
  'app.clipboard.pasteImage': {
    defaultKeys: process.platform === 'win32' ? 'alt+v' : 'ctrl+v',
    description: 'Paste image from clipboard'
  },
  'app.session.new': { defaultKeys: [], description: 'Start a new session' },
  'app.session.tree': { defaultKeys: [], description: 'Open session tree' },
  'app.session.fork': { defaultKeys: [], description: 'Fork current session' },
  'app.session.resume': { defaultKeys: [], description: 'Resume a session' },
  'app.tree.foldOrUp': {
    defaultKeys: ['ctrl+left', 'alt+left'],
    description: 'Fold tree branch or move up'
  },
  'app.tree.unfoldOrDown': {
    defaultKeys: ['ctrl+right', 'alt+right'],
    description: 'Unfold tree branch or move down'
  },
  'app.tree.editLabel': {
    defaultKeys: 'shift+l',
    description: 'Edit tree label'
  },
  'app.tree.toggleLabelTimestamp': {
    defaultKeys: 'shift+t',
    description: 'Toggle tree label timestamps'
  },
  'app.session.togglePath': {
    defaultKeys: 'ctrl+p',
    description: 'Toggle session path display'
  },
  'app.session.toggleSort': {
    defaultKeys: 'ctrl+s',
    description: 'Toggle session sort mode'
  },
  'app.session.rename': {
    defaultKeys: 'ctrl+r',
    description: 'Rename session'
  },
  'app.session.delete': {
    defaultKeys: 'ctrl+d',
    description: 'Delete session'
  },
  'app.session.deleteNoninvasive': {
    defaultKeys: 'ctrl+backspace',
    description: 'Delete session when query is empty'
  },
  'app.models.save': {
    defaultKeys: 'ctrl+s',
    description: 'Save model selection'
  },
  'app.models.enableAll': {
    defaultKeys: 'ctrl+a',
    description: 'Enable all models'
  },
  'app.models.clearAll': {
    defaultKeys: 'ctrl+x',
    description: 'Clear all models'
  },
  'app.models.toggleProvider': {
    defaultKeys: 'ctrl+p',
    description: 'Toggle all models for provider'
  },
  'app.models.reorderUp': {
    defaultKeys: 'alt+up',
    description: 'Move model up in order'
  },
  'app.models.reorderDown': {
    defaultKeys: 'alt+down',
    description: 'Move model down in order'
  },
  'app.tree.filter.default': {
    defaultKeys: 'ctrl+d',
    description: 'Tree filter: default view'
  },
  'app.tree.filter.noTools': {
    defaultKeys: 'ctrl+t',
    description: 'Tree filter: hide tool results'
  },
  'app.tree.filter.userOnly': {
    defaultKeys: 'ctrl+u',
    description: 'Tree filter: user messages only'
  },
  'app.tree.filter.labeledOnly': {
    defaultKeys: 'ctrl+l',
    description: 'Tree filter: labeled entries only'
  },
  'app.tree.filter.all': {
    defaultKeys: 'ctrl+a',
    description: 'Tree filter: show all entries'
  },
  'app.tree.filter.cycleForward': {
    defaultKeys: 'ctrl+o',
    description: 'Tree filter: cycle forward'
  },
  'app.tree.filter.cycleBackward': {
    defaultKeys: 'shift+ctrl+o',
    description: 'Tree filter: cycle backward'
  }
} as const satisfies KeybindingDefinitions

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toKeybindingsConfig(value: unknown): KeybindingsConfig {
  if (!isRecord(value)) return {}

  const config: KeybindingsConfig = {}
  for (const [key, binding] of Object.entries(value)) {
    if (typeof binding === 'string') {
      config[key] = binding as KeyId
      continue
    }
    if (Array.isArray(binding) && binding.every((entry) => typeof entry === 'string')) {
      config[key] = binding as KeyId[]
    }
  }
  return config
}

export function migrateKeybindingsConfig(rawConfig: Record<string, unknown>): {
  config: Record<string, unknown>
  migrated: boolean
} {
  const config = orderKeybindingsConfig(rawConfig)
  return { config, migrated: JSON.stringify(config) !== JSON.stringify(rawConfig) }
}

function orderKeybindingsConfig(config: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {}
  for (const keybinding of Object.keys(KEYBINDINGS)) {
    if (Object.hasOwn(config, keybinding)) {
      ordered[keybinding] = config[keybinding]
    }
  }

  const extras = Object.keys(config)
    .filter((key) => !Object.hasOwn(ordered, key))
    .sort()
  for (const key of extras) {
    ordered[key] = config[key]
  }

  return ordered
}

function loadRawConfig(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function normalizeKey(input: string): string {
  return input.trim().toLowerCase()
}

function toKeyArray(binding: KeyId | KeyId[] | undefined): KeyId[] {
  if (binding === undefined) return []
  return Array.isArray(binding) ? binding : [binding]
}

export class KeybindingsManager {
  private configPath: string | undefined
  private userBindings: KeybindingsConfig

  constructor(userBindings: KeybindingsConfig = {}, configPath?: string) {
    this.userBindings = userBindings
    this.configPath = configPath
  }

  static create(agentDir: string = getAgentDir()): KeybindingsManager {
    const configPath = join(agentDir, 'keybindings.json')
    const userBindings = KeybindingsManager.loadFromFile(configPath)
    return new KeybindingsManager(userBindings, configPath)
  }

  reload(): void {
    if (!this.configPath) return
    this.setUserBindings(KeybindingsManager.loadFromFile(this.configPath))
  }

  getEffectiveConfig(): KeybindingsConfig {
    return this.getResolvedBindings()
  }

  getResolvedBindings(): KeybindingsConfig {
    const resolved: KeybindingsConfig = {}
    for (const [id, definition] of Object.entries(KEYBINDINGS)) {
      resolved[id] = definition.defaultKeys
    }
    return { ...resolved, ...this.userBindings }
  }

  setUserBindings(userBindings: KeybindingsConfig): void {
    this.userBindings = userBindings
  }

  matches(input: string, id: KeyId): boolean {
    const candidates = toKeyArray(this.getResolvedBindings()[id])
    const normalizedInput = normalizeKey(input)
    return candidates.some((candidate) => normalizeKey(candidate) === normalizedInput)
  }

  private static loadFromFile(path: string): KeybindingsConfig {
    const rawConfig = loadRawConfig(path)
    if (!rawConfig) return {}
    return toKeybindingsConfig(migrateKeybindingsConfig(rawConfig).config)
  }
}
