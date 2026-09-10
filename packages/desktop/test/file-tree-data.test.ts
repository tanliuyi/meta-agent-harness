import { describe, expect, it } from "vitest";
import {
  activeFileChange,
  emptyFileTreeData,
  fileTreeChangePlan,
  removeExpandedFileTreeDirectory,
  removeLoadedFileTreeDirectory,
  replaceFileTreeDirectory,
} from "../src/renderer/src/components/panel/files/file-tree-data.ts";
import type { FileNode } from "../src/shared/contracts.ts";

const rootFile: FileNode = { name: "README.md", path: "README.md", type: "file" };
const childFile: FileNode = { name: "index.ts", path: "src/index.ts", type: "file" };

describe("file tree data", () => {
  it("根目录监听刷新替换 roots，而不是写入 children 空路径", () => {
    const initial = replaceFileTreeDirectory(emptyFileTreeData(), "src", [childFile]);
    const next = replaceFileTreeDirectory(initial, "", [rootFile]);

    expect(next.roots).toEqual([rootFile]);
    expect(next.children).toEqual({ src: [childFile] });
    expect(next.children[""]).toBeUndefined();
  });

  it("子目录刷新只替换对应 children 缓存", () => {
    const initial = replaceFileTreeDirectory(emptyFileTreeData(), "", [rootFile]);
    const next = replaceFileTreeDirectory(initial, "src", [childFile]);

    expect(next.roots).toEqual([rootFile]);
    expect(next.children).toEqual({ src: [childFile] });
  });

  it("活动文件更新、重建和祖先目录删除会触发正确动作", () => {
    const base = { projectId: "project", added: [], deleted: [], updated: [] };
    expect(activeFileChange({ ...base, updated: ["src/index.ts"] }, "src/index.ts")).toBe("reload");
    expect(activeFileChange({ ...base, added: ["src/index.ts"] }, "src/index.ts")).toBe("reload");
    expect(activeFileChange({ ...base, deleted: ["src"] }, "src/index.ts")).toBe("deleted");
    expect(activeFileChange({ ...base, updated: ["src/other.ts"] }, "src/index.ts")).toBeNull();
  });

  it("递归删除目录时只刷新仍存在的父目录", () => {
    const change = {
      projectId: "project",
      added: [],
      deleted: ["scene_split/generated/image.png", "scene_split/generated/nested", "scene_split/generated"],
      updated: [],
    };
    const loaded = new Set(["", "scene_split", "scene_split/generated", "scene_split/generated/nested"]);

    expect(fileTreeChangePlan(change, loaded)).toEqual({
      removedDirectories: ["scene_split/generated/nested", "scene_split/generated"],
      refreshDirectories: ["scene_split"],
    });
  });

  it("删除已加载目录时清理目录及其后代缓存和展开状态", () => {
    const initial = {
      roots: [],
      children: { src: [childFile], "src/components": [], "src-old": [], scripts: [] },
    };
    expect(removeLoadedFileTreeDirectory(initial, "src")).toEqual({
      roots: [],
      children: { "src-old": [], scripts: [] },
    });
    expect(removeLoadedFileTreeDirectory(initial, "missing")).toBe(initial);

    const expanded = ["src", "src/components", "src-old", "scripts"];
    expect(removeExpandedFileTreeDirectory(expanded, "src")).toEqual(["src-old", "scripts"]);
    expect(removeExpandedFileTreeDirectory(expanded, "missing")).toBe(expanded);
  });
});
