import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  disposeMetadata: vi.fn(),
  failIpcImport: false,
  ipcMain: {
    on: vi.fn(),
    removeHandler: vi.fn()
  },
  registerCodingAgentIpc: vi.fn(),
  registerLightweightMetadataIpc: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }))
vi.mock('../deferred/metadata-ipc', () => ({
  registerLightweightMetadataIpc: mocks.registerLightweightMetadataIpc
}))
vi.mock('../ipc', () => {
  return Object.defineProperty({}, 'registerCodingAgentIpc', {
    enumerable: true,
    get: () => {
      if (mocks.failIpcImport) {
        throw new Error('ipc module import failed')
      }
      return mocks.registerCodingAgentIpc
    }
  })
})

describe('deferred coding-agent IPC', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()
    mocks.failIpcImport = false
    mocks.registerLightweightMetadataIpc.mockReturnValue({ dispose: mocks.disposeMetadata })
  })

  it('完整 IPC 首次注册失败后回滚 handlers、恢复 metadata 并重试', async () => {
    const manager = { marker: 'manager' }
    mocks.registerCodingAgentIpc
      .mockImplementationOnce(() => {
        throw new Error('partial registration')
      })
      .mockReturnValueOnce(manager)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getLoadedCodingAgentManager, registerDeferredCodingAgentIpc } =
      await import('../deferred-ipc')

    registerDeferredCodingAgentIpc()
    await vi.advanceTimersByTimeAsync(750)

    expect(mocks.registerCodingAgentIpc).toHaveBeenCalledTimes(1)
    expect(mocks.ipcMain.removeHandler).toHaveBeenCalled()
    expect(mocks.registerLightweightMetadataIpc).toHaveBeenCalledTimes(2)
    expect(mocks.disposeMetadata).toHaveBeenCalledTimes(1)
    expect(getLoadedCodingAgentManager()).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.registerCodingAgentIpc).toHaveBeenCalledTimes(2)
    await expect(getLoadedCodingAgentManager()).resolves.toBe(manager)
    expect(mocks.disposeMetadata).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to register coding-agent IPC handlers',
      expect.any(Error)
    )
  })

  it('IPC 模块 import 失败时也重建 metadata registration', async () => {
    const manager = { marker: 'manager' }
    mocks.failIpcImport = true
    mocks.registerCodingAgentIpc.mockReturnValue(manager)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getLoadedCodingAgentManager, registerDeferredCodingAgentIpc } =
      await import('../deferred-ipc')

    registerDeferredCodingAgentIpc()
    await vi.advanceTimersByTimeAsync(750)

    expect(mocks.disposeMetadata).toHaveBeenCalledTimes(1)
    expect(mocks.registerLightweightMetadataIpc).toHaveBeenCalledTimes(2)
    expect(getLoadedCodingAgentManager()).toBeUndefined()

    mocks.failIpcImport = false
    await vi.advanceTimersByTimeAsync(1000)

    await expect(getLoadedCodingAgentManager()).resolves.toBe(manager)
  })
})
