/**
 * Project detection — determines whether the current working directory
 * represents a project and resolves its name.
 */

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { resolveProjectsRoot } from './paths.js'

export interface ProjectInfo {
  /** Human-readable project name (directory basename), or null if not in a project. */
  name: string | null
  /** Stable storage identity derived from the canonical absolute cwd. */
  id: string | null
  /** Path to the project-scoped memory directory, or null. */
  memoryDir: string | null
}

export interface ProjectSkillInfo extends ProjectInfo {
  /** Path to the project-scoped skills directory, or null. */
  skillsDir: string | null
}

/**
 * Detect project from the current working directory.
 *
 * A "project" is any directory that is not the user's home directory.
 * The project name is the directory's basename. Storage uses that display name
 * plus a hash of the canonical absolute path so same-named repositories remain isolated.
 */
export function detectProject(projectsMemoryDir = 'projects-memory', cwd?: string): ProjectInfo {
  const dir = cwd ?? process.cwd()
  const homeDir = os.homedir()

  // Normalize paths for comparison
  const resolved = path.resolve(dir)
  const resolvedHome = path.resolve(homeDir)

  if (
    resolved === resolvedHome ||
    resolved === '/' ||
    !resolved ||
    resolved === resolvedHome + '/'
  ) {
    return { name: null, id: null, memoryDir: null }
  }

  const name = path.basename(resolved)
  if (!name || name === '.' || name === '..') {
    return { name: null, id: null, memoryDir: null }
  }

  let canonicalPath = resolved
  try {
    canonicalPath = fs.realpathSync.native(resolved)
  } catch {
    // Keep the resolved input when the cwd disappears during session recovery.
  }
  if (process.platform === 'win32') canonicalPath = canonicalPath.toLowerCase()

  const safeName = name.replace(/[^A-Za-z0-9._-]+/g, '-') || 'project'
  const digest = createHash('sha256').update(canonicalPath).digest('hex').slice(0, 12)
  const id = `${safeName}-${digest}`

  return {
    name,
    id,
    memoryDir: path.join(resolveProjectsRoot(projectsMemoryDir), id)
  }
}

export function migrateLegacyBasenameProjectDirectory(
  project: ProjectInfo,
  projectsMemoryDir = 'projects-memory'
): boolean {
  if (!project.name || !project.id || !project.memoryDir) return false
  const legacyDir = path.join(resolveProjectsRoot(projectsMemoryDir), project.name)
  if (path.resolve(legacyDir) === path.resolve(project.memoryDir)) return false
  if (!fs.existsSync(legacyDir) || fs.existsSync(project.memoryDir)) return false

  try {
    fs.mkdirSync(path.dirname(project.memoryDir), { recursive: true })
    fs.renameSync(legacyDir, project.memoryDir)
    return true
  } catch {
    return false
  }
}

export function detectProjectSkills(
  projectsMemoryDir = 'projects-memory',
  cwd?: string
): ProjectSkillInfo {
  const project = detectProject(projectsMemoryDir, cwd)
  return {
    ...project,
    skillsDir: project.memoryDir ? path.join(project.memoryDir, 'skills') : null
  }
}
