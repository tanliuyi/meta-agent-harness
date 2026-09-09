import { randomUUID } from "node:crypto";
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionUINotificationOptions,
  ExtensionWidgetOptions,
} from "@earendil-works/pi-coding-agent";
import type { DesktopExtensionHostState, HostRequest, HostResponse } from "../../shared/contracts.ts";
import type {
  DesktopNativeWidgetContent,
  DesktopSubagentWidgetContent,
  DesktopSubagentWidgetNode,
  DesktopTodoWidgetContent,
  DesktopWidgetViewport,
} from "../../shared/desktop-extension-contracts.ts";
import {
  type QuestionnaireUI,
  readQuestionnaireResult,
  validateQuestionnaireInput,
} from "../../shared/questionnaire-contracts.ts";
import { DesktopWidgetAdapter } from "./desktop-widget-adapter.ts";

interface DesktopWidgetOptions extends ExtensionWidgetOptions {
  nativeContent?: unknown;
}

const TODO_WIDGET_TASK_LIMIT = 40;
const TODO_WIDGET_TEXT_LIMIT = 500;
const TODO_WIDGET_COUNT_LIMIT = 10_000;
const SUBAGENT_WIDGET_NODE_LIMIT = 80;
const SUBAGENT_WIDGET_CHILD_LIMIT = 8;
const SUBAGENT_WIDGET_DEPTH_LIMIT = 3;
const SUBAGENT_WIDGET_TEXT_LIMIT = 160;

function normalizeTodoWidgetContent(value: unknown): DesktopTodoWidgetContent | undefined {
  if (!isRecord(value) || value.type !== "todo" || value.version !== 1) return undefined;
  const summary = value.summary;
  if (
    !isRecord(summary) ||
    !isTodoWidgetCount(summary.total) ||
    !isTodoWidgetCount(summary.completed) ||
    !isTodoWidgetCount(summary.pending) ||
    !isTodoWidgetCount(summary.inProgress) ||
    summary.total !== summary.completed + summary.pending + summary.inProgress
  ) {
    return undefined;
  }
  const labels = value.labels;
  if (
    !isRecord(labels) ||
    !isTodoWidgetLabel(labels.heading) ||
    !isTodoWidgetLabel(labels.more) ||
    !isRecord(labels.statuses) ||
    !isTodoWidgetLabel(labels.statuses.pending) ||
    !isTodoWidgetLabel(labels.statuses.inProgress) ||
    !isTodoWidgetLabel(labels.statuses.completed)
  ) {
    return undefined;
  }
  if (!Array.isArray(value.tasks) || value.tasks.length > TODO_WIDGET_TASK_LIMIT) return undefined;
  const ids = new Set<number>();
  const visibleCounts = { completed: 0, pending: 0, inProgress: 0 };
  const tasks: DesktopTodoWidgetContent["tasks"] = [];
  for (const task of value.tasks) {
    if (
      !isRecord(task) ||
      !Number.isSafeInteger(task.id) ||
      (task.id as number) < 1 ||
      ids.has(task.id as number) ||
      typeof task.subject !== "string" ||
      !task.subject.trim() ||
      task.subject.length > TODO_WIDGET_TEXT_LIMIT ||
      (task.status !== "pending" && task.status !== "in_progress" && task.status !== "completed") ||
      (task.activeForm !== undefined &&
        (typeof task.activeForm !== "string" || task.activeForm.length > TODO_WIDGET_TEXT_LIMIT)) ||
      (task.blockedBy !== undefined &&
        (!Array.isArray(task.blockedBy) ||
          task.blockedBy.length > TODO_WIDGET_TASK_LIMIT ||
          !task.blockedBy.every((id) => Number.isSafeInteger(id) && id >= 1)))
    ) {
      return undefined;
    }
    ids.add(task.id as number);
    if (task.status === "in_progress") visibleCounts.inProgress++;
    else visibleCounts[task.status]++;
    tasks.push({
      id: task.id as number,
      subject: task.subject,
      status: task.status,
      ...(task.activeForm ? { activeForm: task.activeForm } : {}),
      ...(task.blockedBy?.length ? { blockedBy: [...task.blockedBy] as number[] } : {}),
    });
  }
  if (
    !isTodoWidgetCount(value.hiddenTaskCount) ||
    tasks.length + value.hiddenTaskCount !== summary.total ||
    visibleCounts.completed > summary.completed ||
    visibleCounts.pending > summary.pending ||
    visibleCounts.inProgress > summary.inProgress
  ) {
    return undefined;
  }
  return {
    type: "todo",
    version: 1,
    summary: {
      total: summary.total,
      completed: summary.completed,
      pending: summary.pending,
      inProgress: summary.inProgress,
    },
    labels: {
      heading: labels.heading,
      more: labels.more,
      statuses: {
        pending: labels.statuses.pending,
        inProgress: labels.statuses.inProgress,
        completed: labels.statuses.completed,
      },
    },
    tasks,
    hiddenTaskCount: value.hiddenTaskCount,
  };
}

function normalizeSubagentWidgetContent(value: unknown): DesktopSubagentWidgetContent | undefined {
  if (
    !isRecord(value) ||
    value.type !== "subagents" ||
    value.version !== 1 ||
    (value.source !== "fleet" && value.source !== "async") ||
    !isSubagentWidgetTime(value.generatedAt) ||
    !isRecord(value.summary) ||
    !isSubagentWidgetCount(value.summary.activeAgents) ||
    !isSubagentWidgetCount(value.summary.asyncRunsUsed) ||
    !isSubagentWidgetCount(value.summary.asyncRunsLimit) ||
    !isSubagentWidgetCount(value.summary.totalTokens) ||
    !isSubagentWidgetCount(value.omittedNodeCount) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 20
  ) {
    return undefined;
  }
  const budget = { count: 0 };
  const nodes: DesktopSubagentWidgetNode[] = [];
  for (const node of value.nodes) {
    const normalized = normalizeSubagentWidgetNode(node, 0, budget);
    if (!normalized) return undefined;
    nodes.push(normalized);
  }
  return {
    type: "subagents",
    version: 1,
    source: value.source,
    generatedAt: value.generatedAt,
    summary: {
      activeAgents: value.summary.activeAgents,
      asyncRunsUsed: value.summary.asyncRunsUsed,
      asyncRunsLimit: value.summary.asyncRunsLimit,
      totalTokens: value.summary.totalTokens,
    },
    nodes,
    omittedNodeCount: value.omittedNodeCount,
  };
}

function normalizeSubagentWidgetNode(
  value: unknown,
  depth: number,
  budget: { count: number },
): DesktopSubagentWidgetNode | undefined {
  if (!isRecord(value) || depth > SUBAGENT_WIDGET_DEPTH_LIMIT || ++budget.count > SUBAGENT_WIDGET_NODE_LIMIT) {
    return undefined;
  }
  const kinds = ["subagent", "workflow", "step", "host-step", "external", "project-pane"];
  if (
    typeof value.kind !== "string" ||
    !kinds.includes(value.kind) ||
    !isSubagentWidgetText(value.id) ||
    !isSubagentWidgetText(value.label) ||
    !isSubagentWidgetText(value.state) ||
    !isOptionalSubagentWidgetText(value.runId) ||
    !isOptionalSubagentWidgetText(value.modelThinking) ||
    !isOptionalSubagentWidgetText(value.description) ||
    !isOptionalSubagentWidgetText(value.activity) ||
    !isOptionalSubagentWidgetTime(value.startedAt) ||
    !isOptionalSubagentWidgetTime(value.updatedAt) ||
    !isOptionalSubagentWidgetTime(value.endedAt) ||
    !isOptionalSubagentWidgetCount(value.tokens) ||
    !isOptionalSubagentWidgetCount(value.window) ||
    !isOptionalSubagentWidgetCount(value.toolCount) ||
    !isOptionalSubagentWidgetCount(value.turnCount) ||
    (value.verdict !== undefined &&
      value.verdict !== "pass" &&
      value.verdict !== "fail" &&
      value.verdict !== "inconclusive") ||
    (value.children !== undefined &&
      (!Array.isArray(value.children) || value.children.length > SUBAGENT_WIDGET_CHILD_LIMIT))
  ) {
    return undefined;
  }
  const children: DesktopSubagentWidgetNode[] = [];
  for (const child of value.children ?? []) {
    const normalized = normalizeSubagentWidgetNode(child, depth + 1, budget);
    if (!normalized) return undefined;
    children.push(normalized);
  }
  return {
    id: value.id,
    kind: value.kind as DesktopSubagentWidgetNode["kind"],
    label: value.label,
    state: value.state,
    ...(value.runId ? { runId: value.runId } : {}),
    ...(value.modelThinking ? { modelThinking: value.modelThinking } : {}),
    ...(value.description ? { description: value.description } : {}),
    ...(value.activity ? { activity: value.activity } : {}),
    ...(value.startedAt !== undefined ? { startedAt: value.startedAt } : {}),
    ...(value.updatedAt !== undefined ? { updatedAt: value.updatedAt } : {}),
    ...(value.endedAt !== undefined ? { endedAt: value.endedAt } : {}),
    ...(value.tokens !== undefined ? { tokens: value.tokens } : {}),
    ...(value.window !== undefined ? { window: value.window } : {}),
    ...(value.toolCount !== undefined ? { toolCount: value.toolCount } : {}),
    ...(value.turnCount !== undefined ? { turnCount: value.turnCount } : {}),
    ...(value.verdict !== undefined ? { verdict: value.verdict } : {}),
    ...(children.length ? { children } : {}),
  };
}

function normalizeNativeWidgetContent(value: unknown): DesktopNativeWidgetContent | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "todo") return normalizeTodoWidgetContent(value);
  if (value.type === "subagents") return normalizeSubagentWidgetContent(value);
  return undefined;
}

function isSubagentWidgetText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= SUBAGENT_WIDGET_TEXT_LIMIT;
}

function isOptionalSubagentWidgetText(value: unknown): value is string | undefined {
  return value === undefined || isSubagentWidgetText(value);
}

function isSubagentWidgetCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOptionalSubagentWidgetCount(value: unknown): value is number | undefined {
  return value === undefined || isSubagentWidgetCount(value);
}

function isSubagentWidgetTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOptionalSubagentWidgetTime(value: unknown): value is number | undefined {
  return value === undefined || isSubagentWidgetTime(value);
}

function isTodoWidgetCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= TODO_WIDGET_COUNT_LIMIT;
}

function isTodoWidgetLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface PendingRequest {
  request: HostRequest;
  resolve(response: HostResponse): void;
  reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
}

const EMPTY_HOST_STATE: DesktopExtensionHostState = { statuses: {}, widgets: [] };

export class DesktopExtensionCompatibilityError extends Error {
  readonly code: "DESKTOP_EXTENSION_CAPABILITY_UNAVAILABLE" | "DESKTOP_EXTENSION_HOST_DISPOSED";
  readonly capability: string;

  constructor(
    code: "DESKTOP_EXTENSION_CAPABILITY_UNAVAILABLE" | "DESKTOP_EXTENSION_HOST_DISPOSED",
    capability: string,
  ) {
    super(
      code === "DESKTOP_EXTENSION_HOST_DISPOSED"
        ? `Desktop extension host is disposed: ${capability}`
        : `Desktop extension capability is unavailable: ${capability}`,
    );
    this.name = "DesktopExtensionCompatibilityError";
    this.code = code;
    this.capability = capability;
  }
}

/**
 * Declarative Desktop Host Profile v1 for controlled Pi extensions.
 *
 * Unsupported display-only surfaces degrade to a warning plus a defined no-op
 * so extension tool chains are not interrupted. Session-changing actions
 * (`session.reload`, `session.replace`) and dialogs on a disposed host keep
 * failing with a stable error instead.
 */
export class DesktopExtensionHost {
  private readonly pending = new Map<string, PendingRequest>();
  private state: DesktopExtensionHostState = EMPTY_HOST_STATE;
  private readonly hostId = randomUUID();
  private readonly widgetAdapter: DesktopWidgetAdapter;
  private composerRevision = 0;
  private disposed = false;
  private readonly changed: () => void;
  private readonly activeToolIds: () => string[];
  private readonly publishNotification: (
    message: string,
    type: "info" | "warning" | "error",
    options?: ExtensionUINotificationOptions,
  ) => void;
  private readonly warn: (message: string) => void;

  constructor(
    changed: () => void,
    activeToolIds: () => string[],
    publishNotification: (
      message: string,
      type: "info" | "warning" | "error",
      options?: ExtensionUINotificationOptions,
    ) => void = () => undefined,
    warn: (message: string) => void = () => undefined,
  ) {
    this.changed = changed;
    this.activeToolIds = activeToolIds;
    this.publishNotification = publishNotification;
    this.warn = warn;
    this.widgetAdapter = new DesktopWidgetAdapter(
      this.hostId,
      (widget) => {
        const widgets = this.state.widgets.filter((current) => current.key !== widget.key);
        this.patch("ui.widget.text", { widgets: [...widgets, widget] });
      },
      warn,
    );
  }

  get requests(): HostRequest[] {
    return [...this.pending.values()].map(({ request }) => request);
  }

  get hostState(): DesktopExtensionHostState {
    return this.state;
  }

  createContext(): ExtensionUIContext &
    QuestionnaireUI & {
      widgetCapabilities: { components: true; input: false; nativeContent: true };
    } {
    const host = this;
    return {
      widgetCapabilities: { components: true, input: false, nativeContent: true },
      questionnaire: (input, opts) => {
        validateQuestionnaireInput(input);
        return this.ask(
          "questionnaire",
          "Questionnaire",
          { questionnaire: structuredClone(input) },
          opts,
          (response) => response.questionnaire ?? { answers: [], cancelled: true },
        );
      },
      select: (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
        this.ask("select", title, { options }, opts, (response) => response.value),
      confirm: (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
        this.ask("confirm", title, { message }, opts, (response) => response.confirmed ?? false),
      input: (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) =>
        this.ask("input", title, { placeholder }, opts, (response) => response.value),
      editor: (title: string, prefill?: string) =>
        this.ask("editor", title, { message: prefill }, undefined, (response) => response.value),
      notify: (message: string, type?: "info" | "warning" | "error", options?: ExtensionUINotificationOptions) =>
        this.notify(message, type, options),
      onTerminalInput: () => {
        this.degrade("ui.terminal.input");
        return () => undefined;
      },
      setStatus: (key: string, text: string | undefined) => this.setStatus(key, text),
      setWorkingMessage: (message?: string) =>
        this.patch("ui.working", {
          working: { ...this.state.working, message, visible: this.state.working?.visible ?? true },
        }),
      setWorkingVisible: (visible: boolean) =>
        this.patch("ui.working", { working: { ...this.state.working, visible } }),
      setWorkingIndicator: () => this.degrade("ui.working", "working indicator frames are not supported"),
      setHiddenThinkingLabel: () => this.degrade("ui.working", "hidden thinking labels are not supported"),
      setWidget: (key: string, content: unknown, options?: ExtensionWidgetOptions) =>
        this.setWidget(key, content, options as DesktopWidgetOptions | undefined),
      setFooter: () => this.degrade("ui.tui.chrome", "custom footer components are not supported"),
      setHeader: () => this.degrade("ui.tui.chrome", "custom header components are not supported"),
      setTitle: (title: string) => this.patch("ui.title", { windowTitle: title }),
      custom: async <T>() => {
        this.degrade("ui.tui.custom");
        return undefined as T;
      },
      pasteToEditor: (text: string) => this.sendComposerCommand("append", text),
      setEditorText: (text: string) => this.sendComposerCommand("replace", text),
      getEditorText: () => {
        this.degrade("ui.composer.read");
        return undefined as unknown as string;
      },
      addAutocompleteProvider: () => this.degrade("ui.tui.editor", "autocomplete providers are not supported"),
      setEditorComponent: () => this.degrade("ui.tui.editor", "custom editor components are not supported"),
      getEditorComponent: () => {
        this.degrade("ui.tui.editor", "custom editor components are not supported");
        return undefined;
      },
      get theme() {
        return host.widgetAdapter.theme;
      },
      getAllThemes: () => {
        this.degrade("ui.tui.theme");
        return [];
      },
      getTheme: () => {
        this.degrade("ui.tui.theme");
        return undefined;
      },
      setTheme: () => {
        this.degrade("ui.tui.theme", "themes are not supported");
        return { success: false, error: "Desktop does not support extension themes" };
      },
      getToolsExpanded: () => {
        this.degrade("ui.tui.chrome");
        return false;
      },
      setToolsExpanded: () => this.degrade("ui.tui.chrome"),
    };
  }

  respond(response: HostResponse): void {
    this.assertActive("ui.dialog");
    const item = this.pending.get(response.requestId);
    if (!item) throw new Error(`Extension UI request does not exist: ${response.requestId}`);
    if (item.request.questionnaire) {
      response = {
        ...response,
        questionnaire: readQuestionnaireResult(
          item.request.questionnaire,
          response.dismissed ? { answers: [], cancelled: true } : response.questionnaire,
        ),
      };
    }
    this.pending.delete(response.requestId);
    if (item.timer) clearTimeout(item.timer);
    item.removeAbortListener?.();
    item.resolve(response);
    this.changed();
  }

  reset(): void {
    this.assertActive("ui.dialog");
    const error = new Error("Desktop extension host request became stale after reload");
    for (const item of this.pending.values()) {
      if (item.timer) clearTimeout(item.timer);
      item.removeAbortListener?.();
      item.reject(error);
    }
    this.pending.clear();
    this.widgetAdapter.clear();
    this.state = EMPTY_HOST_STATE;
    this.changed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.widgetAdapter.clear();
    this.disposed = true;
    const error = new DesktopExtensionCompatibilityError("DESKTOP_EXTENSION_HOST_DISPOSED", "ui.dialog");
    for (const item of this.pending.values()) {
      if (item.timer) clearTimeout(item.timer);
      item.removeAbortListener?.();
      item.reject(error);
    }
    this.pending.clear();
  }

  private ask<T>(
    type: HostRequest["type"],
    title: string,
    details: Partial<HostRequest>,
    opts: ExtensionUIDialogOptions | undefined,
    read: (response: HostResponse) => T,
  ): Promise<T> {
    this.assertActive("ui.dialog");
    const id = randomUUID();
    const toolIds = this.activeToolIds();
    const request: HostRequest = {
      id,
      type,
      title,
      createdAt: Date.now(),
      toolCallId: toolIds.length === 1 ? toolIds[0] : undefined,
      ...details,
    };
    return new Promise<T>((resolve, reject) => {
      const item: PendingRequest = { request, resolve: (response) => resolve(read(response)), reject };
      if (opts?.signal) {
        if (opts.signal.aborted) {
          reject(new DOMException("Extension UI request aborted", "AbortError"));
          return;
        }
        const signal = opts.signal;
        const abort = () => this.cancel(id);
        signal.addEventListener("abort", abort, { once: true });
        item.removeAbortListener = () => signal.removeEventListener("abort", abort);
      }
      if (opts?.timeout) item.timer = setTimeout(() => this.cancel(id), opts.timeout);
      this.pending.set(id, item);
      this.changed();
    });
  }

  private notify(message: string, type?: "info" | "warning" | "error", options?: ExtensionUINotificationOptions): void {
    this.assertActive("ui.notify");
    if (options) this.publishNotification(message, type ?? "info", options);
    else this.publishNotification(message, type ?? "info");
  }

  private cancel(id: string): void {
    const item = this.pending.get(id);
    if (!item) return;
    this.pending.delete(id);
    if (item.timer) clearTimeout(item.timer);
    item.removeAbortListener?.();
    item.resolve({ requestId: id, dismissed: true });
    this.changed();
  }

  private setStatus(key: string, text: string | undefined): void {
    this.assertActive("ui.status");
    const statuses = { ...this.state.statuses };
    if (text === undefined) delete statuses[key];
    else statuses[key] = text;
    this.patch("ui.status", { statuses });
  }

  private sendComposerCommand(mode: "replace" | "append", text: string): void {
    this.composerRevision += 1;
    this.patch("ui.composer.write", {
      composerCommand: { hostId: this.hostId, revision: this.composerRevision, mode, text },
    });
  }

  configureWidget(viewport: DesktopWidgetViewport): void {
    this.assertActive("ui.widget.text");
    this.widgetAdapter.configure(viewport);
  }

  private setWidget(key: string, content: unknown, options?: DesktopWidgetOptions): void {
    this.assertActive("ui.widget.text");
    if (typeof content === "function") {
      this.widgetAdapter.set(
        key,
        content as Exclude<Parameters<ExtensionUIContext["setWidget"]>[1], undefined>,
        options,
      );
      return;
    }
    if (content !== undefined && (!Array.isArray(content) || !content.every((line) => typeof line === "string"))) {
      this.degrade("ui.widget.text", "widget content must be lines or a component factory");
      return;
    }
    this.widgetAdapter.remove(key);
    const widgets = this.state.widgets.filter((widget) => widget.key !== key);
    if (content) {
      const nativeContent = normalizeNativeWidgetContent(options?.nativeContent);
      if (options?.nativeContent !== undefined && !nativeContent) {
        this.warn("Desktop extension native widget content is invalid; rendering text fallback");
      }
      widgets.push({
        key,
        lines: content as string[],
        placement: options?.placement === "aboveEditor" ? "aboveEditor" : "belowEditor",
        ...(nativeContent ? { nativeContent } : {}),
      });
    }
    this.patch("ui.widget.text", { widgets });
  }

  private patch(capability: string, value: Partial<DesktopExtensionHostState>): void {
    this.assertActive(capability);
    this.state = { ...this.state, ...value };
    this.changed();
  }

  private assertActive(capability: string): void {
    if (this.disposed) {
      throw new DesktopExtensionCompatibilityError("DESKTOP_EXTENSION_HOST_DISPOSED", capability);
    }
  }

  private degrade(capability: string, detail?: string): void {
    this.assertActive(capability);
    this.warn(
      `Desktop extension capability ${capability} is unsupported and was ignored${detail ? ` (${detail})` : ""}`,
    );
  }
}
