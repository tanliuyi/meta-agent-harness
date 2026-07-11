export interface StableMarkdownNodes<T> {
  nodes: T[]
  fingerprints: Array<string | undefined>
}

export interface StabilizeMarkdownNodesOptions {
  stablePrefixLength?: number
}

export interface StableMarkdownNodeChunk<T> {
  key: number
  nodes: T[]
}

export interface VirtualMarkdownChunkRow<T, V extends { index: number }> {
  chunk: StableMarkdownNodeChunk<T>
  virtualItem: V
}

export function createVirtualMarkdownChunkRows<T, V extends { index: number }>(
  virtualItems: V[],
  chunks: StableMarkdownNodeChunk<T>[]
): VirtualMarkdownChunkRow<T, V>[] {
  const rows: VirtualMarkdownChunkRow<T, V>[] = []
  for (const virtualItem of virtualItems) {
    const chunk = chunks[virtualItem.index]
    if (chunk) {
      rows.push({ chunk, virtualItem })
    }
  }
  return rows
}

const REFERENCE_DEFINITION_PATTERN = /(?:^|\n)[\t ]{0,3}\[[^\]\n]+\]:/

function fingerprintMarkdownNode(node: unknown): string | undefined {
  try {
    return JSON.stringify(node)
  } catch {
    return undefined
  }
}

export function canReuseMarkdownAppendPrefix(previousSource: string, nextSource: string): boolean {
  if (!nextSource.startsWith(previousSource)) {
    return false
  }
  const previousLineStart = previousSource.lastIndexOf('\n') + 1
  return !REFERENCE_DEFINITION_PATTERN.test(nextSource.slice(previousLineStart))
}

export function stabilizeMarkdownNodeChunks<T>(
  nodes: T[],
  previous: StableMarkdownNodeChunk<T>[] | undefined,
  chunkSize: number
): StableMarkdownNodeChunk<T>[] {
  const normalizedChunkSize = Math.max(1, Math.trunc(chunkSize))
  const chunkCount = Math.ceil(nodes.length / normalizedChunkSize)
  const chunks = new Array<StableMarkdownNodeChunk<T>>(chunkCount)
  let hasChanged = previous?.length !== chunkCount

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const start = chunkIndex * normalizedChunkSize
    const end = Math.min(nodes.length, start + normalizedChunkSize)
    const previousChunk = previous?.[chunkIndex]
    const canReuse =
      previousChunk?.nodes.length === end - start &&
      previousChunk.nodes.every((node, index) => node === nodes[start + index])
    if (canReuse && previousChunk) {
      chunks[chunkIndex] = previousChunk
      continue
    }
    hasChanged = true
    chunks[chunkIndex] = {
      key: chunkIndex,
      nodes: nodes.slice(start, end)
    }
  }

  return !hasChanged && previous ? previous : chunks
}

export function stabilizeMarkdownNodes<T>(
  nodes: T[],
  previous: StableMarkdownNodes<T> | undefined,
  options: StabilizeMarkdownNodesOptions = {}
): StableMarkdownNodes<T> {
  if (!previous) {
    return { nodes, fingerprints: nodes.map(fingerprintMarkdownNode) }
  }

  const comparableLength = Math.min(previous.nodes.length, nodes.length)
  const stablePrefixLength = Math.max(
    0,
    Math.min(options.stablePrefixLength ?? 0, comparableLength)
  )
  const stableNodes = new Array<T>(nodes.length)
  const fingerprints = new Array<string | undefined>(nodes.length)

  for (let index = 0; index < stablePrefixLength; index += 1) {
    stableNodes[index] = previous.nodes[index] as T
    fingerprints[index] = previous.fingerprints[index]
  }

  let changedStartIndex = comparableLength
  for (let index = stablePrefixLength; index < comparableLength; index += 1) {
    const fingerprint = fingerprintMarkdownNode(nodes[index])
    fingerprints[index] = fingerprint
    if (fingerprint === undefined || fingerprint !== previous.fingerprints[index]) {
      changedStartIndex = index
      break
    }
    stableNodes[index] = previous.nodes[index] as T
  }
  for (let index = changedStartIndex; index < nodes.length; index += 1) {
    stableNodes[index] = nodes[index] as T
    fingerprints[index] ??= fingerprintMarkdownNode(nodes[index])
  }

  if (changedStartIndex === nodes.length && previous.nodes.length === nodes.length) {
    return previous
  }
  return { nodes: stableNodes, fingerprints }
}
