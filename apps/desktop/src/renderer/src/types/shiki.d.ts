import type { LanguageRegistration, ThemeRegistration } from 'shiki/core'

/**
 * Shiki 子路径导入的模块声明。
 * 由于 shiki 的 `exports` 未为每个 language/theme 子路径显式声明类型，
 * 这里补充声明以便 TypeScript 解析。
 */

declare module 'shiki/langs/*' {
  const lang: LanguageRegistration[]
  export default lang
}

declare module 'shiki/themes/*' {
  const theme: ThemeRegistration
  export default theme
}

declare module 'shiki/dist/langs/*.mjs' {
  const lang: LanguageRegistration[]
  export default lang
}

declare module 'shiki/dist/themes/*.mjs' {
  const theme: ThemeRegistration
  export default theme
}
