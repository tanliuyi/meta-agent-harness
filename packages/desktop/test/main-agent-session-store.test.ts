import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesktopBranchedSession, materializeDesktopSession } from "../src/main/pi/desktop-session-persistence.ts";
import {
  mainAgentSnapshotPath,
  readMainAgentSessionSnapshot,
  writeMainAgentSessionSnapshot,
} from "../src/main/pi/main-agent-session-store.ts";
import { GENERAL_WORKSPACE_ID } from "../src/shared/contracts.ts";
import type { MainAgentSessionSnapshot } from "../src/shared/main-agent-contracts.ts";
import { SessionMetadataIndex } from "../src/sidecar/session-metadata-index.ts";

const snapshot: MainAgentSessionSnapshot = {
  version: 1,
  profileId: "agent",
  profileRevision: 7,
  profileName: "Agent",
  createdAt: 123,
  configuration: {
    prompt: { mode: "default", text: "", includeGlobalRules: true, includeProjectRules: true, includeSkills: true },
    tools: [],
    builtinPluginIds: ["pi-auto-title"],
  },
};

describe("main agent session snapshot store", () => {
  let directory: string;
  let source: string;

  beforeEach(async () => {
    directory = join(tmpdir(), `desktop-main-agent-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(directory, { recursive: true });
    source = join(directory, "session.jsonl");
    await writeFile(source, "{}\n");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("atomically persists explicit empty collections and reloads independently of an index", async () => {
    await writeMainAgentSessionSnapshot(source, snapshot);
    expect(await readMainAgentSessionSnapshot(source)).toEqual(snapshot);
    expect(JSON.parse(await readFile(mainAgentSnapshotPath(source), "utf8"))).toEqual(snapshot);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("copies the authoritative snapshot to an actual earliest user-only branch and reopens it", async () => {
    const cwd = join(directory, "project");
    await mkdir(cwd, { recursive: true });
    const manager = SessionManager.create(cwd, directory, { id: "source" });
    await materializeDesktopSession(manager);
    source = manager.getSessionFile()!;
    const userEntryId = manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
    await writeMainAgentSessionSnapshot(source, snapshot);

    const { branchSessionFile: branch, branchThreadId } = await createDesktopBranchedSession(
      source,
      directory,
      cwd,
      userEntryId,
    );

    const reopened = SessionManager.open(branch);
    expect(reopened.getSessionId()).toBe(branchThreadId);
    expect(reopened.buildSessionContext().messages).toEqual([
      expect.objectContaining({ role: "user", content: "question" }),
    ]);
    expect(await readMainAgentSessionSnapshot(branch)).toEqual(snapshot);
  });

  it("preserves the authoritative snapshot across a real metadata index rebuild", async () => {
    const cwd = join(directory, "workspace");
    const agentDir = join(directory, "agent");
    const sessionDir = join(agentDir, "sessions", "--general--");
    await mkdir(cwd, { recursive: true });
    const manager = SessionManager.create(cwd, sessionDir, { id: "indexed-session" });
    await materializeDesktopSession(manager);
    const sessionFile = manager.getSessionFile()!;
    await writeMainAgentSessionSnapshot(sessionFile, snapshot);

    const index = new SessionMetadataIndex(directory, agentDir);
    await index.rebuild(GENERAL_WORKSPACE_ID, cwd);

    await expect(index.resolve(GENERAL_WORKSPACE_ID, cwd, "indexed-session")).resolves.toEqual({
      id: "indexed-session",
      path: sessionFile,
    });
    await expect(readMainAgentSessionSnapshot(sessionFile)).resolves.toEqual(snapshot);
  });

  it("keeps legacy sessions distinct and rejects invalid version/data", async () => {
    expect(await readMainAgentSessionSnapshot(source)).toBeUndefined();
    await writeFile(mainAgentSnapshotPath(source), JSON.stringify({ ...snapshot, version: 99 }));
    await expect(readMainAgentSessionSnapshot(source)).rejects.toThrow("version or identity is invalid");
    await writeFile(mainAgentSnapshotPath(source), "{broken");
    await expect(readMainAgentSessionSnapshot(source)).rejects.toThrow("snapshot is corrupt");
  });
});
