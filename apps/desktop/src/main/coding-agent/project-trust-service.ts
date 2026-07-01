/**
 * 本文件把 project trust 规则包装为 desktop Project 级产品状态。
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type {
  ProjectSummary,
  ProjectTrustDecision,
  ProjectTrustSummary
} from '../../shared/coding-agent/types'

/** Project 配置目录名。 */
const projectConfigDirName = '.pi'

/** 需要 trust 才加载的 Project 本地资源。 */
const trustRequiringProjectResources = [
  'settings.json',
  'extensions',
  'skills',
  'prompts',
  'themes',
  'SYSTEM.md',
  'APPEND_SYSTEM.md'
] as const

/** trust.json 内容。 */
type TrustFile = Record<string, boolean | null | undefined>

/** 已保存的 trust 决策。 */
interface SavedTrustDecision {
  /** 命中的路径。 */
  path: string
  /** trust 决策。 */
  decision: boolean
}

/**
 * Desktop Project trust 服务。
 */
export class ProjectTrustService {
  private readonly trustPath: string
  private readonly sessionDecisions = new Map<string, boolean>()

  /**
   * 创建 ProjectTrustService。
   * @param agentDir - agent 目录。
   */
  constructor(agentDir = getDefaultAgentDir()) {
    this.trustPath = join(resolvePath(agentDir), 'trust.json')
  }

  /**
   * 为 Project 附加 trust 摘要。
   * @param project - Project 摘要。
   * @returns 带 trust 摘要的 Project。
   */
  decorateProject(project: ProjectSummary): ProjectSummary {
    return {
      ...project,
      trust: this.getTrustSummary(project.path)
    }
  }

  /**
   * 为 Project 列表附加 trust 摘要。
   * @param projects - Project 列表。
   * @returns 带 trust 摘要的 Project 列表。
   */
  decorateProjects(projects: ProjectSummary[]): ProjectSummary[] {
    return projects.map((project) => this.decorateProject(project))
  }

  /**
   * 获取指定 cwd 的当前 trust 决策。
   * @param cwd - Project cwd。
   * @returns 是否 trusted。
   */
  isProjectTrusted(cwd: string): boolean {
    const summary = this.getTrustSummary(cwd)
    return summary.state === 'trusted' || summary.state === 'notRequired'
  }

  /**
   * 设置 Project trust。
   * @param project - Project。
   * @param decision - 用户选择的 trust 决策。
   */
  setProjectTrust(project: ProjectSummary, decision: ProjectTrustDecision): void {
    switch (decision) {
      case 'trustProject':
        this.sessionDecisions.delete(normalizePath(project.path))
        this.setTrust(project.path, true)
        return
      case 'trustParent': {
        const parentPath = getProjectTrustParentPath(project.path)
        if (!parentPath) {
          this.setTrust(project.path, true)
          return
        }
        this.sessionDecisions.delete(normalizePath(project.path))
        this.setTrust(parentPath, true)
        this.setTrust(project.path, null)
        return
      }
      case 'trustSession':
        this.sessionDecisions.set(normalizePath(project.path), true)
        return
      case 'doNotTrust':
        this.sessionDecisions.delete(normalizePath(project.path))
        this.setTrust(project.path, false)
        return
    }
  }

  /**
   * 获取 Project trust 摘要。
   * @param cwd - Project cwd。
   * @returns trust 摘要。
   */
  private getTrustSummary(cwd: string): ProjectTrustSummary {
    const requiresTrust = hasTrustRequiringProjectResources(cwd)
    const parentPath = getProjectTrustParentPath(cwd)
    if (!requiresTrust) {
      return {
        state: 'notRequired',
        requiresTrust: false,
        parentPath
      }
    }
    const normalizedCwd = normalizePath(cwd)
    if (this.sessionDecisions.get(normalizedCwd) === true) {
      return {
        state: 'trusted',
        requiresTrust: true,
        parentPath,
        sessionOnly: true
      }
    }
    const saved = this.getSavedTrust(cwd)
    return {
      state: saved ? (saved.decision ? 'trusted' : 'untrusted') : 'unknown',
      requiresTrust: true,
      savedPath: saved?.path,
      parentPath
    }
  }

  /**
   * 读取已保存的 trust 决策。
   * @param cwd - Project cwd。
   * @returns 已保存决策。
   */
  private getSavedTrust(cwd: string): SavedTrustDecision | undefined {
    const data = this.readTrustFile()
    let currentDir = normalizePath(cwd)
    while (true) {
      const value = data[currentDir]
      if (value === true || value === false) {
        return { path: currentDir, decision: value }
      }
      const parentDir = dirname(currentDir)
      if (parentDir === currentDir) {
        return undefined
      }
      currentDir = parentDir
    }
  }

  /**
   * 写入 trust 决策。
   * @param cwd - 路径。
   * @param decision - 决策；null 表示删除。
   */
  private setTrust(cwd: string, decision: boolean | null): void {
    const data = this.readTrustFile()
    const key = normalizePath(cwd)
    if (decision === null) {
      delete data[key]
    } else {
      data[key] = decision
    }
    this.writeTrustFile(data)
  }

  /**
   * 读取 trust.json。
   * @returns trust 数据。
   */
  private readTrustFile(): TrustFile {
    if (!existsSync(this.trustPath)) {
      return {}
    }
    const parsed = JSON.parse(readFileSync(this.trustPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as TrustFile
  }

  /**
   * 写入 trust.json。
   * @param data - trust 数据。
   */
  private writeTrustFile(data: TrustFile): void {
    const sorted: TrustFile = {}
    for (const key of Object.keys(data).sort()) {
      const value = data[key]
      if (value === true || value === false || value === null) {
        sorted[key] = value
      }
    }
    mkdirSync(dirname(this.trustPath), { recursive: true })
    writeFileSync(this.trustPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
  }
}

/**
 * 获取默认 agent 目录。
 * @returns 默认 agent 目录。
 */
function getDefaultAgentDir(): string {
  return join(homedir(), projectConfigDirName, 'agent')
}

/**
 * 获取 Project trust 父路径。
 * @param cwd - Project cwd。
 * @returns 父路径。
 */
function getProjectTrustParentPath(cwd: string): string | undefined {
  const trustPath = normalizePath(cwd)
  const parentDir = dirname(trustPath)
  return parentDir === trustPath ? undefined : parentDir
}

/**
 * 检查 Project 是否存在需要 trust 的本地资源。
 * @param cwd - Project cwd。
 * @returns 是否需要 trust。
 */
function hasTrustRequiringProjectResources(cwd: string): boolean {
  const homeDir = normalizePath(homedir())
  const userAgentsSkillsDir = join(homeDir, '.agents', 'skills')
  let currentDir = normalizePath(cwd)

  const configDir = join(currentDir, projectConfigDirName)
  if (trustRequiringProjectResources.some((entry) => existsSync(join(configDir, entry)))) {
    return true
  }

  while (true) {
    const agentsSkillsDir = join(currentDir, '.agents', 'skills')
    if (agentsSkillsDir !== userAgentsSkillsDir && existsSync(agentsSkillsDir)) {
      return true
    }
    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return false
    }
    currentDir = parentDir
  }
}

/**
 * 标准化路径。
 * @param path - 输入路径。
 * @returns 标准路径。
 */
function normalizePath(path: string): string {
  return resolvePath(path)
}

/**
 * 解析路径，尽力 realpath。
 * @param path - 输入路径。
 * @returns 解析后的路径。
 */
function resolvePath(path: string): string {
  const resolved = resolve(path)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}
