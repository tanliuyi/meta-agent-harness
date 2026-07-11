import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface ExtensionRootMigrationResult {
  moved: number;
  merged: number;
  skipped: number;
  warnings: string[];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function moveFileSafe(source: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });

  try {
    await fs.rename(source, target);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "EXDEV") throw error;
  }

  await fs.copyFile(source, target);
  await fs.unlink(source);
}

const DATABASE_SUFFIXES = ["", "-wal", "-shm"] as const;
const BUSINESS_TABLES = ["sessions", "messages", "session_files", "memories"] as const;

function databaseHasBusinessRows(dbPath: string): boolean {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const table of BUSINESS_TABLES) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (exists && db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) return true;
    }
    return false;
  } finally {
    db.close();
  }
}

async function recoverEmptyTargetDatabase(
  legacyRoot: string,
  targetRoot: string,
  result: ExtensionRootMigrationResult,
): Promise<void> {
  const sourceDb = path.join(legacyRoot, "sessions.db");
  const targetDb = path.join(targetRoot, "sessions.db");
  if (!await pathExists(sourceDb) || !await pathExists(targetDb)) return;

  try {
    const sourceHasRows = databaseHasBusinessRows(sourceDb);
    const targetHasRows = databaseHasBusinessRows(targetDb);
    if (!sourceHasRows || targetHasRows) {
      result.skipped++;
      if (sourceHasRows && targetHasRows) {
        result.warnings.push("Both legacy and target sessions.db contain user data; preserving both databases.");
      }
      return;
    }

    for (const suffix of DATABASE_SUFFIXES) await fs.rm(targetDb + suffix, { force: true });
    for (const suffix of DATABASE_SUFFIXES) {
      const source = sourceDb + suffix;
      if (await pathExists(source)) {
        await moveFileSafe(source, targetDb + suffix);
        result.moved++;
      }
    }
  } catch (error) {
    result.warnings.push(`sessions.db recovery: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function moveDirContents(sourceDir: string, targetDir: string, result: ExtensionRootMigrationResult): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (!await pathExists(targetPath)) {
      try {
        await moveFileSafe(sourcePath, targetPath);
        result.moved++;
      } catch (error) {
        result.warnings.push(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }

    if (entry.isDirectory()) {
      await moveDirContents(sourcePath, targetPath, result);
      result.merged++;
      try {
        const remaining = await fs.readdir(sourcePath);
        if (remaining.length === 0) await fs.rmdir(sourcePath);
      } catch {
        // best effort
      }
      continue;
    }

    result.skipped++;
  }
}

/**
 * Move legacy extension assets from ~/.pi/agent/memory into
 * ~/.pi/agent/pi-hermes-memory. Existing destination files win.
 */
export async function migrateExtensionRoot(
  legacyRoot: string,
  targetRoot: string,
): Promise<ExtensionRootMigrationResult> {
  const result: ExtensionRootMigrationResult = {
    moved: 0,
    merged: 0,
    skipped: 0,
    warnings: [],
  };

  if (path.resolve(legacyRoot) === path.resolve(targetRoot)) return result;
  if (!existsSync(legacyRoot)) return result;

  await fs.mkdir(targetRoot, { recursive: true });
  await recoverEmptyTargetDatabase(legacyRoot, targetRoot, result);
  await moveDirContents(legacyRoot, targetRoot, result);

  try {
    const remaining = await fs.readdir(legacyRoot);
    if (remaining.length === 0) {
      await fs.rmdir(legacyRoot);
    }
  } catch {
    // best effort
  }

  return result;
}
