import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { SessionStateStore } from "../src/state.ts";
import { createInitialState } from "acp-kernel";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "acp-state-"));
}

test("load returns fresh state when no file exists", async () => {
  const dir = await tempDir();
  const store = new SessionStateStore();
  const state = await store.load(path.join(dir, "session.json"), "sid-1");
  assert.deepEqual(state.blocks, []);
  assert.equal(state.nextBlockId, 1, "fresh state starts nextBlockId at 1");
  await rm(dir, { recursive: true, force: true });
});

test("save then load round-trips state", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "session.json");
  const store = new SessionStateStore();
  const before = createInitialState();
  before.blocks.push({
    blockId: "b0",
    runId: 0,
    tier: 1,
    generation: "young",
    active: true,
    summary: "alpha",
    directMessageIds: ["a", "b"],
    effectiveMessageIds: ["a", "b"],
    survivedCount: 1,
    createdAt: 100,
  });
  before.nextBlockId = 1;
  before.messageRefs.nextRef = 2;
  before.messageRefs.byRaw.a = "m00000";
  before.messageRefs.byRef.m00000 = "a";

  await store.save(before, file, "sid");
  const store2 = new SessionStateStore();
  const after = await store2.load(file, "sid");

  assert.equal(after.blocks.length, 1);
  assert.equal(after.blocks[0]!.blockId, "b0");
  assert.equal(after.nextBlockId, 1);
  assert.equal(after.messageRefs.byRef.m00000, "a");
  await rm(dir, { recursive: true, force: true });
});

test("load merges forward-compat: missing fields filled from fresh state", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "session.json");
  // The store persists to `{sessionFile}.acp.json`; write a minimal legacy file there.
  const minimal = { blocks: [{ blockId: "b0", active: true }], nextBlockId: 1 };
  await writeFile(`${file}.acp.json`, JSON.stringify(minimal), "utf8");

  const store = new SessionStateStore();
  const state = await store.load(file, "sid");
  assert.equal(state.blocks.length, 1);
  assert.equal(state.nudge.lastPerMessageNudgeTokens, 0, "nudge backfilled");
  assert.ok(state.messageRefs.byRaw, "messageRefs backfilled");
  await rm(dir, { recursive: true, force: true });
});

test("ephemeral child sessions retain compression state across context requests", async () => {
  const store = new SessionStateStore();
  const state = await store.load(undefined, "child-1");
  state.messageRefs.byRaw.a = "m00001";
  state.messageRefs.byRef.m00001 = "a";
  assert.equal(await store.load(undefined, "child-1"), state);

  state.blocks.push({
    blockId: "b1", runId: 1, tier: 1, generation: "young", active: true,
    summary: "compressed child history", directMessageIds: ["a"], effectiveMessageIds: ["a"],
    survivedCount: 0, createdAt: 100,
  });
  state.nextBlockId = 2;
  await store.save(state, undefined, "child-1");
  const next = await store.load(undefined, "child-1");
  assert.equal(next.blocks[0]?.summary, "compressed child history");
  assert.equal(next.messageRefs.byRef.m00001, "a");
  assert.equal(next.nextBlockId, 2);

  const other = await store.load(undefined, "child-2");
  assert.deepEqual(other.blocks, []);
  assert.deepEqual(other.messageRefs.byRaw, {});
});

test("invalidating an ephemeral session discards cached state", async () => {
  const store = new SessionStateStore();
  const state = await store.load(undefined, "child");
  state.nextBlockId = 5;
  await store.save(state, undefined, "child");
  store.invalidate();
  assert.equal((await store.load(undefined, "child")).nextBlockId, 1);
});

test("invalidate forces a fresh read after save", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "session.json");
  const store = new SessionStateStore();
  const s1 = createInitialState();
  s1.nextBlockId = 5;
  await store.save(s1, file, "sid");

  store.invalidate();
  const reloaded = await store.load(file, "sid");
  assert.equal(reloaded.nextBlockId, 5);
  await rm(dir, { recursive: true, force: true });
});
