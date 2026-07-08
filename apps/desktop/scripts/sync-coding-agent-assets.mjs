import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const repoRoot = resolve(desktopRoot, '..', '..')
const codingAgentRootCandidates = [
  resolve(repoRoot, 'packages', 'coding-agent'),
  resolve(repoRoot, 'vendor', 'pi', 'packages', 'coding-agent')
]
const codingAgentRoot = codingAgentRootCandidates.find((candidate) => existsSync(candidate))
const targetRoot = resolve(desktopRoot, 'resources', 'pi-coding-agent')

if (!codingAgentRoot) {
  throw new Error(`missing coding-agent source; tried: ${codingAgentRootCandidates.join(', ')}`)
}

function copyRequired(source, target) {
  if (!existsSync(source)) {
    throw new Error(`missing coding-agent asset: ${source}`)
  }
  cpSync(source, target, { filter: shouldCopyAsset, recursive: true })
}

function copyOptional(source, target) {
  if (existsSync(source)) {
    cpSync(source, target, { filter: shouldCopyAsset, recursive: true })
  }
}

function copyFirstRequired(candidates, target) {
  const source = candidates.find((candidate) => existsSync(candidate))
  if (!source) {
    throw new Error(`missing coding-agent asset; tried: ${candidates.join(', ')}`)
  }
  cpSync(source, target, { filter: shouldCopyAsset, recursive: true })
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
copyOptional(join(codingAgentRoot, 'npm-shrinkwrap.json'), join(targetRoot, 'npm-shrinkwrap.json'))

const themeSources = [
  join(codingAgentRoot, 'src', 'themes'),
  join(codingAgentRoot, 'src', 'modes', 'interactive', 'theme')
]
copyFirstRequired(themeSources, join(targetRoot, 'dist', 'themes'))
copyFirstRequired(themeSources, join(targetRoot, 'dist', 'modes', 'interactive', 'theme'))

copyOptional(
  join(codingAgentRoot, 'src', 'modes', 'interactive', 'assets'),
  join(targetRoot, 'dist', 'modes', 'interactive', 'assets')
)
copyRequired(
  join(codingAgentRoot, 'src', 'core', 'export-html', 'template.html'),
  join(targetRoot, 'dist', 'core', 'export-html', 'template.html')
)
copyRequired(
  join(codingAgentRoot, 'src', 'core', 'export-html', 'template.css'),
  join(targetRoot, 'dist', 'core', 'export-html', 'template.css')
)
copyRequired(
  join(codingAgentRoot, 'src', 'core', 'export-html', 'template.js'),
  join(targetRoot, 'dist', 'core', 'export-html', 'template.js')
)
copyRequired(
  join(codingAgentRoot, 'src', 'core', 'export-html', 'vendor'),
  join(targetRoot, 'dist', 'core', 'export-html', 'vendor')
)

console.log(`Synced coding-agent assets from ${codingAgentRoot}`)
console.log(`Synced coding-agent assets to ${targetRoot}`)
