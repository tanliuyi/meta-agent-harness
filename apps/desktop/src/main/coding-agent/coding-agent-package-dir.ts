/**
 * Resolves the packaged coding-agent asset directory used by the bundled desktop worker.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const resourcePackageRelativePath = join('resources', 'pi-coding-agent')
const packagedPackageRelativePath = 'pi-coding-agent'

export function resolveCodingAgentPackageDir(): string {
  if (process.env.PI_PACKAGE_DIR) {
    return process.env.PI_PACKAGE_DIR
  }

  for (const candidate of getCodingAgentPackageDirCandidates()) {
    if (existsSync(join(candidate, 'package.json'))) {
      return candidate
    }
  }

  return resolve(process.cwd(), resourcePackageRelativePath)
}

export function getCodingAgentWorkerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PI_PACKAGE_DIR: resolveCodingAgentPackageDir()
  }
}

export function installCodingAgentPackageDirEnv(): void {
  process.env.PI_PACKAGE_DIR = resolveCodingAgentPackageDir()
}

function getCodingAgentPackageDirCandidates(): string[] {
  const candidates: string[] = []

  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, packagedPackageRelativePath))
  }

  candidates.push(resolve(process.cwd(), resourcePackageRelativePath))
  candidates.push(resolve(__dirname, '..', '..', resourcePackageRelativePath))
  candidates.push(resolve(__dirname, '..', '..', '..', resourcePackageRelativePath))
  candidates.push(resolve(__dirname, '..', '..', '..', '..', 'packages', 'coding-agent'))
  candidates.push(resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'coding-agent'))

  return candidates
}
