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

/**
 * 获取可用模型列表。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 * @returns 模型信息列表。
 */
export async function listModels(core: ThreadManagerCore, threadId: string): Promise<ModelInfo[]> {
  const result = await core.sendData<{ models: ModelInfo[] }>(threadId, {
    type: 'get_available_models'
  })
  return result.models
}

/**
 * 设置当前线程模型。
 * @param core - thread 管理核心。
 * @param input - 模型设置输入。
 */
export async function setModel(core: ThreadManagerCore, input: SetModelInput): Promise<void> {
  await core.sendOk(input.threadId, {
    type: 'set_model',
    provider: input.provider,
    modelId: input.modelId
  })
}

/**
 * 循环切换到下一个模型。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 * @returns 模型切换结果。
 */
export async function cycleModel(
  core: ThreadManagerCore,
  threadId: string
): Promise<ModelCycleResult | null> {
  return await core.sendData<ModelCycleResult | null>(threadId, { type: 'cycle_model' })
}

/**
 * 设置 thinking level。
 * @param core - thread 管理核心。
 * @param input - thinking level 输入。
 */
export async function setThinkingLevel(
  core: ThreadManagerCore,
  input: SetThinkingInput
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'set_thinking_level', level: input.level })
}

/**
 * 循环切换 thinking level。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 * @returns 当前 thinking level。
 */
export async function cycleThinkingLevel(
  core: ThreadManagerCore,
  threadId: string
): Promise<{ level: SetThinkingInput['level'] } | null> {
  return await core.sendData<{ level: SetThinkingInput['level'] } | null>(threadId, {
    type: 'cycle_thinking_level'
  })
}
