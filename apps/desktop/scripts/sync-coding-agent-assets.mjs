import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const repoRoot = resolve(desktopRoot, '..', '..')
const codingAgentRoot = resolve(repoRoot, 'packages', 'coding-agent-desktop')
const targetRoot = resolve(desktopRoot, '.generated', 'pi-coding-agent')

function copyRequired(source, target) {
  if (!existsSync(source)) {
    throw new Error(`missing coding-agent-desktop asset: ${source}`)
  }
  cpSync(source, target, { filter: shouldCopyAsset, recursive: true })
}

function copyOptional(source, target) {
  if (existsSync(source)) {
    cpSync(source, target, { filter: shouldCopyAsset, recursive: true })
  }
}

function shouldCopyAsset(source) {
  return !source.split(/[\\/]/).includes('node_modules')
}

rmSync(targetRoot, { recursive: true, force: true })
mkdirSync(targetRoot, { recursive: true })

copyRequired(join(codingAgentRoot, 'package.json'), join(targetRoot, 'package.json'))
copyRequired(join(codingAgentRoot, 'README.md'), join(targetRoot, 'README.md'))
copyRequired(join(codingAgentRoot, 'CHANGELOG.md'), join(targetRoot, 'CHANGELOG.md'))
copyRequired(join(codingAgentRoot, 'docs'), join(targetRoot, 'docs'))
copyRequired(join(codingAgentRoot, 'examples'), join(targetRoot, 'examples'))
copyOptional(join(codingAgentRoot, 'containerization.md'), join(targetRoot, 'containerization.md'))

copyRequired(join(codingAgentRoot, 'src', 'agent-runtime', 'themes'), join(targetRoot, 'dist', 'themes'))
copyRequired(
  join(codingAgentRoot, 'src', 'agent-runtime', 'core', 'export-html', 'template.html'),
  join(targetRoot, 'dist', 'core', 'export-html', 'template.html')
)
copyRequired(
  join(codingAgentRoot, 'src', 'agent-runtime', 'core', 'export-html', 'template.css'),
  join(targetRoot, 'dist', 'core', 'export-html', 'template.css')
)
copyRequired(
  join(codingAgentRoot, 'src', 'agent-runtime', 'core', 'export-html', 'template.js'),
  join(targetRoot, 'dist', 'core', 'export-html', 'template.js')
)
copyRequired(
  join(codingAgentRoot, 'src', 'agent-runtime', 'core', 'export-html', 'vendor'),
  join(targetRoot, 'dist', 'core', 'export-html', 'vendor')
)

console.log(`Synced coding-agent-desktop assets to ${targetRoot}`)
