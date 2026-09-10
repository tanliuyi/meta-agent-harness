import { realpath, rm, stat } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveGitWorktree } from "../main/git-worktrees.ts";
import { samePath } from "../main/path-identity.ts";
import { validateResolvedExtensionSet } from "../main/pi/desktop-extension-runtime-policy.ts";
import { materializeDesktopSession } from "../main/pi/desktop-session-persistence.ts";
import { removeMainAgentSessionSnapshot, writeMainAgentSessionSnapshot } from "../main/pi/main-agent-session-store.ts";
import { SessionRuntime } from "../main/pi/session-runtime.ts";
import { getRegisteredSubagentChildExtensions } from "../main/pi/subagents/child-extension-registry.ts";
import { DesktopSubagentRuntime } from "../main/pi/subagents/desktop-subagent-runtime.ts";
import type {
  SidecarBinding,
  SidecarCommand,
  ThreadSidecarCommand,
  ThreadWorkerBinding,
} from "../shared/sidecar-contracts.ts";
import { resolveDesktopSessionDirectory } from "./desktop-session-directory.ts";
import { readSessionFileHeader } from "./session-file-header.ts";
import type { SidecarService, SidecarServiceContext } from "./sidecar-host.ts";

export class ThreadWorkerService implements SidecarService {
  private readonly runtime: SessionRuntime;
  private modelConfigurationGeneration = 0;

  private constructor(runtime: SessionRuntime) {
    this.runtime = runtime;
  }

  static async create(
    binding: SidecarBinding,
    context: SidecarServiceContext,
  ): Promise<{ service: ThreadWorkerService; readyResult: unknown }> {
    if (binding.role !== "thread") throw new Error(`Thread worker received ${binding.role} binding`);
    const input = binding.value;
    const extensionSet = await validateResolvedExtensionSet(input.projectId, input.extensionSet);
    const createSessionId = input.mode === "create" ? input.sessionId : undefined;
    let sessionManager: SessionManager | undefined;
    const sessionDir = resolveDesktopSessionDirectory(input.projectId, input.agentDir);
    if (input.mode === "create") {
      const cwd = await resolveCreateCwd(input.projectCwd, input.cwd);
      sessionManager = SessionManager.create(cwd, sessionDir, {
        id: createSessionId,
        ...(input.parentSessionFile ? { parentSession: input.parentSessionFile } : {}),
      });
    } else {
      const header = await readSessionFileHeader(input.sessionFile, input.projectId, input.threadId);
      if (header.cwd !== input.sessionHeaderCwd) {
        throw new Error(`Session cwd changed before open: ${input.projectId}/${input.threadId}`);
      }
      sessionManager = SessionManager.open(header.sessionFile, sessionDir, input.cwd);
      if (sessionManager.getSessionId() !== input.threadId) {
        throw new Error(`Session identity changed before open: ${input.projectId}/${input.threadId}`);
      }
    }
    let createdSnapshotFile: string | undefined;
    if (input.mode === "create") {
      const sessionFile = sessionManager.getSessionFile();
      if (!sessionFile) throw new Error("Created session did not allocate a session file");
      try {
        await writeMainAgentSessionSnapshot(sessionFile, input.mainAgentSnapshot);
        // Discovery must never observe a new session without its policy snapshot.
        await materializeDesktopSession(sessionManager);
      } catch (error) {
        await rm(sessionFile, { force: true });
        await removeMainAgentSessionSnapshot(sessionFile);
        throw error;
      }
      createdSnapshotFile = sessionFile;
    }
    const cwd = sessionManager.getCwd();
    const parentThreadId = input.mode === "create" ? input.sessionId : input.threadId;
    const approvedChildExtensionPaths = new Set(
      extensionSet.entries.flatMap((entry) => (entry.entryPath ? [entry.entryPath] : [])),
    );
    const subagentRuntime = new DesktopSubagentRuntime({
      projectId: input.projectId,
      parentThreadId,
      getChildExtensions: () =>
        getRegisteredSubagentChildExtensions().filter((extension) => approvedChildExtensionPaths.has(extension.path)),
      requestHost: context.requestHost,
    });
    let runtime: SessionRuntime;
    try {
      runtime = await SessionRuntime.create({
        projectId: input.projectId,
        cwd,
        agentDir: input.agentDir,
        ...(input.shellPath ? { shellPath: input.shellPath } : {}),
        sessionManager,
        ...(input.mode === "open" && input.initialUpdatedAt !== undefined
          ? { initialUpdatedAt: input.initialUpdatedAt }
          : {}),
        createInput: input.mode === "create" ? input.createInput : undefined,
        mainAgentSnapshot: input.mainAgentSnapshot,
        extensionSet,
        subagentRuntime,
        push: (payload) => context.emit({ type: "session-push", payload }),
        onSummaryChanged: (current) => context.emit({ type: "summary-changed", summary: current.threadSummary(false) }),
      });
    } catch (error) {
      try {
        if (createdSnapshotFile) {
          // Keep the policy if removing the discoverable JSONL fails.
          await rm(createdSnapshotFile, { force: true });
          await removeMainAgentSessionSnapshot(createdSnapshotFile);
        }
      } finally {
        await subagentRuntime.dispose();
      }
      throw error;
    }
    if (input.mode === "create") {
      const sessionFile = sessionManager?.getSessionFile();
      if (!sessionFile) {
        await runtime.dispose();
        throw new Error("Created session did not materialize a session file");
      }
      context.emit({
        type: "session-materialized",
        projectId: input.projectId,
        sessionId: input.sessionId,
        sessionFile,
      });
    }
    if (input.mode === "open" && runtime.id !== input.threadId) {
      await runtime.dispose();
      throw new Error(`Opened session ID mismatch: expected ${input.threadId}, got ${runtime.id}`);
    }
    return {
      service: new ThreadWorkerService(runtime),
      readyResult: runtime.bootstrap(),
    };
  }

  async command(command: SidecarCommand): Promise<unknown> {
    return this.threadCommand(command as ThreadSidecarCommand);
  }

  async dispose(): Promise<void> {
    await this.runtime.dispose();
  }

  private async threadCommand(command: ThreadSidecarCommand): Promise<unknown> {
    switch (command.type) {
      case "bootstrap":
        return this.runtime.bootstrap();
      case "prompt":
        return this.runtime.prompt(command.input);
      case "edit":
        return this.runtime.edit(command.input);
      case "reload":
        return this.runtime.reload(command.input);
      case "getPluginRuntime":
        return this.runtime.pluginRuntime(command.pluginId);
      case "reloadResources":
        return this.runtime.reloadResources();
      case "runGoalAction":
        return this.runtime.runGoalAction(command.action);
      case "getCheckpointDiff":
        return this.runtime.getCheckpointDiff(command.fromCheckpointId, command.toCheckpointId, command.path);
      case "restoreCheckpoint":
        return this.runtime.restoreCheckpoint(command.checkpointId, command.expectedCheckpointId);
      case "branch":
        return this.runtime.branch(command.input);
      case "cancel":
        return this.runtime.cancel();
      case "clearQueue":
        return this.runtime.clearQueue();
      case "compact":
        await this.runtime.compact();
        return null;
      case "refreshModels":
        await this.runtime.refreshModels();
        return null;
      case "refreshModelConfiguration":
        if (command.revision.generation <= this.modelConfigurationGeneration) return null;
        await this.runtime.refreshModels();
        this.modelConfigurationGeneration = command.revision.generation;
        return null;
      case "setModel":
        await this.runtime.setModel(command.provider, command.modelId);
        return null;
      case "setThinking":
        this.runtime.setThinking(command.level);
        return null;
      case "rename":
        this.runtime.rename(command.title);
        return null;
      case "getImageResource":
        return this.runtime.readImageResource(command.resourceId);
      case "resolveRunCodeArtifact":
        return this.runtime.resolveRunCodeArtifact(command.toolCallId, command.artifactId);
      case "configureWidget":
        this.runtime.configureWidget(command.viewport);
        return null;
      case "respondHostUi":
        this.runtime.respond(command.response);
        return null;
      case "getSummary":
        return this.runtime.threadSummary(command.archived);
      case "ping":
        return { pong: true };
    }
  }
}

async function resolveCreateCwd(projectCwd: string, candidate: string): Promise<string> {
  if (!samePath(projectCwd, candidate)) return resolveGitWorktree(projectCwd, candidate);
  const [canonicalProjectCwd, canonicalCandidate] = await Promise.all([realpath(projectCwd), realpath(candidate)]);
  if (!samePath(canonicalProjectCwd, canonicalCandidate) || !(await stat(canonicalCandidate)).isDirectory()) {
    throw new Error("Session cwd is no longer the selected Project directory");
  }
  return canonicalCandidate;
}

export function threadWorkerBinding(value: ThreadWorkerBinding): SidecarBinding {
  return { role: "thread", value };
}
