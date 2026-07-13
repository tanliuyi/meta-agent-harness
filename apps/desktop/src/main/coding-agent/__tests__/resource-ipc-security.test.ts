/**
 * 验证 renderer 资源打开与图片处理的 main 安全边界。
 */

import { mkdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  shell: {
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    openExternal: vi.fn(async () => undefined)
  }
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), once: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: electron.shell
}))

import {
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_IMAGE_COUNT,
  ResourcePathCapabilityStore,
  processPromptImageFiles,
  revealResourcePath,
  stagePromptImages
} from '../ipc'

const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('resource IPC security', () => {
  it('只允许 main capability 打开资源路径', async () => {
    electron.shell.openPath.mockClear()
    electron.shell.showItemInFolder.mockClear()
    const capabilities = new ResourcePathCapabilityStore()
    const root = join(tmpdir(), `desktop-resource-capability-${crypto.randomUUID()}`)
    const path = join(root, 'export.html')
    const executablePath = join(root, 'payload.exe')
    mkdirSync(root, { recursive: true })
    writeFileSync(path, '<!doctype html>')
    writeFileSync(executablePath, 'MZ')
    const capability = capabilities.issue(path)

    await expect(
      revealResourcePath(
        { path, mode: 'open' } as unknown as Parameters<typeof revealResourcePath>[0],
        capabilities
      )
    ).rejects.toThrow('capability')
    expect(electron.shell.openPath).not.toHaveBeenCalled()

    await revealResourcePath({ capability, mode: 'open' }, capabilities)
    expect(electron.shell.openPath).toHaveBeenCalledWith(path)

    await expect(
      revealResourcePath(
        { capability: capabilities.issue(executablePath), mode: 'open' },
        capabilities
      )
    ).rejects.toThrow('HTML')
    expect(electron.shell.openPath).toHaveBeenCalledTimes(1)

    await revealResourcePath({ path: root, mode: 'reveal' }, capabilities)
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(root)
    expect(electron.shell.openPath).toHaveBeenCalledTimes(1)

    await expect(
      revealResourcePath({ path: '\\\\server\\share\\file.txt', mode: 'reveal' }, capabilities)
    ).rejects.toThrow('网络或设备路径')
    expect(electron.shell.showItemInFolder).toHaveBeenCalledTimes(1)

    await revealResourcePath({ path: executablePath, mode: 'open' }, capabilities, 'full')
    expect(electron.shell.openPath).toHaveBeenCalledWith(executablePath)
    await revealResourcePath(
      { path: '\\\\server\\share\\file.txt', mode: 'reveal' },
      capabilities,
      'full'
    )
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith('\\\\server\\share\\file.txt')
    await revealResourcePath({ path: root, mode: 'reveal' }, capabilities, 'full')
    expect(electron.shell.openPath).toHaveBeenCalledWith(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('粘贴图片校验真实内容并保持 inline，不创建临时路径', async () => {
    const size = Buffer.from(onePixelPng, 'base64').length

    const [attachment] = await stagePromptImages([
      {
        type: 'image',
        data: onePixelPng,
        mimeType: 'image/png',
        name: 'pixel.png',
        size
      }
    ])

    expect(attachment).toMatchObject({ mimeType: 'image/png', name: 'pixel.png', size })
    expect(attachment?.path).toBeUndefined()
  })

  it('拒绝图片数量、声明大小和单文件大小越界', async () => {
    const bytes = Buffer.from(onePixelPng, 'base64')
    const draft = {
      type: 'image' as const,
      data: onePixelPng,
      mimeType: 'image/png',
      name: 'pixel.png',
      size: bytes.length
    }
    await expect(stagePromptImages(Array(MAX_PROMPT_IMAGE_COUNT + 1).fill(draft))).rejects.toThrow(
      '最多添加'
    )
    await expect(stagePromptImages([{ ...draft, size: bytes.length + 1 }])).rejects.toThrow(
      '声明大小'
    )

    const root = join(tmpdir(), `desktop-image-limit-${crypto.randomUUID()}`)
    const largeImage = join(root, 'large.png')
    mkdirSync(root, { recursive: true })
    writeFileSync(largeImage, '')
    truncateSync(largeImage, MAX_PROMPT_IMAGE_BYTES + 1)
    await expect(processPromptImageFiles([largeImage])).rejects.toThrow('单张图片大小限制')
    rmSync(root, { recursive: true, force: true })
  })
})
