/**
 * metadata-reader.ts - 首屏 metadata IPC 使用的只读 JSON reader。
 */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ListThreadsInput,
  ProjectStatus,
  ProjectSummary,
  ThreadStatus,
  ThreadSummary
} from '@shared/coding-agent/types'
import { getDesktopAgentDir } from '../agent-dir'

interface ProjectMetadataFile {
  version: 1
  projects?: ProjectSummary[]
}

interface ThreadMetadataFile {
  version: 1
  threads?: ThreadSummary[]
}

export interface ProjectMetadataReaderOptions {
  metadataPath?: string
}

export interface ThreadMetadataReaderOptions {
  metadataPath?: string
}

export function createLightweightProjectMetadataStore(options: ProjectMetadataReaderOptions = {}): {
  listProjects: () => ProjectSummary[]
  close: () => void
} {
  const metadataPath = options.metadataPath ?? getProjectMetadataPath()
  return {
    listProjects: () => readProjects(metadataPath),
    close: () => undefined
  }
}

export function createLightweightThreadMetadataStore(options: ThreadMetadataReaderOptions = {}): {
  listThreads: (input?: ListThreadsInput) => ThreadSummary[]
  close: () => void
} {
  const metadataPath = options.metadataPath ?? getThreadMetadataPath()
  return {
    listThreads: (input) => readThreads(metadataPath, input),
    close: () => undefined
  }
}

function readProjects(metadataPath: string): ProjectSummary[] {
  if (!existsSync(metadataPath)) {
    return []
  }
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as ProjectMetadataFile
  return (metadata.projects ?? [])
    .map((project) => ({ ...project, status: getProjectStatus(project.path) }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function readThreads(metadataPath: string, input: ListThreadsInput = {}): ThreadSummary[] {
  if (!existsSync(metadataPath)) {
    return []
  }
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as ThreadMetadataFile
  const includeArchived = input.archived === true
  return (metadata.threads ?? [])
    .map(normalizeInactiveThread)
    .filter((thread) => !input.projectId || thread.projectId === input.projectId)
    .filter((thread) => Boolean(thread.archivedAt) === includeArchived)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function normalizeInactiveThread(thread: ThreadSummary): ThreadSummary {
  if (isTransientThreadStatus(thread.status)) {
    return { ...thread, status: 'idle' }
  }
  return thread
}

function isTransientThreadStatus(status: ThreadStatus): boolean {
  return (
    status === 'running' || status === 'starting' || status === 'stopping' || status === 'error'
  )
}

function getProjectStatus(path: string): ProjectStatus {
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

function getProjectMetadataPath(): string {
  return join(getLightweightAgentDir(), 'projects.json')
}

function getThreadMetadataPath(): string {
  return join(getLightweightAgentDir(), 'threads.json')
}

function getLightweightAgentDir(): string {
  return getDesktopAgentDir()
}
