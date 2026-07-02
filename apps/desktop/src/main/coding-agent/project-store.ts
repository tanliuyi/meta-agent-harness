/**
 * 本文件实现 Electron main 侧 Project registry。
 */

import { accessSync, constants, mkdirSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  CreateProjectInput,
  ProjectStatus,
  ProjectSummary
} from '@shared/coding-agent/types'

/** 数据库 projects 表行。 */
interface ProjectRow {
  /** Project 摘要 JSON 字符串。 */
  summary_json: string
}

/** ProjectStore 构造选项。 */
export interface ProjectStoreOptions {
  /** 是否拥有数据库连接；拥有时 close 会关闭连接。 */
  ownsDb?: boolean
}

/**
 * Electron main 侧 Project registry。
 */
export class ProjectStore {
  private readonly db: DatabaseSync
  private readonly ownsDb: boolean

  /**
   * 创建 ProjectStore。
   * @param dbOrPath - SQLite 数据库连接或路径。
   * @param options - 构造选项。
   */
  constructor(dbOrPath: DatabaseSync | string, options: ProjectStoreOptions = {}) {
    if (typeof dbOrPath === 'string') {
      if (dbOrPath !== ':memory:') {
        mkdirSync(dirname(dbOrPath), { recursive: true })
      }
      this.db = new DatabaseSync(dbOrPath)
      this.ownsDb = options.ownsDb ?? true
    } else {
      this.db = dbOrPath
      this.ownsDb = options.ownsDb ?? false
    }
    this.migrate()
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
    this.db
      .prepare(
        `insert into projects(
           project_id,
           name,
           path,
           status,
           archived_at,
           created_at,
           updated_at,
           last_opened_at,
           summary_json
         )
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(project_id) do update set
           name = excluded.name,
           path = excluded.path,
           status = excluded.status,
           archived_at = excluded.archived_at,
           updated_at = excluded.updated_at,
           last_opened_at = excluded.last_opened_at,
           summary_json = excluded.summary_json`
      )
      .run(
        project.projectId,
        project.name,
        project.path,
        project.status,
        null,
        project.createdAt,
        project.updatedAt,
        project.lastOpenedAt ?? null,
        JSON.stringify(project)
      )
  }

  /**
   * 获取 Project。
   * @param projectId - Project ID。
   * @returns Project 或 undefined。
   */
  getProject(projectId: string): ProjectSummary | undefined {
    const row = this.db
      .prepare('select summary_json from projects where project_id = ?')
      .get(projectId) as ProjectRow | undefined
    return row ? (JSON.parse(row.summary_json) as ProjectSummary) : undefined
  }

  /**
   * 按路径查找 Project。
   * @param path - Project 路径。
   * @returns Project 或 undefined。
   */
  findProjectByPath(path: string): ProjectSummary | undefined {
    const row = this.db
      .prepare('select summary_json from projects where path = ?')
      .get(resolve(path)) as ProjectRow | undefined
    return row ? (JSON.parse(row.summary_json) as ProjectSummary) : undefined
  }

  /**
   * 列出 Projects。
   * @returns Project 列表。
   */
  listProjects(): ProjectSummary[] {
    const rows = this.db
      .prepare('select summary_json from projects order by updated_at desc')
      .all() as unknown as ProjectRow[]
    return rows.map((row) => JSON.parse(row.summary_json) as ProjectSummary)
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
   * 关闭数据库连接。
   */
  close(): void {
    if (this.ownsDb) {
      this.db.close()
    }
  }

  /**
   * 初始化 Project schema。
   */
  private migrate(): void {
    this.db.exec(`
      create table if not exists schema_meta (
        key text primary key,
        value text not null
      );
      create table if not exists projects (
        project_id text primary key,
        name text not null,
        path text not null unique,
        status text not null,
        archived_at text,
        created_at text not null,
        updated_at text not null,
        last_opened_at text,
        summary_json text not null
      );
      insert into schema_meta(key, value)
        values ('desktop_schema_version', '2')
        on conflict(key) do update set value = excluded.value;
    `)
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
