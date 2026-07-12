/** Desktop-owned coding-agent runtime with first-party extensions. */

import type { StartThreadInput } from '@coding-agent-desktop-src/protocol/thread'
import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import hermesMemoryExtension from '@meta-agent/hermes-memory'
import browserPreviewExtension from './browser-preview-extension'
import {
  createRuntimeForThread,
  type DesktopRuntimeFactoryOptions
} from '@coding-agent-desktop-src/worker/runtime-factory'

/** Create a thread runtime with Desktop's built-in extension set. */
export function createBuiltinRuntimeForThread(
  input: StartThreadInput,
  options: DesktopRuntimeFactoryOptions = {}
): Promise<AgentSessionRuntime> {
  return createRuntimeForThread(input, {
    ...options,
    extensionFactories: [
      hermesMemoryExtension,
      browserPreviewExtension,
      ...(options.extensionFactories ?? [])
    ],
    replacedExtensionPackages: ['pi-hermes-memory', ...(options.replacedExtensionPackages ?? [])],
    syncProcessCwd: true
  })
}
