import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ENTRY_DELIMITER, MEMORY_FILE, USER_FILE } from "./constants.js";

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

  const sourceStat = await fs.stat(source);
  if (sourceStat.isDirectory()) {
    await fs.cp(source, target, { recursive: true });
    await fs.rm(source, { recursive: true, force: true });
  } else {
    await fs.copyFile(source, target);
    await fs.unlink(source);
  }
}

async function nextConflictPath(targetPath: string): Promise<string> {
  let suffix = "-legacy";
  let candidate = targetPath + suffix;
  let index = 2;
  while (await pathExists(candidate)) {
    suffix = `-legacy-${index}`;
    candidate = targetPath + suffix;
    index += 1;
  }
  return candidate;
}

const DATABASE_SUFFIXES = ["", "-wal", "-shm"] as const;
const BUSINESS_TABLES = ["sessions", "messages", "session_files", "memories"] as const;
const MERGEABLE_ENTRY_FILES = new Set([MEMORY_FILE, USER_FILE, "failures.md"]);

function parseEntries(raw: string): string[] {
  return raw.split(ENTRY_DELIMITER).map((entry) => entry.trim()).filter(Boolean);
}

async function mergeEntryFile(source: string, target: string): Promise<void> {
  const [sourceRaw, targetRaw] = await Promise.all([
    fs.readFile(source, "utf-8"),
    fs.readFile(target, "utf-8"),
  ]);
  const entries = [...parseEntries(targetRaw)];
  const seen = new Set(entries);
  for (const entry of parseEntries(sourceRaw)) {
    if (!seen.has(entry)) {
      seen.add(entry);
      entries.push(entry);
    }
  }
  await fs.writeFile(target, entries.join(ENTRY_DELIMITER), "utf-8");
  await fs.rm(source, { force: true });
}

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
      const sourceSkill = path.join(sourcePath, "SKILL.md");
      const targetSkill = path.join(targetPath, "SKILL.md");
      if (await pathExists(sourceSkill) && await pathExists(targetSkill)) {
        const [sourceRaw, targetRaw] = await Promise.all([
          fs.readFile(sourceSkill),
          fs.readFile(targetSkill),
        ]);
        if (sourceRaw.equals(targetRaw)) {
          await fs.rm(sourceSkill, { force: true });
        } else {
          const preservedPath = await nextConflictPath(targetPath);
          await moveFileSafe(sourcePath, preservedPath);
          result.moved++;
          result.warnings.push(`${sourceSkill}: conflicts with ${targetSkill}; preserved as ${preservedPath}`);
          continue;
        }
      }
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

    if (MERGEABLE_ENTRY_FILES.has(entry.name)) {
      try {
        await mergeEntryFile(sourcePath, targetPath);
        result.merged++;
      } catch (error) {
        result.warnings.push(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }

    try {
      const [sourceRaw, targetRaw] = await Promise.all([fs.readFile(sourcePath), fs.readFile(targetPath)]);
      if (sourceRaw.equals(targetRaw)) {
        await fs.rm(sourcePath, { force: true });
        result.merged++;
        continue;
      }
    } catch (error) {
      result.warnings.push(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    result.skipped++;
  }
}

export async function mergeLegacyDirectoryContents(
  legacyRoot: string,
  targetRoot: string,
): Promise<ExtensionRootMigrationResult> {
  const result: ExtensionRootMigrationResult = {
    moved: 0,
    merged: 0,
    skipped: 0,
    warnings: [],
  };
  if (path.resolve(legacyRoot) === path.resolve(targetRoot) || !existsSync(legacyRoot)) return result;

  await fs.mkdir(targetRoot, { recursive: true });
  await moveDirContents(legacyRoot, targetRoot, result);
  try {
    const remaining = await fs.readdir(legacyRoot);
    if (remaining.length === 0) await fs.rmdir(legacyRoot);
  } catch {
    // best effort
  }
  return result;
}

/**
 * Move legacy extension assets from ~/.pi/agent/memory into
 * ~/.pi/agent/pi-hermes-memory. Memory entry files are merged; other conflicts preserve the source.
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
