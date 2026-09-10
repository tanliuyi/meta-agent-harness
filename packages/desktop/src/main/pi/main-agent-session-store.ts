import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertMainAgentSessionSnapshot, type MainAgentSessionSnapshot } from "../../shared/main-agent-contracts.ts";

const SNAPSHOT_SUFFIX = ".main-agent.json";

/** Derives metadata only from a trusted, already-resolved session file path. */
export function mainAgentSnapshotPath(sessionFile: string): string {
  return `${sessionFile}${SNAPSHOT_SUFFIX}`;
}

export async function readMainAgentSessionSnapshot(sessionFile: string): Promise<MainAgentSessionSnapshot | undefined> {
  const path = mainAgentSnapshotPath(sessionFile);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Main agent snapshot must be a regular file: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Main agent snapshot is corrupt: ${path}`, { cause: error });
  }
  assertMainAgentSessionSnapshot(value);
  return structuredClone(value);
}

export async function writeMainAgentSessionSnapshot(
  sessionFile: string,
  snapshot: MainAgentSessionSnapshot,
): Promise<void> {
  assertMainAgentSessionSnapshot(snapshot);
  const path = mainAgentSnapshotPath(sessionFile);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomUUID()}.main-agent.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function copyMainAgentSessionSnapshot(
  sourceSessionFile: string,
  targetSessionFile: string,
): Promise<void> {
  const snapshot = await readMainAgentSessionSnapshot(sourceSessionFile);
  if (!snapshot) return;
  await writeMainAgentSessionSnapshot(targetSessionFile, snapshot);
}

export async function removeMainAgentSessionSnapshot(sessionFile: string): Promise<void> {
  await rm(mainAgentSnapshotPath(sessionFile), { force: true });
}
