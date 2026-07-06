/**
 * 本文件根据 Desktop runtime 配置创建 coding agent worker client。
 */

import type { WorkerClient } from './worker-types'
import { readDesktopRuntimeConfig, type DesktopRuntimeConfig } from './desktop-runtime-config'
import { createNodeSidecarWorkerClient } from './node-sidecar-worker-client-factory'
import { createUtilityProcessWorkerClient } from './utility-process-worker-client-factory'

/** 配置驱动 worker client 工厂选项。 */
export interface ConfiguredWorkerClientFactoryOptions {
  /** 读取 Desktop runtime 配置，用于测试注入。 */
  readConfig?: () => DesktopRuntimeConfig
}

/**
 * 创建配置驱动的 worker client。
 * @param options - 工厂选项。
 * @returns worker client。
 */
export async function createConfiguredWorkerClient(
  options: ConfiguredWorkerClientFactoryOptions = {}
): Promise<WorkerClient> {
  const config = options.readConfig?.() ?? readDesktopRuntimeConfig()
  if (config.workerMode === 'nodeSidecar') {
    return createNodeSidecarWorkerClient({
      nodeExecPath: config.nodeSidecarExecPath
    })
  }
  return createUtilityProcessWorkerClient()
}
