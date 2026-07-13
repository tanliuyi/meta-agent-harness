/**
 * 本文件测试配置驱动的 worker client 工厂。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfiguredWorkerClient } from '../worker-client-factory'

const nodeSidecarFactoryMock = vi.hoisted(() => vi.fn())
const utilityFactoryMock = vi.hoisted(() => vi.fn())

vi.mock('../node-sidecar-worker-client-factory', () => ({
  createNodeSidecarWorkerClient: nodeSidecarFactoryMock
}))

vi.mock('../utility-process-worker-client-factory', () => ({
  createUtilityProcessWorkerClient: utilityFactoryMock
}))

describe('createConfiguredWorkerClient', () => {
  afterEach(() => {
    nodeSidecarFactoryMock.mockReset()
    utilityFactoryMock.mockReset()
  })

  it('workerMode 为 nodeSidecar 时创建普通 Node sidecar worker', async () => {
    const client = { workerId: 'node-sidecar-worker' }
    nodeSidecarFactoryMock.mockResolvedValue(client)

    await expect(
      createConfiguredWorkerClient({
        readConfig: () => ({
          workerMode: 'nodeSidecar',
          nodeSidecarExecPath: '/opt/node/bin/node',
          browserCdpAccess: 'safe',
          browserWebPermissions: 'prompt',
          filesystemAccess: 'safe',
          extensionUrlAccess: 'safe',
          externalProtocolAccess: 'safe'
        })
      })
    ).resolves.toBe(client)

    expect(nodeSidecarFactoryMock).toHaveBeenCalledWith({
      nodeExecPath: '/opt/node/bin/node'
    })
    expect(utilityFactoryMock).not.toHaveBeenCalled()
  })

  it('workerMode 为 utilityProcess 时创建 Electron utility worker', async () => {
    const client = { workerId: 'utility-worker' }
    utilityFactoryMock.mockResolvedValue(client)

    await expect(
      createConfiguredWorkerClient({
        readConfig: () => ({
          workerMode: 'utilityProcess',
          browserCdpAccess: 'safe',
          browserWebPermissions: 'prompt',
          filesystemAccess: 'safe',
          extensionUrlAccess: 'safe',
          externalProtocolAccess: 'safe'
        })
      })
    ).resolves.toBe(client)

    expect(utilityFactoryMock).toHaveBeenCalledWith()
    expect(nodeSidecarFactoryMock).not.toHaveBeenCalled()
  })
})
