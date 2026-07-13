/**
 * 为 Desktop metadata 提供原子 JSON 写入和上一份有效快照恢复。
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type JsonValidator<T> = (value: unknown) => value is T

export interface RecoverableJsonFileIo {
  exists(path: string): boolean
  read(path: string): string
  writeAtomically(path: string, content: string): void
}

const defaultIo: RecoverableJsonFileIo = {
  exists: existsSync,
  read: (path) => readFileSync(path, 'utf8'),
  writeAtomically: writeTextFileAtomically
}

/** 表示文件可读取，但其 JSON 或 metadata schema 已损坏。 */
export class RecoverableJsonCorruptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RecoverableJsonCorruptionError'
  }
}

/** 原子写入同卷文本文件，失败时保留原目标文件。 */
export function writeTextFileAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, content, 'utf8')
    renameSync(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

/** 读取 metadata；主文件无效时使用上一份有效快照恢复。 */
export function readRecoverableJsonFile<T>(
  path: string,
  validate: JsonValidator<T>,
  io: RecoverableJsonFileIo = defaultIo
): T {
  const backupPath = getBackupPath(path)
  let current: T
  try {
    current = readValidatedJson(path, validate, io)
  } catch (currentError) {
    if (!shouldRecoverFromBackup(currentError)) {
      throw currentError
    }
    try {
      const backupContent = io.read(backupPath)
      const backup = parseValidatedJson(backupContent, backupPath, validate)
      io.writeAtomically(path, backupContent)
      return backup
    } catch (backupError) {
      throw new AggregateError(
        [currentError, backupError],
        `failed to read metadata and recovery snapshot: ${path}`
      )
    }
  }
  if (!io.exists(backupPath)) {
    io.writeAtomically(backupPath, io.read(path))
  }
  return current
}

/** 原子写入 metadata，并在覆盖前保存上一份有效内容。 */
export function writeRecoverableJsonFile<T>(
  path: string,
  value: T,
  validate: JsonValidator<T>
): void {
  if (!validate(value)) {
    throw new Error(`invalid metadata schema: ${path}`)
  }
  const content = `${JSON.stringify(value, null, 2)}\n`
  const backupPath = getBackupPath(path)
  if (existsSync(path)) {
    const previousContent = readFileSync(path, 'utf8')
    parseValidatedJson(previousContent, path, validate)
    writeTextFileAtomically(backupPath, previousContent)
  }
  writeTextFileAtomically(path, content)
  if (!existsSync(backupPath)) {
    writeTextFileAtomically(backupPath, content)
  }
}

function readValidatedJson<T>(
  path: string,
  validate: JsonValidator<T>,
  io: RecoverableJsonFileIo
): T {
  return parseValidatedJson(io.read(path), path, validate)
}

function parseValidatedJson<T>(content: string, path: string, validate: JsonValidator<T>): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch (cause) {
    throw new RecoverableJsonCorruptionError(`invalid metadata JSON: ${path}`, { cause })
  }
  if (!validate(parsed)) {
    throw new RecoverableJsonCorruptionError(`invalid metadata schema: ${path}`)
  }
  return parsed
}

function shouldRecoverFromBackup(error: unknown): boolean {
  return (
    error instanceof RecoverableJsonCorruptionError ||
    (isNodeError(error) && error.code === 'ENOENT')
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function getBackupPath(path: string): string {
  return `${path}.bak`
}
