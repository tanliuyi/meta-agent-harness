import { readFileSync } from "node:fs";
import { type AgentSession, VERSION } from "@earendil-works/pi-coding-agent";
import type {
  ClearedQueue,
  SessionBranchInput,
  SessionBranchResult,
  SessionCommandResult,
  SessionEditInput,
  SessionPromptInput,
  SessionReloadInput,
} from "../../shared/contracts.ts";
import type { PiThreadProjector } from "./pi-thread-projector.ts";

interface CompatibilityAdapterOptions {
  session: AgentSession;
  projector: PiThreadProjector;
}

/** 集中封装 Desktop 对 Pi public API 的全部调用。 */
export class PiCompatibilityAdapter {
  private readonly session: AgentSession;
  private readonly projector: PiThreadProjector;

  constructor(options: CompatibilityAdapterOptions) {
    assertCompatiblePi(options.session);
    this.session = options.session;
    this.projector = options.projector;
  }

  prompt(input: SessionPromptInput): Promise<SessionCommandResult> {
    return this.submit(input, true);
  }

  async edit(input: SessionEditInput): Promise<SessionCommandResult> {
    const entry = this.session.sessionManager.getEntry(input.sourceId);
    if (entry?.type !== "message" || entry.message.role !== "user")
      throw new Error(`Pi edit 目标不是 user entry: ${input.sourceId}`);
    return this.navigateAndSubmit(input.sourceId, input, true);
  }

  async reload(input: SessionReloadInput): Promise<SessionCommandResult> {
    if (!input.parentId) throw new Error("Pi reload 缺少前置 user entry");
    const entry = this.session.sessionManager.getEntry(input.parentId);
    if (entry?.type !== "message" || entry.message.role !== "user")
      throw new Error(`Pi reload 前置节点不是 user entry: ${input.parentId}`);
    const { text, images } = userInput(entry.message.content);
    return this.navigateAndSubmit(
      input.parentId,
      {
        requestId: input.requestId,
        projectId: input.projectId,
        threadId: input.threadId,
        text,
        images,
      },
      false,
    );
  }

  /** 在指定 entry 处创建新 session 文件并返回新会话 id + 文件路径。 */
  async branch(input: SessionBranchInput): Promise<SessionBranchResult> {
    const manager = this.session.sessionManager;
    if (!manager.isPersisted()) throw new Error("只能 fork 已持久化的 session");
    const entry = manager.getEntry(input.sourceEntryId);
    if (!entry) throw new Error(`Pi branch 目标 entry 不存在: ${input.sourceEntryId}`);
    // createBranchedSession 复制 root→leaf 入新文件，等价 Runtime.fork position="at"。
    const branchSessionFile = manager.createBranchedSession(input.sourceEntryId);
    if (!branchSessionFile) throw new Error("Pi createBranchedSession 未生成新 session 文件");
    const header = readSessionHeader(branchSessionFile);
    if (!header) throw new Error(`Pi branch 新 session 文件 header 无效: ${branchSessionFile}`);
    return { branchThreadId: header.id, branchSessionFile };
  }

  async cancel(): Promise<void> {
    const phase = this.projector.snapshot().phase;
    if (phase === "compacting") {
      this.session.abortCompaction();
      return;
    }
    if (phase === "tree-navigation") {
      this.session.abortBranchSummary();
      return;
    }
    if (phase === "running" || phase === "retrying") {
      await this.session.abort();
      return;
    }
    throw new Error("Pi session 当前没有可取消操作");
  }

  clearQueue(): ClearedQueue {
    this.projector.beginQueueClear();
    try {
      return this.session.clearQueue();
    } finally {
      this.projector.endQueueClear();
    }
  }

  async compact(): Promise<void> {
    await this.session.compact();
  }

  synchronizePersistedBranch(): void {
    this.projector.checkpoint();
    this.projector.flush();
  }

  private async navigateAndSubmit(
    targetId: string,
    input: SessionPromptInput,
    expandPromptTemplates: boolean,
  ): Promise<SessionCommandResult> {
    const oldLeaf = this.session.sessionManager.getLeafId();
    await this.navigate(targetId, "Pi extension 取消了 tree navigation", true);
    try {
      return await this.submit(input, expandPromptTemplates);
    } catch (error) {
      if (oldLeaf && this.session.sessionManager.getEntry(oldLeaf)) {
        await this.navigate(oldLeaf, `Pi branch 恢复被取消: ${errorMessage(error)}`);
      }
      throw error;
    }
  }

  private async navigate(targetId: string, cancelledMessage: string, requireUserRewind = false): Promise<void> {
    this.projector.beginTreeNavigation();
    try {
      const navigation = await this.session.navigateTree(targetId, { summarize: false });
      if (navigation.cancelled) throw new Error(cancelledMessage);
      if (requireUserRewind && navigation.editorText === undefined)
        throw new Error(`Pi navigateTree 未回退 user entry: ${targetId}`);
    } finally {
      this.projector.endTreeNavigation();
    }
  }

  private async submit(input: SessionPromptInput, expandPromptTemplates: boolean): Promise<SessionCommandResult> {
    let accepted = false;
    const queueEligible = this.session.isStreaming;
    if (queueEligible && input.text.trim().length === 0) throw new Error("Pi running queue 不接受仅包含图片的输入");
    this.projector.beginPrompt(input.requestId, input.desiredMode, queueEligible);
    try {
      await this.session.prompt(input.text, {
        images: input.images.map(({ data, mimeType }) => ({ type: "image", data, mimeType })),
        expandPromptTemplates,
        source: expandPromptTemplates ? "interactive" : "extension",
        ...(queueEligible ? { streamingBehavior: input.desiredMode ?? "followUp" } : {}),
        preflightResult: (success) => {
          accepted = success;
          this.projector.markPromptPreflight(input.requestId, success);
        },
      });
      if (!accepted) throw new Error("Pi prompt resolved without preflight acceptance");
      return { accepted, queued: this.projector.hasQueuedRequest(input.requestId) };
    } catch (error) {
      if (accepted)
        return {
          accepted: true,
          queued: this.projector.hasQueuedRequest(input.requestId),
          error: errorMessage(error),
        };
      throw error;
    } finally {
      this.projector.finishPrompt(input.requestId);
    }
  }
}

export class UnsupportedPiCodingAgentError extends Error {
  constructor(missing: readonly string[]) {
    super(`不兼容的 pi-coding-agent ${VERSION}: 缺少 ${missing.join(", ")}`);
    this.name = "UnsupportedPiCodingAgentError";
  }
}

function assertCompatiblePi(session: AgentSession): void {
  const required = [
    "prompt",
    "sendUserMessage",
    "abort",
    "clearQueue",
    "getSteeringMessages",
    "getFollowUpMessages",
    "navigateTree",
    "compact",
    "abortCompaction",
    "abortBranchSummary",
    "subscribe",
  ] as const;
  const missing: string[] = required.filter((key) => typeof session[key] !== "function");
  if (typeof session.isStreaming !== "boolean") missing.push("isStreaming");
  const manager = session.sessionManager as unknown;
  if (!manager || typeof manager !== "object") {
    missing.push("sessionManager");
  } else {
    const managerSurface = manager as Record<string, unknown>;
    for (const key of [
      "getLeafId",
      "getBranch",
      "getEntry",
      "getLabel",
      "getSessionDir",
      "getCwd",
      "getHeader",
      "isPersisted",
      "createBranchedSession",
    ] as const)
      if (typeof managerSurface[key] !== "function") missing.push(`sessionManager.${key}`);
  }
  if (missing.length > 0) throw new UnsupportedPiCodingAgentError(missing);
}

function userInput(content: Extract<AgentSession["messages"][number], { role: "user" }>["content"]): {
  text: string;
  images: Array<{ name: string; data: string; mimeType: string }>;
} {
  if (typeof content === "string") return { text: content, images: [] };
  return {
    text: content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
    images: content.flatMap((part, index) =>
      part.type === "image" ? [{ name: `image-${index + 1}`, data: part.data, mimeType: part.mimeType }] : [],
    ),
  };
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** 读取 fork 出来的新 session 文件首行 header，避免为了一个 id 加载整份 jsonl。 */
function readSessionHeader(path: string): { id: string } | null {
  let firstLine = "";
  try {
    const content = readFileSync(path, "utf8");
    firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  } catch {
    return null;
  }
  if (!firstLine) return null;
  try {
    const parsed: unknown = JSON.parse(firstLine);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      parsed.type === "session" &&
      "id" in parsed &&
      typeof (parsed as { id: unknown }).id === "string"
    )
      return { id: (parsed as { id: string }).id };
  } catch {
    return null;
  }
  return null;
}
