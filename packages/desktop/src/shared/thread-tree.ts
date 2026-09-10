export interface ThreadTreeEntry {
  id: string;
  parentThreadId?: string;
}

export function resolveThreadRootId(threadsById: ReadonlyMap<string, ThreadTreeEntry>, threadId: string): string {
  const visited: string[] = [];
  const visitedIds = new Set<string>();
  let currentId = threadId;
  while (!visitedIds.has(currentId)) {
    visited.push(currentId);
    visitedIds.add(currentId);
    const parentThreadId = threadsById.get(currentId)?.parentThreadId;
    if (!parentThreadId || !threadsById.has(parentThreadId)) return currentId;
    currentId = parentThreadId;
  }
  return visited.toSorted()[0] ?? threadId;
}

export function collectThreadDescendantIds(threads: readonly ThreadTreeEntry[], parentId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const thread of threads) {
    if (!thread.parentThreadId) continue;
    const children = childrenByParent.get(thread.parentThreadId) ?? [];
    children.push(thread.id);
    childrenByParent.set(thread.parentThreadId, children);
  }
  const descendants: string[] = [];
  const pending = [...(childrenByParent.get(parentId) ?? [])];
  const visited = new Set([parentId]);
  for (let index = 0; index < pending.length; index += 1) {
    const id = pending[index];
    if (!id || visited.has(id)) continue;
    visited.add(id);
    descendants.push(id);
    pending.push(...(childrenByParent.get(id) ?? []));
  }
  return descendants;
}
