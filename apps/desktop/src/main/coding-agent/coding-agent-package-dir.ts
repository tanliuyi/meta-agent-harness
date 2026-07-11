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

export function getCodingAgentWorkerEnv(
  options: {
    stripElectronRunAsNode?: boolean
  } = {}
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (options.stripElectronRunAsNode) {
    delete env.ELECTRON_RUN_AS_NODE
  }
  // 该标记只属于扩展通过 Desktop launcher 启动的 CLI 子进程。内部 worker
  // 必须始终走 IPC 模式，不能继承父 CLI 或测试进程中的兼容模式标记。
  delete env.META_AGENT_DESKTOP_PI_CLI
  env.PI_PACKAGE_DIR = resolveCodingAgentPackageDir()
  return env
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
