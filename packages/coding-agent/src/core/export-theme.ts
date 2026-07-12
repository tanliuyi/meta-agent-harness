import type { SourceInfo } from './source-info.ts'

export type ExportTheme = {
  name?: string
  sourcePath?: string
  sourceInfo?: SourceInfo
  colors?: ExportThemeColors
  exportColors?: {
    pageBg?: string
    cardBg?: string
    infoBg?: string
  }
}

export type Theme = ExportTheme
export type ExportThemeColors = Record<string, string>

export const defaultExportTheme: ExportTheme = {
  name: 'default'
}

export function getExportThemeByName(_name: string): ExportTheme | undefined {
  return defaultExportTheme
}

export function getResolvedExportThemeColors(_themeName?: string): ExportThemeColors {
  return {
    pageBg: '#18181e',
    cardBg: '#1e1e24',
    infoBg: '#3c3728',
    userMessageBg: '#343541',
    text: '#f4f4f5',
    muted: '#a1a1aa',
    accent: '#7dd3fc',
    border: '#3f3f46',
    success: '#86efac',
    error: '#fca5a5',
    warning: '#fde68a'
  }
}

export function getExportThemeColors(_themeName?: string): {
  pageBg?: string
  cardBg?: string
  infoBg?: string
} {
  return {}
}
