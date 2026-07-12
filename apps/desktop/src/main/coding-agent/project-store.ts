/**
 * 本文件实现 Electron main 侧轻量 Project metadata registry。
 */

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { CreateProjectInput, ProjectStatus, ProjectSummary } from '@shared/coding-agent/types'
import { getDesktopAgentDir } from './agent-dir'

/** Project metadata 文件结构。 */
interface ProjectMetadataFile {
  /** schema version。 */
  version: 1
  /** Project 列表。 */
  projects: ProjectSummary[]
}

/** ProjectStore 构造选项。 */
export interface ProjectStoreOptions {
  /** 是否自动保存到文件。 */
  persist?: boolean
}

/** Project registry 的可恢复快照。 */
export interface ProjectStoreSnapshot {
  projects: ProjectSummary[]
}

/**
 * Electron main 侧 Project registry。
 */
export class ProjectStore {
  private readonly metadataPath: string | undefined
  private readonly persist: boolean
  private readonly projects = new Map<string, ProjectSummary>()

  /**
   * 创建 ProjectStore。
   * @param metadataPath - metadata JSON 文件路径；传 ':memory:' 使用内存 registry。
   * @param options - 构造选项。
   */
  constructor(metadataPath = defaultProjectMetadataPath(), options: ProjectStoreOptions = {}) {
    this.metadataPath = metadataPath === ':memory:' ? undefined : metadataPath
    this.persist = options.persist ?? metadataPath !== ':memory:'
    this.load()
  }

  /**
   * 创建 Project。
   * @param input - 创建输入。
   * @returns Project 摘要。
   */
  createProject(input: CreateProjectInput): ProjectSummary {
    const path = resolve(input.path)
    const existing = this.findProjectByPath(path)
    if (existing) {
      const opened = {
        ...existing,
        status: getProjectStatus(path),
        lastOpenedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      this.saveProject(opened)
      return opened
    }
    const now = new Date().toISOString()
    const project: ProjectSummary = {
      projectId: crypto.randomUUID(),
      name: input.name?.trim() || basename(path) || path,
      path,
      status: getProjectStatus(path),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    }
    this.saveProject(project)
    return project
  }

  /**
   * 保存 Project。
   * @param project - Project 摘要。
   */
  saveProject(project: ProjectSummary): void {
    this.projects.set(project.projectId, project)
    this.flush()
  }

  /**
   * 获取 Project。
   * @param projectId - Project ID。
   * @returns Project 或 undefined。
   */
  getProject(projectId: string): ProjectSummary | undefined {
    return this.projects.get(projectId)
  }

  /**
   * 按路径查找 Project。
   * @param path - Project 路径。
   * @returns Project 或 undefined。
   */
  findProjectByPath(path: string): ProjectSummary | undefined {
    const resolved = resolve(path)
    return [...this.projects.values()].find((project) => resolve(project.path) === resolved)
  }

  /**
   * 列出 Projects。
   * @returns Project 列表。
   */
  listProjects(): ProjectSummary[] {
    return [...this.projects.values()]
      .map((project) => ({ ...project, status: getProjectStatus(project.path) }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /**
   * 创建当前 Project registry 快照。
   * @returns 可用于事务回滚的快照。
   */
  createSnapshot(): ProjectStoreSnapshot {
    return {
      projects: [...this.projects.values()].map((project) => ({ ...project }))
    }
  }

  /**
   * 恢复 Project registry 快照，并同步写回 metadata 文件。
   * 即使写盘失败，main 内存也会保持为待恢复状态。
   * @param snapshot - 事务开始前的快照。
   */
  restoreSnapshot(snapshot: ProjectStoreSnapshot): void {
    this.restoreSnapshotInMemory(snapshot)
    this.flush()
  }

  /**
   * 删除 Project metadata，不修改 Project 指向的真实目录。
   * @param projectId - Project ID。
   */
  deleteProject(projectId: string): void {
    this.requireProject(projectId)
    const snapshot = this.createSnapshot()
    this.projects.delete(projectId)
    try {
      this.flush()
    } catch (error) {
      try {
        this.restoreSnapshot(snapshot)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `failed to delete and restore Project metadata: ${projectId}`
        )
      }
      throw error
    }
  }

  /**
   * 更新 Project。
   * @param projectId - Project ID。
   * @param patch - 更新字段。
   */
  updateProject(projectId: string, patch: Partial<ProjectSummary>): void {
    const project = this.requireProject(projectId)
    this.saveProject({ ...project, ...patch, updatedAt: new Date().toISOString() })
  }

  /**
   * 打开 Project。
   * @param projectId - Project ID。
   * @returns 更新后的 Project。
   */
  openProject(projectId: string): ProjectSummary {
    const project = this.requireProject(projectId)
    const opened = {
      ...project,
      status: getProjectStatus(project.path),
      lastOpenedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    this.saveProject(opened)
    return opened
  }

  /**
   * 获取 Project，不存在则抛出错误。
   * @param projectId - Project ID。
   * @returns Project。
   */
  requireProject(projectId: string): ProjectSummary {
    const project = this.getProject(projectId)
    if (!project) {
      throw new Error(`project not found: ${projectId}`)
    }
    return project
  }

  /**
   * 关闭 store。
   */
  close(): void {
    this.flush()
  }

  /** 从 metadata 文件加载。 */
  private load(): void {
    if (!this.metadataPath || !existsSync(this.metadataPath)) {
      return
    }
    const metadata = JSON.parse(readFileSync(this.metadataPath, 'utf8')) as ProjectMetadataFile
    for (const project of metadata.projects ?? []) {
      this.projects.set(project.projectId, project)
    }
  }

  /** 只恢复内存 registry，供 restoreSnapshot 保证失败时的内存一致性。 */
  private restoreSnapshotInMemory(snapshot: ProjectStoreSnapshot): void {
    this.projects.clear()
    for (const project of snapshot.projects) {
      this.projects.set(project.projectId, { ...project })
    }
  }

  /** 写入 metadata 文件。 */
  private flush(): void {
    if (!this.persist || !this.metadataPath) {
      return
    }
    mkdirSync(dirname(this.metadataPath), { recursive: true })
    const metadata: ProjectMetadataFile = {
      version: 1,
      projects: [...this.projects.values()]
    }
    writeFileSync(this.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  }
}

/**
 * 获取 Project 路径状态。
 * @param path - Project 路径。
 * @returns Project 状态。
 */
export function getProjectStatus(path: string): ProjectStatus {
  try {
    const stat = statSync(path)
    if (!stat.isDirectory()) {
      return 'invalid'
    }
    accessSync(path, constants.R_OK | constants.W_OK)
    return 'available'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return 'missing'
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return 'permissionDenied'
    }
    return 'invalid'
  }
}

function defaultProjectMetadataPath(): string {
  return join(getDesktopAgentDir(), 'projects.json')
}
