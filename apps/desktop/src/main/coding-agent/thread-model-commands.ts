/**
 * 本文件实现模型与 thinking level 操作。
 */

import type {
  ModelCycleResult,
  ModelInfo,
  SetModelInput,
  SetThinkingInput
} from '../../shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'

export async function listModels(core: ThreadManagerCore, threadId: string): Promise<ModelInfo[]> {
  const result = await core.sendData<{ models: ModelInfo[] }>(threadId, {
    type: 'get_available_models'
  })
  return result.models
}

export async function setModel(core: ThreadManagerCore, input: SetModelInput): Promise<void> {
  await core.sendOk(input.threadId, {
    type: 'set_model',
    provider: input.provider,
    modelId: input.modelId
  })
}

export async function cycleModel(
  core: ThreadManagerCore,
  threadId: string
): Promise<ModelCycleResult | null> {
  return await core.sendData<ModelCycleResult | null>(threadId, { type: 'cycle_model' })
}

export async function setThinkingLevel(
  core: ThreadManagerCore,
  input: SetThinkingInput
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'set_thinking_level', level: input.level })
}

export async function cycleThinkingLevel(
  core: ThreadManagerCore,
  threadId: string
): Promise<{ level: SetThinkingInput['level'] } | null> {
  return await core.sendData<{ level: SetThinkingInput['level'] } | null>(threadId, {
    type: 'cycle_thinking_level'
  })
}
