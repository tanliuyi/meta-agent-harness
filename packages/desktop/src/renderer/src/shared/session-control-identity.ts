import type {
  DesktopExtensionHostState,
  HostRequest,
  ModelOption,
  SessionControlState,
  SlashCommand,
} from "../../../shared/contracts.ts";
import type { DesktopSubagentWidgetNode } from "../../../shared/desktop-extension-contracts.ts";
import type { PiGoalSnapshot } from "../../../shared/pi-goal-contracts.ts";

/**
 * 合并 structured-clone 后的 control，并复用语义未变化的嵌套引用。
 *
 * Electron IPC 会复制数组和对象；若直接写入 reducer，原子 selector 会把等值数据误判为变化。
 */
export function mergeSessionControl(
  previous: SessionControlState | undefined,
  incoming: SessionControlState,
): SessionControlState {
  if (!previous) return incoming;
  return {
    ...incoming,
    ...(equalOptionalRecord(previous.retry, incoming.retry) ? { retry: previous.retry } : {}),
    queueModes: equalRecord(previous.queueModes, incoming.queueModes) ? previous.queueModes : incoming.queueModes,
    ...(equalOptionalRecord(previous.model, incoming.model) ? { model: previous.model } : {}),
    models: reuseArray(previous.models, incoming.models, equalModel),
    commands: reuseArray(previous.commands, incoming.commands, equalCommand),
    thinkingLevels: reuseArray(previous.thinkingLevels, incoming.thinkingLevels, Object.is),
    ...(equalOptionalRecord(previous.context, incoming.context) ? { context: previous.context } : {}),
    readiness: equalRecord(previous.readiness, incoming.readiness) ? previous.readiness : incoming.readiness,
    hostRequests: reuseArray(previous.hostRequests, incoming.hostRequests, equalHostRequest),
    extensionSet:
      previous.extensionSet.generation === incoming.extensionSet.generation &&
      previous.extensionSet.reloadRequired === incoming.extensionSet.reloadRequired &&
      equalArray(previous.extensionSet.diagnostics, incoming.extensionSet.diagnostics, equalRecord)
        ? previous.extensionSet
        : incoming.extensionSet,
    extensionHost: mergeExtensionHost(previous.extensionHost, incoming.extensionHost),
    ...(equalGoalSnapshot(previous.goal, incoming.goal) ? { goal: previous.goal } : {}),
  };
}

function equalGoalSnapshot(left: PiGoalSnapshot | undefined, right: PiGoalSnapshot | undefined): boolean {
  if (!left || !right) return left === right;
  if (
    left.settings.rpcEnabled !== right.settings.rpcEnabled ||
    left.settings.automaticTurnLimit !== right.settings.automaticTurnLimit ||
    left.settings.noProgressTurnLimit !== right.settings.noProgressTurnLimit
  ) {
    return false;
  }
  const leftGoal = left.goal;
  const rightGoal = right.goal;
  if (!leftGoal || !rightGoal) return leftGoal === rightGoal;
  return (
    leftGoal.id === rightGoal.id &&
    leftGoal.objective === rightGoal.objective &&
    leftGoal.status === rightGoal.status &&
    leftGoal.startedAt === rightGoal.startedAt &&
    leftGoal.updatedAt === rightGoal.updatedAt &&
    leftGoal.iteration === rightGoal.iteration &&
    leftGoal.tokenBudget === rightGoal.tokenBudget &&
    leftGoal.tokensUsed === rightGoal.tokensUsed &&
    leftGoal.timeUsedSeconds === rightGoal.timeUsedSeconds &&
    leftGoal.automaticModelTurns === rightGoal.automaticModelTurns &&
    leftGoal.automaticTurnLimit === rightGoal.automaticTurnLimit &&
    leftGoal.noProgressTurns === rightGoal.noProgressTurns &&
    leftGoal.noProgressTurnLimit === rightGoal.noProgressTurnLimit &&
    leftGoal.safetyPauseCause === rightGoal.safetyPauseCause &&
    leftGoal.terminalReason === rightGoal.terminalReason &&
    equalOptionalRecord(leftGoal.waiting, rightGoal.waiting)
  );
}

function mergeExtensionHost(
  previous: DesktopExtensionHostState,
  incoming: DesktopExtensionHostState,
): DesktopExtensionHostState {
  const statuses = equalRecord(previous.statuses, incoming.statuses) ? previous.statuses : incoming.statuses;
  const widgets = reuseArray(previous.widgets, incoming.widgets, equalWidget);
  if (
    statuses === previous.statuses &&
    widgets === previous.widgets &&
    previous.windowTitle === incoming.windowTitle &&
    equalOptionalRecord(previous.composerCommand, incoming.composerCommand) &&
    equalOptionalRecord(previous.working, incoming.working)
  )
    return previous;
  return { ...incoming, statuses, widgets };
}

function equalWidget(
  left: DesktopExtensionHostState["widgets"][number],
  right: DesktopExtensionHostState["widgets"][number],
): boolean {
  return (
    left.key === right.key &&
    left.placement === right.placement &&
    left.hostId === right.hostId &&
    left.columns === right.columns &&
    left.truncated === right.truncated &&
    equalNativeWidgetContent(left.nativeContent, right.nativeContent) &&
    equalArray(left.lines, right.lines, Object.is)
  );
}

function equalNativeWidgetContent(
  left: DesktopExtensionHostState["widgets"][number]["nativeContent"],
  right: DesktopExtensionHostState["widgets"][number]["nativeContent"],
): boolean {
  if (!left || !right) return left === right;
  if (left.type !== right.type) return false;
  if (left.type === "subagents" && right.type === "subagents") {
    return (
      left.version === right.version &&
      left.source === right.source &&
      left.generatedAt === right.generatedAt &&
      equalRecord(left.summary, right.summary) &&
      left.omittedNodeCount === right.omittedNodeCount &&
      equalArray(left.nodes, right.nodes, equalSubagentWidgetNode)
    );
  }
  if (left.type !== "todo" || right.type !== "todo") return false;
  return (
    left.version === right.version &&
    equalRecord(left.summary, right.summary) &&
    left.labels.heading === right.labels.heading &&
    left.labels.more === right.labels.more &&
    equalRecord(left.labels.statuses, right.labels.statuses) &&
    left.hiddenTaskCount === right.hiddenTaskCount &&
    equalArray(
      left.tasks,
      right.tasks,
      (leftTask, rightTask) =>
        leftTask.id === rightTask.id &&
        leftTask.subject === rightTask.subject &&
        leftTask.status === rightTask.status &&
        leftTask.activeForm === rightTask.activeForm &&
        equalOptionalArray(leftTask.blockedBy, rightTask.blockedBy, Object.is),
    )
  );
}

function equalSubagentWidgetNode(left: DesktopSubagentWidgetNode, right: DesktopSubagentWidgetNode): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.label === right.label &&
    left.state === right.state &&
    left.runId === right.runId &&
    left.modelThinking === right.modelThinking &&
    left.description === right.description &&
    left.activity === right.activity &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt &&
    left.endedAt === right.endedAt &&
    left.tokens === right.tokens &&
    left.window === right.window &&
    left.toolCount === right.toolCount &&
    left.turnCount === right.turnCount &&
    left.verdict === right.verdict &&
    equalOptionalArray(left.children, right.children, equalSubagentWidgetNode)
  );
}

function equalModel(left: ModelOption, right: ModelOption): boolean {
  return (
    left.provider === right.provider &&
    left.id === right.id &&
    left.name === right.name &&
    left.contextWindow === right.contextWindow &&
    left.thinking === right.thinking
  );
}

function equalCommand(left: SlashCommand, right: SlashCommand): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.source === right.source &&
    left.acceptsArguments === right.acceptsArguments
  );
}

function equalHostRequest(left: HostRequest, right: HostRequest): boolean {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.title === right.title &&
    left.message === right.message &&
    left.placeholder === right.placeholder &&
    equalOptionalArray(left.options, right.options, Object.is) &&
    left.toolCallId === right.toolCallId &&
    left.workerInstanceId === right.workerInstanceId &&
    left.createdAt === right.createdAt
  );
}

function reuseArray<T>(previous: T[], incoming: T[], equal: (left: T, right: T) => boolean): T[] {
  return equalArray(previous, incoming, equal) ? previous : incoming;
}

function equalOptionalArray<T>(
  left: T[] | undefined,
  right: T[] | undefined,
  equal: (left: T, right: T) => boolean,
): boolean {
  if (!left || !right) return left === right;
  return equalArray(left, right, equal);
}

function equalArray<T>(left: readonly T[], right: readonly T[], equal: (left: T, right: T) => boolean): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => right[index] !== undefined && equal(value, right[index]))
  );
}

function equalOptionalRecord<T extends object>(left: T | undefined, right: T | undefined): boolean {
  if (!left || !right) return left === right;
  return equalRecord(left, right);
}

function equalRecord<T extends object>(left: T, right: T): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => Object.hasOwn(right, key) && Object.is(value, right[key as keyof T]))
  );
}
