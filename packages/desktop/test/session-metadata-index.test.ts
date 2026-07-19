import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "../src/shared/contracts.ts";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: { list: mocks.listSessions },
}));

import { SessionMetadataIndex } from "../src/sidecar/session-metadata-index.ts";

describe("SessionMetadataIndex", () => {
  let userDataDir: string;
  let cwd: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "session-metadata-index-"));
    cwd = join(userDataDir, "project");
    mocks.listSessions.mockReset();
    mocks.listSessions.mockResolvedValue([]);
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("serves a validated persisted index without scanning session files again", async () => {
    const sessionFile = join(userDataDir, "thread.jsonl");
    writeFileSync(sessionFile, "initial\n");
    const index = new SessionMetadataIndex(userDataDir);
    index.upsert("project", cwd, sessionFile, thread("thread", "Initial"));
    mocks.listSessions.mockResolvedValue([sessionInfo("thread", sessionFile, "Initial", 2)]);
    await expect(index.list("project", cwd)).resolves.toEqual([thread("thread", "Initial")]);
    mocks.listSessions.mockClear();

    const restarted = new SessionMetadataIndex(userDataDir);
    await expect(restarted.list("project", cwd)).resolves.toEqual([thread("thread", "Initial")]);
    await expect(restarted.resolve("project", cwd, "thread")).resolves.toEqual({ id: "thread", path: sessionFile });
    expect(mocks.listSessions).not.toHaveBeenCalled();
  });

  it("validates a newly discovered session directory before reusing its persisted index", async () => {
    const sessionFile = join(userDataDir, "recovered.jsonl");
    writeFileSync(sessionFile, "recovered\n");
    mocks.listSessions.mockResolvedValue([
      {
        id: "recovered",
        path: sessionFile,
        name: "Recovered",
        firstMessage: "First prompt",
        created: new Date(10),
        modified: new Date(20),
        messageCount: 2,
      },
    ]);

    await expect(new SessionMetadataIndex(userDataDir).list("project", cwd)).resolves.toEqual([
      {
        ...thread("recovered", "Recovered"),
        createdAt: 10,
        updatedAt: 20,
        messageCount: 2,
        preview: "First prompt",
      },
    ]);
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);

    mocks.listSessions.mockClear();
    const restarted = new SessionMetadataIndex(userDataDir);
    await expect(restarted.resolve("project", cwd, "recovered")).resolves.toEqual({
      id: "recovered",
      path: sessionFile,
    });
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);

    mocks.listSessions.mockClear();
    await expect(new SessionMetadataIndex(userDataDir).resolve("project", cwd, "recovered")).resolves.toEqual({
      id: "recovered",
      path: sessionFile,
    });
    expect(mocks.listSessions).not.toHaveBeenCalled();
  });

  it("refreshes additions, metadata changes, and deletions while the worker remains alive", async () => {
    const initialFile = join(userDataDir, "initial.jsonl");
    const addedFile = join(userDataDir, "added.jsonl");
    writeFileSync(initialFile, "initial\n");
    const index = new SessionMetadataIndex(userDataDir);
    index.upsert("project", cwd, initialFile, thread("initial", "Initial"));
    mocks.listSessions.mockResolvedValue([sessionInfo("initial", initialFile, "Initial", 2)]);
    await index.list("project", cwd);
    mocks.listSessions.mockClear();

    writeFileSync(addedFile, "added\n");
    mocks.listSessions.mockResolvedValue([
      sessionInfo("added", addedFile, "Added", 3),
      sessionInfo("initial", initialFile, "Initial", 2),
    ]);
    await expect(index.list("project", cwd)).resolves.toEqual([
      { ...thread("added", "Added"), updatedAt: 3 },
      { ...thread("initial", "Initial"), updatedAt: 2 },
    ]);

    appendFileSync(initialFile, "renamed\n");
    mocks.listSessions.mockResolvedValue([
      sessionInfo("initial", initialFile, "Renamed externally", 4),
      sessionInfo("added", addedFile, "Added", 3),
    ]);
    await expect(index.list("project", cwd)).resolves.toEqual([
      { ...thread("initial", "Renamed externally"), updatedAt: 4 },
      { ...thread("added", "Added"), updatedAt: 3 },
    ]);

    rmSync(addedFile);
    mocks.listSessions.mockResolvedValue([sessionInfo("initial", initialFile, "Renamed externally", 4)]);
    await expect(index.list("project", cwd)).resolves.toEqual([
      { ...thread("initial", "Renamed externally"), updatedAt: 4 },
    ]);
    expect(mocks.listSessions).toHaveBeenCalledTimes(3);
  });

  it("revalidates a persisted index after external changes made while the worker is stopped", async () => {
    const sessionFile = join(userDataDir, "thread.jsonl");
    writeFileSync(sessionFile, "initial\n");
    const index = new SessionMetadataIndex(userDataDir);
    index.upsert("project", cwd, sessionFile, thread("thread", "Initial"));
    mocks.listSessions.mockResolvedValue([sessionInfo("thread", sessionFile, "Initial", 2)]);
    await index.list("project", cwd);
    mocks.listSessions.mockClear();

    appendFileSync(sessionFile, "renamed\n");
    mocks.listSessions.mockResolvedValue([sessionInfo("thread", sessionFile, "Renamed externally", 5)]);

    await expect(new SessionMetadataIndex(userDataDir).list("project", cwd)).resolves.toEqual([
      { ...thread("thread", "Renamed externally"), updatedAt: 5 },
    ]);
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
  });

  it("rebuilds once when resolve misses an otherwise fresh cached project", async () => {
    const initialFile = join(userDataDir, "initial.jsonl");
    const recoveredFile = join(userDataDir, "recovered.jsonl");
    writeFileSync(initialFile, "initial\n");
    const index = new SessionMetadataIndex(userDataDir);
    index.upsert("project", cwd, initialFile, thread("initial", "Initial"));
    mocks.listSessions.mockResolvedValue([sessionInfo("initial", initialFile, "Initial", 2)]);
    await index.list("project", cwd);
    mocks.listSessions.mockClear();
    mocks.listSessions.mockResolvedValue([
      sessionInfo("initial", initialFile, "Initial", 2),
      sessionInfo("recovered", recoveredFile, "Recovered", 3),
    ]);

    await expect(index.resolve("project", cwd, "recovered")).resolves.toEqual({
      id: "recovered",
      path: recoveredFile,
    });
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild twice when resolve still misses after refreshing an invalidated project", async () => {
    const sessionFile = join(userDataDir, "initial.jsonl");
    writeFileSync(sessionFile, "initial\n");
    const index = new SessionMetadataIndex(userDataDir);
    index.upsert("project", cwd, sessionFile, thread("initial", "Initial"));
    mocks.listSessions.mockResolvedValue([]);

    await expect(index.resolve("project", cwd, "missing")).rejects.toThrow("Pi session does not exist: missing");
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
  });

  it("recovers a corrupt index and persists incremental mutations", async () => {
    writeFileSync(join(userDataDir, "session-metadata-index.json"), "not-json");
    const index = new SessionMetadataIndex(userDataDir);
    await expect(index.list("project", cwd)).resolves.toEqual([]);
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);

    const sessionFile = join(userDataDir, "thread.jsonl");
    writeFileSync(sessionFile, "initial\n");
    index.upsert("project", cwd, sessionFile, thread("thread", "Initial"));
    index.rename("project", cwd, "thread", "Renamed");
    mocks.listSessions.mockResolvedValue([sessionInfo("thread", sessionFile, "Renamed", 3)]);
    await expect(index.list("project", cwd)).resolves.toEqual([
      expect.objectContaining({ id: "thread", title: "Renamed" }),
    ]);

    rmSync(sessionFile);
    index.remove("project", "thread");
    mocks.listSessions.mockResolvedValue([]);
    await expect(index.list("project", cwd)).resolves.toEqual([]);
    index.invalidateProject("project");

    mocks.listSessions.mockClear();
    await expect(new SessionMetadataIndex(userDataDir).list("project", cwd)).resolves.toEqual([]);
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
  });
});

function thread(id: string, title: string): Thread {
  return {
    id,
    projectId: "project",
    title,
    createdAt: 1,
    updatedAt: 2,
    messageCount: 0,
    preview: "",
    archived: false,
    running: false,
  };
}

function sessionInfo(id: string, path: string, name: string, modified: number) {
  return {
    id,
    path,
    name,
    firstMessage: "",
    created: new Date(1),
    modified: new Date(modified),
    messageCount: 0,
  };
}
