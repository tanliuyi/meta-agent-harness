import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Thread } from "../shared/contracts.ts";

const INDEX_VERSION = 2;
const INDEX_FILE_NAME = "session-metadata-index.json";

interface IndexedSession extends Thread {
  path: string;
}

interface IndexedProject {
  cwd: string;
  sessionDirectory: string | null;
  directoryFingerprint: string | null;
  sessions: IndexedSession[];
}

interface StoredIndex {
  version: typeof INDEX_VERSION;
  projects: Record<string, IndexedProject>;
}

export class SessionMetadataIndex {
  private readonly path: string;
  private data?: StoredIndex;

  constructor(userDataDir: string) {
    this.path = join(userDataDir, INDEX_FILE_NAME);
  }

  async list(projectId: string, cwd: string): Promise<Thread[]> {
    const project = await this.requireProject(projectId, cwd);
    return project.sessions.map(({ path: _path, ...thread }) => ({ ...thread, running: false }));
  }

  async resolve(projectId: string, cwd: string, threadId: string): Promise<{ id: string; path: string }> {
    const cached = this.load().projects[projectId];
    const cacheWasFresh = this.isProjectFresh(cached, cwd);
    let project = cacheWasFresh ? cached : await this.rebuild(projectId, cwd);
    let session = project.sessions.find(({ id }) => id === threadId);
    if (!session && cacheWasFresh) {
      project = await this.rebuild(projectId, cwd);
      session = project.sessions.find(({ id }) => id === threadId);
    }
    if (!session) throw new Error(`Pi session does not exist: ${threadId}`);
    return { id: session.id, path: session.path };
  }

  upsert(projectId: string, cwd: string, sessionFile: string, thread: Thread): void {
    const data = this.load();
    const project = data.projects[projectId];
    const sessions = project?.cwd === cwd ? [...project.sessions] : [];
    const next: IndexedSession = { ...thread, running: false, path: sessionFile };
    const index = sessions.findIndex(({ id }) => id === thread.id);
    if (index === -1) sessions.push(next);
    else sessions[index] = next;
    sessions.sort((left, right) => right.updatedAt - left.updatedAt);
    data.projects[projectId] = {
      cwd,
      sessionDirectory: dirname(sessionFile),
      directoryFingerprint: null,
      sessions,
    };
    this.persist();
  }

  rename(projectId: string, cwd: string, threadId: string, title: string): void {
    const data = this.load();
    const project = data.projects[projectId];
    if (!project || project.cwd !== cwd) throw new Error(`Session metadata index is missing project ${projectId}`);
    const session = project.sessions.find(({ id }) => id === threadId);
    if (!session) throw new Error(`Pi session does not exist: ${threadId}`);
    session.title = title;
    session.updatedAt = Date.now();
    project.directoryFingerprint = null;
    this.persist();
  }

  remove(projectId: string, threadId: string): void {
    const data = this.load();
    const project = data.projects[projectId];
    if (!project) return;
    project.sessions = project.sessions.filter(({ id }) => id !== threadId);
    project.directoryFingerprint = null;
    this.persist();
  }

  invalidateProject(projectId: string): void {
    const data = this.load();
    if (!Object.hasOwn(data.projects, projectId)) return;
    delete data.projects[projectId];
    this.persist();
  }

  async rebuild(projectId: string, cwd: string): Promise<IndexedProject> {
    const data = this.load();
    const current = data.projects[projectId];
    const knownDirectory = current?.cwd === cwd ? current.sessionDirectory : null;
    const fingerprintBeforeScan = fingerprintSessionDirectory(knownDirectory);
    const sessions = (await SessionManager.list(cwd)).map(
      (session): IndexedSession => ({
        id: session.id,
        projectId,
        title: session.name || session.firstMessage || "新会话",
        createdAt: session.created.getTime(),
        updatedAt: session.modified.getTime(),
        messageCount: session.messageCount,
        preview: session.firstMessage,
        archived: false,
        running: false,
        path: session.path,
      }),
    );
    sessions.sort((left, right) => right.updatedAt - left.updatedAt);
    const sessionDirectory = knownDirectory ?? (sessions[0] ? dirname(sessions[0].path) : null);
    const project = {
      cwd,
      sessionDirectory,
      directoryFingerprint: fingerprintBeforeScan,
      sessions,
    };
    data.projects[projectId] = project;
    this.persist();
    return project;
  }

  private async requireProject(projectId: string, cwd: string): Promise<IndexedProject> {
    const project = this.load().projects[projectId];
    if (this.isProjectFresh(project, cwd)) return project;
    return this.rebuild(projectId, cwd);
  }

  private isProjectFresh(project: IndexedProject | undefined, cwd: string): project is IndexedProject {
    return (
      project?.cwd === cwd &&
      project.directoryFingerprint !== null &&
      fingerprintSessionDirectory(project.sessionDirectory) === project.directoryFingerprint
    );
  }

  private load(): StoredIndex {
    if (this.data) return this.data;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (isStoredIndex(parsed)) {
        this.data = parsed;
        return parsed;
      }
    } catch {
      // Missing and corrupt indexes are rebuilt lazily per project.
    }
    this.data = { version: INDEX_VERSION, projects: {} };
    return this.data;
  }

  private persist(): void {
    const data = this.load();
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, this.path);
  }
}

function isStoredIndex(value: unknown): value is StoredIndex {
  if (!isRecord(value) || value.version !== INDEX_VERSION || !isRecord(value.projects)) return false;
  return Object.values(value.projects).every(
    (project) =>
      isRecord(project) &&
      typeof project.cwd === "string" &&
      (typeof project.sessionDirectory === "string" || project.sessionDirectory === null) &&
      (typeof project.directoryFingerprint === "string" || project.directoryFingerprint === null) &&
      Array.isArray(project.sessions) &&
      project.sessions.every(isIndexedSession),
  );
}

function isIndexedSession(value: unknown): value is IndexedSession {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.title === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    typeof value.messageCount === "number" &&
    typeof value.preview === "string" &&
    typeof value.archived === "boolean" &&
    typeof value.running === "boolean" &&
    typeof value.path === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fingerprintSessionDirectory(directory: string | null): string | null {
  if (directory === null) return null;
  try {
    const entries = readdirSync(directory)
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
    const hash = createHash("sha256");
    for (const name of entries) {
      const stats = statSync(join(directory, name), { bigint: true });
      hash.update(name);
      hash.update("\0");
      hash.update(stats.dev.toString());
      hash.update("\0");
      hash.update(stats.ino.toString());
      hash.update("\0");
      hash.update(stats.size.toString());
      hash.update("\0");
      hash.update(stats.mtimeNs.toString());
      hash.update("\0");
      hash.update(stats.ctimeNs.toString());
      hash.update("\0");
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}
