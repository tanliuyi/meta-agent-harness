import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { copyMainAgentSessionSnapshot, removeMainAgentSessionSnapshot } from "./main-agent-session-store.ts";

/** Publish a complete JSONL, then reload through Pi's public API so later appends persist. */
export async function materializeDesktopSession(manager: SessionManager): Promise<string> {
  const sessionFile = manager.getSessionFile();
  const header = manager.getHeader();
  if (!manager.isPersisted() || !sessionFile || !header) throw new Error("Desktop session requires a persisted header");
  const leafId = manager.getLeafId();
  const temporary = join(dirname(sessionFile), `.${randomUUID()}.session.tmp`);
  try {
    await writeFile(
      temporary,
      `${[header, ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    await rename(temporary, sessionFile);
    manager.setSessionFile(sessionFile);
    if (leafId === null) manager.resetLeaf();
    else manager.branch(leafId);
    return sessionFile;
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Keep native branch writes out of discovery until its policy snapshot is ready. */
export async function createDesktopBranchedSession(
  sourceSessionFile: string,
  sessionDir: string,
  cwd: string,
  leafId: string,
): Promise<{ branchThreadId: string; branchSessionFile: string }> {
  await mkdir(sessionDir, { recursive: true });
  // Session discovery scans JSONL files directly in sessionDir, never its subdirectories.
  const stagingDir = await mkdtemp(join(sessionDir, ".branch-"));
  let branchSessionFile: string | undefined;
  try {
    const manager = SessionManager.open(sourceSessionFile, stagingDir, cwd);
    const stagedFile = manager.createBranchedSession(leafId);
    if (!stagedFile) throw new Error("Pi createBranchedSession did not allocate a session file");
    branchSessionFile = join(sessionDir, basename(stagedFile));
    await materializeDesktopSession(manager);
    await copyMainAgentSessionSnapshot(sourceSessionFile, branchSessionFile);
    await rename(stagedFile, branchSessionFile);
    return { branchThreadId: manager.getSessionId(), branchSessionFile };
  } catch (error) {
    if (branchSessionFile) {
      // Keep the policy if removing a discoverable JSONL fails.
      await rm(branchSessionFile, { force: true });
      await removeMainAgentSessionSnapshot(branchSessionFile);
    }
    throw error;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
