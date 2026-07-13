/**
 * Prompt 图片在 renderer、preload 与 main 之间共享的硬限制。
 */

import type { PromptImage, PromptImageFile } from './types'

export const MAX_PROMPT_IMAGE_COUNT = 10
export const MAX_PROMPT_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_PROMPT_IMAGE_TOTAL_BYTES = 50 * 1024 * 1024

type PromptImagePayload = {
  images?: unknown
  imageFiles?: unknown
}

/** 在 IPC 前后校验图片数量、单图大小和总大小。 */
export function assertPromptImagePayload(input: PromptImagePayload): void {
  const images = parseArray(input.images, 'images')
  const imageFiles = parseArray(input.imageFiles, 'imageFiles')
  assertPromptImageCount(images.length + imageFiles.length)

  let totalBytes = 0
  for (const image of images) {
    totalBytes += getPromptImageBytes(image)
    assertPromptImageTotalBytes(totalBytes)
  }
  for (const file of imageFiles) {
    const imageFile = parsePromptImageFile(file)
    if (imageFile.inlineFallback) {
      totalBytes += getPromptImageBytes(imageFile.inlineFallback)
      assertPromptImageTotalBytes(totalBytes)
    }
  }
}

/** 校验已经解析完成、即将发送给 worker 的图片。 */
export function assertResolvedPromptImages(images: readonly PromptImage[]): void {
  assertPromptImageCount(images.length)
  let totalBytes = 0
  for (const image of images) {
    totalBytes += getPromptImageBytes(image)
    assertPromptImageTotalBytes(totalBytes)
  }
}

export function assertPromptImageCount(count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > MAX_PROMPT_IMAGE_COUNT) {
    throw new Error(`一次最多添加 ${MAX_PROMPT_IMAGE_COUNT} 张图片`)
  }
}

export function assertPromptImageBytes(bytes: number, name = '图片'): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_PROMPT_IMAGE_BYTES) {
    throw new Error(`${name} 超过单张图片大小限制`)
  }
}

export function assertPromptImageTotalBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_PROMPT_IMAGE_TOTAL_BYTES) {
    throw new Error('图片总大小超过限制')
  }
}

function parseArray(value: unknown, label: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`)
  return value
}

function parsePromptImageFile(value: unknown): PromptImageFile {
  if (!isRecord(value) || typeof value.path !== 'string' || !value.path.trim()) {
    throw new Error('图片文件参数无效')
  }
  if (value.path.length > 32_768) {
    throw new Error('图片文件路径过长')
  }
  if (value.inlineFallback !== undefined) {
    getPromptImageBytes(value.inlineFallback)
  }
  return value as unknown as PromptImageFile
}

function getPromptImageBytes(value: unknown): number {
  if (
    !isRecord(value) ||
    value.type !== 'image' ||
    typeof value.mimeType !== 'string' ||
    !value.mimeType.startsWith('image/') ||
    value.mimeType.length > 128 ||
    typeof value.data !== 'string'
  ) {
    throw new Error('图片数据格式无效')
  }
  const bytes = getBase64DecodedByteLength(value.data)
  assertPromptImageBytes(bytes)
  return bytes
}

function getBase64DecodedByteLength(value: string): number {
  const maxEncodedLength = Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4
  if (
    value.length === 0 ||
    value.length > maxEncodedLength ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error('图片数据不是有效的 base64')
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
