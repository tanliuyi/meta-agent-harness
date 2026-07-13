/**
 * 本文件把 project trust 规则包装为 desktop Project 级产品状态。
 */

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getProjectTrustParentPath,
  hasTrustRequiringProjectResources,
  ProjectTrustStore
} from '@coding-agent-src/core/trust-manager'
import type {
  ProjectSummary,
  ProjectTrustDecision,
  ProjectTrustSummary
} from '@shared/coding-agent/types'
import { getDesktopAgentDir } from './agent-dir'

/**
 * Desktop Project trust 服务。
 */
export class ProjectTrustService {
  private readonly trustStore: ProjectTrustStore
  private readonly sessionDecisions = new Map<string, boolean>()

  /**
   * 创建 ProjectTrustService。
   * @param agentDir - agent 目录。
   */
  constructor(agentDir = getDesktopAgentDir()) {
    this.trustStore = new ProjectTrustStore(agentDir)
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
        this.trustStore.set(project.path, true)
        return
      case 'trustParent': {
        const parentPath = getProjectTrustParentPath(project.path)
        if (!parentPath) {
          this.trustStore.set(project.path, true)
          return
        }
        this.sessionDecisions.delete(normalizePath(project.path))
        this.trustStore.setMany([
          { path: parentPath, decision: true },
          { path: project.path, decision: null }
        ])
        return
      }
      case 'trustSession':
        this.sessionDecisions.set(normalizePath(project.path), true)
        return
      case 'doNotTrust':
        this.sessionDecisions.delete(normalizePath(project.path))
        this.trustStore.set(project.path, false)
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
  private getSavedTrust(cwd: string): { path: string; decision: boolean } | undefined {
    return this.trustStore.getEntry(cwd) ?? undefined
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
