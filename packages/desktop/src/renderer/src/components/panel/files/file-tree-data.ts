import type { FileChangeSet, FileNode } from "../../../../../shared/contracts.ts";

export interface FileTreeData {
  roots: FileNode[];
  children: Record<string, FileNode[]>;
}

export function emptyFileTreeData(): FileTreeData {
  return { roots: [], children: {} };
}

export function replaceFileTreeDirectory(state: FileTreeData, path: string, items: FileNode[]): FileTreeData {
  if (path === "") return { ...state, roots: items };
  return { ...state, children: { ...state.children, [path]: items } };
}

export type ActiveFileChange = "deleted" | "reload" | null;

export function isSameOrDescendantPath(path: string, directoryPath: string): boolean {
  return path === directoryPath || path.startsWith(`${directoryPath}/`);
}

export interface FileTreeChangePlan {
  removedDirectories: string[];
  refreshDirectories: string[];
}

export function fileTreeChangePlan(change: FileChangeSet, loadedDirectories: ReadonlySet<string>): FileTreeChangePlan {
  const removedDirectories = change.deleted.filter((path) => loadedDirectories.has(path));
  const isInsideRemovedDirectory = (path: string) =>
    removedDirectories.some((removedPath) => isSameOrDescendantPath(path, removedPath));
  const refreshDirectories = new Set<string>();
  for (const path of [...change.added, ...change.deleted]) {
    const index = path.lastIndexOf("/");
    const parent = index === -1 ? "" : path.slice(0, index);
    if (loadedDirectories.has(parent) && !isInsideRemovedDirectory(parent)) refreshDirectories.add(parent);
  }
  return { removedDirectories, refreshDirectories: [...refreshDirectories] };
}

export function activeFileChange(change: FileChangeSet, activePath: string): ActiveFileChange {
  if (change.deleted.some((path) => activePath === path || activePath.startsWith(`${path}/`))) return "deleted";
  if (change.updated.includes(activePath) || change.added.includes(activePath)) return "reload";
  return null;
}

export function removeLoadedFileTreeDirectory(state: FileTreeData, path: string): FileTreeData {
  const retained = Object.entries(state.children).filter(([childPath]) => !isSameOrDescendantPath(childPath, path));
  if (retained.length === Object.keys(state.children).length) return state;
  const children = Object.fromEntries(retained);
  return { ...state, children };
}

export function removeExpandedFileTreeDirectory(paths: string[], path: string): string[];
export function removeExpandedFileTreeDirectory(paths: readonly string[], path: string): readonly string[];
export function removeExpandedFileTreeDirectory(paths: readonly string[], path: string): readonly string[] {
  const retained = paths.filter((expandedPath) => !isSameOrDescendantPath(expandedPath, path));
  return retained.length === paths.length ? paths : retained;
}
