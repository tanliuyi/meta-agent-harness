/**
 * Pi-compatible resource and extension management snapshot.
 *
 * This module is a core adapter: hosts may render the returned data, but resource
 * discovery and extension loading stay in packages/coding-agent.
 */

import { resolve, sep } from 'node:path'
import type { SourceInfo } from './source-info.ts'
import { createSourceInfo } from './source-info.ts'
import { loadExtensions } from './extensions/loader.ts'
import type { ResourceDiagnostic } from './diagnostics.ts'
import {
  DefaultPackageManager,
  type PackageManager,
  type PathMetadata,
  type ResolvedPaths,
  type ResolvedResource
} from './package-manager.ts'
import { SettingsManager } from './settings-manager.ts'

export interface ResourceSnapshotOptions {
  cwd: string
  agentDir: string
  settingsManager?: SettingsManager
  packageManager?: PackageManager
}

export interface ResourcePathSnapshot {
  path: string
  enabled: boolean
  sourceInfo: SourceInfo
}

export interface ExtensionCommandSnapshot {
  name: string
  description?: string
}

export interface ExtensionToolSnapshot {
  name: string
  description?: string
}

export interface ExtensionFlagSnapshot {
  name: string
  description?: string
  type: 'boolean' | 'string'
  default?: boolean | string
}

export interface ExtensionSnapshot {
  path: string
  resolvedPath: string
  enabled: boolean
  sourceInfo: SourceInfo
  commands: ExtensionCommandSnapshot[]
  tools: ExtensionToolSnapshot[]
  flags: ExtensionFlagSnapshot[]
}

export interface ResourcesSnapshot {
  resources: {
    extensions: ResourcePathSnapshot[]
    skills: ResourcePathSnapshot[]
    prompts: ResourcePathSnapshot[]
    themes: ResourcePathSnapshot[]
  }
  extensions: ExtensionSnapshot[]
  diagnostics: ResourceDiagnostic[]
}

/**
 * Build a side-effect-light snapshot for resource management UIs.
 *
 * Missing npm/git package sources are skipped instead of installed. Enabled
 * extension files are loaded through the Pi extension loader so command/tool/flag
 * metadata comes from the same registration API used by AgentSession.
 */
export async function buildResourcesSnapshot(
  options: ResourceSnapshotOptions
): Promise<ResourcesSnapshot> {
  const settingsManager =
    options.settingsManager ??
    SettingsManager.create(options.cwd, options.agentDir, {
      projectTrusted: false
    })
  await settingsManager.reload()
  const packageManager =
    options.packageManager ??
    new DefaultPackageManager({
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager
    })
  const resolvedPaths = await packageManager.resolve(async () => 'skip')
  const metadataByPath = collectMetadata(resolvedPaths)
  const enabledExtensionPaths = resolvedPaths.extensions
    .filter((resource) => resource.enabled)
    .map((resource) => resource.path)
  const extensionResult = await loadExtensions(enabledExtensionPaths, options.cwd)
  const diagnostics: ResourceDiagnostic[] = extensionResult.errors.map((error) => ({
    type: 'error',
    message: error.error,
    path: error.path
  }))

  return {
    resources: {
      extensions: mapResources(resolvedPaths.extensions),
      skills: mapResources(resolvedPaths.skills),
      prompts: mapResources(resolvedPaths.prompts),
      themes: mapResources(resolvedPaths.themes)
    },
    extensions: extensionResult.extensions.map((extension) => {
      const sourceInfo = findSourceInfoForPath(extension.path, metadataByPath)
      return {
        path: extension.path,
        resolvedPath: extension.resolvedPath,
        enabled: true,
        sourceInfo,
        commands: Array.from(extension.commands.values()).map((command) => ({
          name: command.name,
          description: command.description
        })),
        tools: Array.from(extension.tools.values()).map((tool) => ({
          name: tool.definition.name,
          description: tool.definition.description
        })),
        flags: Array.from(extension.flags.values()).map((flag) => ({
          name: flag.name,
          description: flag.description,
          type: flag.type,
          default: flag.default
        }))
      }
    }),
    diagnostics
  }
}

function mapResources(resources: ResolvedResource[]): ResourcePathSnapshot[] {
  return resources.map((resource) => ({
    path: resource.path,
    enabled: resource.enabled,
    sourceInfo: createSourceInfo(resource.path, resource.metadata)
  }))
}

function collectMetadata(resolvedPaths: ResolvedPaths): Map<string, PathMetadata> {
  const metadata = new Map<string, PathMetadata>()
  for (const resource of [
    ...resolvedPaths.extensions,
    ...resolvedPaths.skills,
    ...resolvedPaths.prompts,
    ...resolvedPaths.themes
  ]) {
    metadata.set(resource.path, resource.metadata)
  }
  return metadata
}

function findSourceInfoForPath(
  resourcePath: string,
  metadataByPath: Map<string, PathMetadata>
): SourceInfo {
  const normalizedResourcePath = resolve(resourcePath)
  const exact = metadataByPath.get(resourcePath) ?? metadataByPath.get(normalizedResourcePath)
  if (exact) {
    return createSourceInfo(resourcePath, exact)
  }
  for (const [sourcePath, metadata] of metadataByPath.entries()) {
    const normalizedSourcePath = resolve(sourcePath)
    if (
      normalizedResourcePath === normalizedSourcePath ||
      normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
    ) {
      return createSourceInfo(resourcePath, metadata)
    }
  }
  return {
    path: resourcePath,
    source: 'unknown',
    scope: 'temporary',
    origin: 'top-level'
  }
}
