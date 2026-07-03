import { ShikiStreamTokenizer } from '@shikijs/stream'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import typescript from 'shiki/dist/langs/ts.mjs'
import javascript from 'shiki/dist/langs/js.mjs'
import tsx from 'shiki/dist/langs/tsx.mjs'
import jsx from 'shiki/dist/langs/jsx.mjs'
import json from 'shiki/dist/langs/json.mjs'
import bash from 'shiki/dist/langs/bash.mjs'
import shell from 'shiki/dist/langs/shell.mjs'
import diff from 'shiki/dist/langs/diff.mjs'
import vue from 'shiki/dist/langs/vue.mjs'
import css from 'shiki/dist/langs/css.mjs'
import scss from 'shiki/dist/langs/scss.mjs'
import html from 'shiki/dist/langs/html.mjs'
import markdown from 'shiki/dist/langs/md.mjs'
import yaml from 'shiki/dist/langs/yaml.mjs'
import python from 'shiki/dist/langs/python.mjs'
import go from 'shiki/dist/langs/go.mjs'
import rust from 'shiki/dist/langs/rust.mjs'
import githubLight from 'shiki/dist/themes/github-light.mjs'
import githubDark from 'shiki/dist/themes/github-dark.mjs'
import type { HighlighterCore, ThemedToken } from 'shiki/core'

/**
 * Shiki 语法高亮 Worker。
 * 使用 JavaScript Regex Engine 避免 WASM 加载，全部语言静态导入，
 * 使 worker 构建为 IIFE 且无动态 import，兼容现有 Vite 配置。
 */

/** 允许的高亮语言列表。 */
const ALLOWED_LANGUAGES = [
  'bash',
  'css',
  'diff',
  'go',
  'html',
  'javascript',
  'jsx',
  'json',
  'markdown',
  'python',
  'rust',
  'scss',
  'shell',
  'typescript',
  'tsx',
  'vue',
  'yaml'
]

/** 默认主题。 */
const THEMES = {
  light: 'github-light',
  dark: 'github-dark'
}

const langMap = {
  bash,
  css,
  diff,
  go,
  html,
  javascript,
  jsx,
  json,
  markdown,
  python,
  rust,
  scss,
  shell,
  typescript,
  tsx,
  vue,
  yaml
}

const languageAliases: Record<string, string> = {
  cjs: 'javascript',
  console: 'bash',
  htm: 'html',
  js: 'javascript',
  javascriptreact: 'jsx',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shellscript: 'shell',
  ts: 'typescript',
  typescriptreact: 'tsx',
  yml: 'yaml'
}

const themeMap = {
  [THEMES.light]: githubLight,
  [THEMES.dark]: githubDark
}

let highlighter: HighlighterCore | undefined

export interface HighlightToken {
  content: string
  style?: Record<string, string>
}

export type HighlightTokens = HighlightToken[]

/** 高亮结果缓存：lang + theme + codeHash -> tokens。 */
const resultCache = new Map<string, HighlightTokens>()

interface StreamSession {
  code: string
  tokenizer: ShikiStreamTokenizer
}

const streamSessions = new Map<string, StreamSession>()

function normalizeLanguage(lang: string | undefined): string {
  const value = (lang ?? '').toLowerCase().trim()
  const normalized = languageAliases[value] ?? value
  if (ALLOWED_LANGUAGES.includes(normalized)) return normalized
  return 'text'
}

function resolveTheme(theme: string | undefined): string {
  const value = theme ?? THEMES.dark
  return value in themeMap ? value : THEMES.dark
}

async function ensureHighlighter(theme: string): Promise<HighlighterCore> {
  if (!highlighter) {
    highlighter = await createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [],
      engine: createJavaScriptRegexEngine()
    })
  }

  const resolvedTheme = resolveTheme(theme)
  if (!highlighter.getLoadedThemes().includes(resolvedTheme)) {
    await highlighter.loadTheme(themeMap[resolvedTheme as keyof typeof themeMap])
  }
  return highlighter
}

async function ensureLanguage(lang: string): Promise<void> {
  if (!highlighter) return
  const normalized = normalizeLanguage(lang)
  if (normalized === 'text' || highlighter.getLoadedLanguages().includes(normalized)) return

  const registration = langMap[normalized as keyof typeof langMap]
  if (!registration) return
  await highlighter.loadLanguage(registration)
}

export interface HighlightJob {
  messageId: string
  messageRevision: number
  blockIndex: string
  lang: string
  code: string
  codeHash: string
  theme: string
  streaming?: boolean
}

export interface HighlightResponse {
  job: HighlightJob
  reset?: boolean
  recall?: number
  tokens?: HighlightTokens
  error?: string
}

function computeCacheKey(lang: string, theme: string, codeHash: string): string {
  return `${lang}:${theme}:${codeHash}`
}

function computeStreamKey(job: HighlightJob, lang: string, theme: string): string {
  return `${job.messageId}:${job.blockIndex}:${lang}:${theme}`
}

function serializeToken(token: ThemedToken): HighlightToken {
  const style: Record<string, string> = { ...(token.htmlStyle ?? {}) }
  if (token.color) style.color = token.color
  if (token.bgColor) style.backgroundColor = token.bgColor

  if (token.fontStyle !== undefined) {
    if (token.fontStyle & 1) style.fontStyle = 'italic'
    if (token.fontStyle & 2) style.fontWeight = '700'
    if (token.fontStyle & 4) style.textDecoration = 'underline'
  }

  return {
    content: token.content,
    style: Object.keys(style).length > 0 ? style : undefined
  }
}

function serializeTokens(lines: ThemedToken[][]): HighlightTokens {
  return lines.flatMap((line, lineIndex) => {
    const tokens = line.map((token) => serializeToken(token))
    if (lineIndex < lines.length - 1) {
      tokens.push({ content: '\n' })
    }
    return tokens
  })
}

function serializeFlatTokens(tokens: ThemedToken[]): HighlightTokens {
  return tokens.map((token) => serializeToken(token))
}

async function highlightStreaming(
  highlighter: HighlighterCore,
  job: HighlightJob,
  lang: string,
  theme: string
): Promise<HighlightResponse> {
  const streamKey = computeStreamKey(job, lang, theme)
  const existing = streamSessions.get(streamKey)
  const canAppend = existing && job.code.startsWith(existing.code)

  if (!canAppend) {
    const tokenizer = new ShikiStreamTokenizer({
      highlighter,
      lang,
      theme
    })
    await tokenizer.enqueue(job.code)
    streamSessions.set(streamKey, { code: job.code, tokenizer })
    return {
      job,
      reset: true,
      tokens: serializeFlatTokens([...tokenizer.tokensStable, ...tokenizer.tokensUnstable])
    }
  }

  const delta = job.code.slice(existing.code.length)
  if (!delta) {
    return { job, recall: 0, tokens: [] }
  }

  const result = await existing.tokenizer.enqueue(delta)
  existing.code = job.code
  return {
    job,
    recall: result.recall,
    tokens: serializeFlatTokens([...result.stable, ...result.unstable])
  }
}

self.onmessage = async (event: MessageEvent<HighlightJob>) => {
  const job = event.data
  try {
    const MAX_CODE_SIZE = 200 * 1024
    if (!job.code || job.code.length > MAX_CODE_SIZE) {
      self.postMessage({ job, error: 'code_block_too_large' } satisfies HighlightResponse)
      return
    }

    const theme = resolveTheme(job.theme)
    const lang = normalizeLanguage(job.lang)
    const highlighter = await ensureHighlighter(theme)
    await ensureLanguage(lang)

    if (job.streaming) {
      self.postMessage(await highlightStreaming(highlighter, job, lang, theme))
      return
    }

    streamSessions.delete(computeStreamKey(job, lang, theme))

    const cacheKey = computeCacheKey(lang, theme, job.codeHash)
    const cached = resultCache.get(cacheKey)
    if (cached) {
      self.postMessage({ job, reset: true, tokens: cached } satisfies HighlightResponse)
      return
    }

    const tokens = serializeTokens(
      highlighter.codeToTokensBase(job.code, {
        lang,
        theme
      })
    )

    resultCache.set(cacheKey, tokens)
    self.postMessage({ job, reset: true, tokens } satisfies HighlightResponse)
  } catch (error) {
    self.postMessage({
      job,
      error: error instanceof Error ? error.message : String(error)
    } satisfies HighlightResponse)
  }
}
