import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopBranchedSession, materializeDesktopSession } from "../src/main/pi/desktop-session-persistence.ts";
import { mainAgentSnapshotPath } from "../src/main/pi/main-agent-session-store.ts";

vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()) }));

describe("Desktop session persistence", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "desktop-persistence-"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.each(["empty", "branched", "reset"])(
    "preserves %s leaf and persists subsequent first assistant once",
    async (mode) => {
      const manager = SessionManager.create(directory, directory, { id: "eager", parentSession: "parent.jsonl" });
      let leaf: string | null = null;
      if (mode !== "empty") {
        leaf = manager.appendMessage({ role: "user", content: "first", timestamp: 1 });
        manager.appendMessage({ role: "user", content: "other", timestamp: 2 });
        if (mode === "reset") {
          manager.resetLeaf();
          leaf = null;
        } else manager.branch(leaf);
      }
      const header = structuredClone(manager.getHeader());
      expect(existsSync(manager.getSessionFile()!)).toBe(false);
      const file = await materializeDesktopSession(manager);
      expect(manager.getHeader()).toEqual(header);
      expect(manager.getLeafId()).toBe(leaf);
      const assistant = manager.appendMessage(fauxAssistantMessage("answer"));
      const reopened = SessionManager.open(file);
      expect(reopened.getEntry(assistant)?.parentId).toBe(leaf);
      expect(reopened.getEntries()).toEqual(manager.getEntries());
      expect(
        (await fs.readFile(file, "utf8"))
          .trim()
          .split("\n")
          .filter((line) => JSON.parse(line).type === "session"),
      ).toHaveLength(1);
    },
  );

  it("preserves native branch labels and fork metadata without changing source identity, including legacy sessions", async () => {
    const manager = SessionManager.create(directory, directory);
    await materializeDesktopSession(manager);
    const user = manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
    manager.appendLabelChange(user, "bookmark");
    const leaf = manager.appendMessage(fauxAssistantMessage("answer"));
    const sourceFile = manager.getSessionFile()!;
    const sourceId = manager.getSessionId();
    const sourceBytes = await fs.readFile(sourceFile, "utf8");
    const result = await createDesktopBranchedSession(sourceFile, directory, directory, leaf);
    const branch = SessionManager.open(result.branchSessionFile);
    expect(branch.getLabel(user)).toBe("bookmark");
    expect(branch.getHeader()?.parentSession).toBe(sourceFile);
    expect(branch.getSessionId()).toBe(result.branchThreadId);
    expect(branch.buildSessionContext()).toEqual(manager.buildSessionContext());
    expect(manager.getSessionId()).toBe(sourceId);
    expect(manager.getSessionFile()).toBe(sourceFile);
    expect(await fs.readFile(sourceFile, "utf8")).toBe(sourceBytes);
    expect(existsSync(mainAgentSnapshotPath(result.branchSessionFile))).toBe(false);
    expect((await fs.readdir(directory)).filter((name) => name.startsWith(".branch-"))).toEqual([]);
  });

  it.each(["snapshot", "publish"])("cleans staged branch and policy after %s failure", async (failure) => {
    const manager = SessionManager.create(directory, directory);
    await materializeDesktopSession(manager);
    const leaf = manager.appendMessage(fauxAssistantMessage("answer"));
    const sourceFile = manager.getSessionFile()!;
    if (failure === "snapshot") await fs.writeFile(mainAgentSnapshotPath(sourceFile), "{broken");
    if (failure === "publish")
      await fs.writeFile(
        mainAgentSnapshotPath(sourceFile),
        JSON.stringify({
          version: 1,
          profileId: "agent",
          profileRevision: 1,
          profileName: "Agent",
          createdAt: 1,
          configuration: {
            prompt: {
              mode: "default",
              text: "",
              includeGlobalRules: true,
              includeProjectRules: true,
              includeSkills: true,
            },
            tools: [],
            builtinPluginIds: [],
          },
        }),
      );
    const before = await fs.readdir(directory);
    if (failure === "publish") {
      const rename = fs.rename;
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (String(to).endsWith(".jsonl") && !String(to).includes(".branch-")) throw new Error("publish failed");
        return rename(from, to);
      });
    }
    await expect(createDesktopBranchedSession(sourceFile, directory, directory, leaf)).rejects.toThrow(
      failure === "snapshot" ? "snapshot is corrupt" : "publish failed",
    );
    expect(await fs.readdir(directory)).toEqual(before);
    expect((await SessionManager.list(directory, directory)).map(({ path }) => path)).toEqual([sourceFile]);
  });

  it("removes an incomplete eager staging file when publication fails", async () => {
    const manager = SessionManager.create(directory, directory);
    vi.spyOn(fs, "rename").mockRejectedValue(new Error("rename failed"));
    await expect(materializeDesktopSession(manager)).rejects.toThrow("rename failed");
    expect(await fs.readdir(directory)).toEqual([]);
  });
});
