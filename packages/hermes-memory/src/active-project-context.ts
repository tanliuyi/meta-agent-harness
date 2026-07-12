import * as path from 'node:path'
import type { MemoryStore } from './store/memory-store.js'
import {
  detectProject,
  migrateLegacyBasenameProjectDirectory,
  type ProjectInfo
} from './project.js'
import { resolveProjectsRoot } from './paths.js'

export interface ActiveProjectSnapshot {
  info: ProjectInfo
  store: MemoryStore | null
  cwd: string | null
}

export interface ActiveProjectProvider {
  get(): ActiveProjectSnapshot
  activateCwd(cwd: string): Promise<ActiveProjectSnapshot>
  activateStoredProject(id: string): Promise<ActiveProjectSnapshot>
}

type ActiveProjectContextOptions = {
  projectsMemoryDir?: string
  createStore: (info: ProjectInfo, cwd: string | null) => MemoryStore
  onActivate?: (snapshot: ActiveProjectSnapshot) => void | Promise<void>
}

const EMPTY_PROJECT: ProjectInfo = { name: null, id: null, memoryDir: null }

export class ActiveProjectContext implements ActiveProjectProvider {
  private snapshot: ActiveProjectSnapshot = { info: EMPTY_PROJECT, store: null, cwd: null }
  private activation = Promise.resolve()

  constructor(private readonly options: ActiveProjectContextOptions) {}

  get(): ActiveProjectSnapshot {
    return this.snapshot
  }

  activateCwd(cwd: string): Promise<ActiveProjectSnapshot> {
    return this.enqueue(async () => {
      const info = detectProject(this.options.projectsMemoryDir, cwd)
      migrateLegacyBasenameProjectDirectory(info, this.options.projectsMemoryDir)
      return this.activate(info, info.memoryDir ? path.resolve(cwd) : null)
    })
  }

  activateStoredProject(id: string): Promise<ActiveProjectSnapshot> {
    return this.enqueue(async () => {
      const projectsRoot = path.resolve(
        resolveProjectsRoot(this.options.projectsMemoryDir ?? 'projects-memory')
      )
      const memoryDir = path.resolve(projectsRoot, id)
      const relative = path.relative(projectsRoot, memoryDir)
      if (!id || relative !== id || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid project memory id')
      }
      return this.activate({ name: id, id, memoryDir }, null)
    })
  }

  private enqueue(operation: () => Promise<ActiveProjectSnapshot>): Promise<ActiveProjectSnapshot> {
    const next = this.activation.then(operation, operation)
    this.activation = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async activate(info: ProjectInfo, cwd: string | null): Promise<ActiveProjectSnapshot> {
    const store = info.memoryDir ? this.options.createStore(info, cwd) : null
    if (store) await store.loadFromDisk()
    const next = { info, store, cwd }
    await this.options.onActivate?.(next)
    this.snapshot = next
    return next
  }
}
