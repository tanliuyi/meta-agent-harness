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
import type { HighlighterCore } from 'shiki/core'

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

/** 高亮结果缓存：lang + theme + codeHash -> html。 */
const resultCache = new Map<string, string>()

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
}

export interface HighlightResponse {
  job: HighlightJob
  html?: string
  error?: string
}

function computeCacheKey(lang: string, theme: string, codeHash: string): string {
  return `${lang}:${theme}:${codeHash}`
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
    const cacheKey = computeCacheKey(lang, theme, job.codeHash)
    const cached = resultCache.get(cacheKey)
    if (cached) {
      self.postMessage({ job, html: cached } satisfies HighlightResponse)
      return
    }

    const highlighter = await ensureHighlighter(theme)
    await ensureLanguage(lang)

    const html = highlighter.codeToHtml(job.code, {
      lang,
      theme
    })

    resultCache.set(cacheKey, html)
    self.postMessage({ job, html } satisfies HighlightResponse)
  } catch (error) {
    self.postMessage({
      job,
      error: error instanceof Error ? error.message : String(error)
    } satisfies HighlightResponse)
  }
}
