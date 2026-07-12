/** /memory-switch-project selects the active project memory for this extension session. */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { MemoryConfig } from '../types.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { resolveProjectsRoot } from '../paths.js'

export interface SwitchProjectCommandOptions {
  getActiveProject?: () => string | null
  switchProject?: (id: string) => Promise<unknown>
}

export function registerSwitchProjectCommand(
  pi: ExtensionAPI,
  config?: MemoryConfig,
  options: SwitchProjectCommandOptions = {}
): void {
  const projectsMemoryDir = config?.projectsMemoryDir ?? 'projects-memory'
  pi.registerCommand('memory-switch-project', {
    description: 'Select and switch the active project memory for this session',

    async handler(_args, ctx) {
      const projectsDir = resolveProjectsRoot(projectsMemoryDir)
      const projects: Array<{ id: string; count: number }> = []
      try {
        const entries = await fs.readdir(projectsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          try {
            const raw = await fs.readFile(path.join(projectsDir, entry.name, 'MEMORY.md'), 'utf-8')
            projects.push({ id: entry.name, count: raw.split('\n§\n').filter(Boolean).length })
          } catch {
            // Directories without MEMORY.md are not selectable project memories.
          }
        }
      } catch {
        // Missing projects root is equivalent to no project memories.
      }

      if (projects.length === 0) {
        ctx.ui.notify('No project memories found.', 'info')
        return
      }

      projects.sort((a, b) => a.id.localeCompare(b.id))
      const active = options.getActiveProject?.()
      const labels = new Map<string, string>()
      for (const project of projects) {
        const label = `${project.id} (${project.count} ${project.count === 1 ? 'entry' : 'entries'})${project.id === active ? ' - active' : ''}`
        labels.set(label, project.id)
      }
      const selected = await ctx.ui.select('Select active project memory', [...labels.keys()])
      if (!selected) return
      const id = labels.get(selected)
      if (!id || !options.switchProject) return

      try {
        await options.switchProject(id)
        ctx.ui.notify(`Active project memory switched to ${id} for this session.`, 'info')
      } catch (error) {
        ctx.ui.notify(
          `Unable to switch project memory: ${error instanceof Error ? error.message : String(error)}`,
          'error'
        )
      }
    }
  })
}
