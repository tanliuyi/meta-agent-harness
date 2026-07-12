export function formatFileArgForInsertion(relativePath: string): string {
  const normalized = relativePath.split('\\').join('/')
  return /\s/.test(normalized) ? `@"${normalized.replace(/"/g, '\\"')}"` : `@${normalized}`
}
