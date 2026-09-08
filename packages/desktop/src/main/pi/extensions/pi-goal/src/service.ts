import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiGoalSnapshot, SessionGoalActionInput } from "../../../../../shared/pi-goal-contracts.ts";
import type { GoalCommandController } from "./commands.ts";
import type { ActiveGoal } from "./persistence.ts";
import type { GoalRuntime, StatusContext } from "./runtime.ts";
import { type GoalSettings, saveGoalSettings } from "./settings.ts";

interface GoalController {
  runtime: GoalRuntime;
  commands: GoalCommandController;
  ctx: StatusContext;
  terminalReason?: string;
  tail: Promise<void>;
}

const controllers = new Map<string, GoalController>();
const listeners = new Map<string, Set<() => void>>();

export function registerDesktopGoalService(
  pi: ExtensionAPI,
  runtime: GoalRuntime,
  commands: GoalCommandController,
): void {
  let unregisterStateListener: (() => void) | undefined;
  let key: string | undefined;
  let registeredController: GoalController | undefined;

  pi.on("session_start", (_event, ctx) => {
    key = controllerKey(ctx.cwd, ctx.sessionManager.getSessionId());
    const controller: GoalController = { runtime, commands, ctx, tail: Promise.resolve() };
    registeredController = controller;
    controllers.set(key, controller);
    unregisterStateListener = runtime.addGoalStateListener((state) => {
      controller.terminalReason = state.reason;
      notifyListeners(key!);
    });
    notifyListeners(key);
  });

  pi.on("session_shutdown", () => {
    unregisterStateListener?.();
    unregisterStateListener = undefined;
    if (key && controllers.get(key) === registeredController) {
      controllers.delete(key);
      notifyListeners(key);
    }
    key = undefined;
    registeredController = undefined;
  });
}

export function subscribeDesktopGoal(cwd: string, sessionId: string, listener: () => void): () => void {
  const key = controllerKey(cwd, sessionId);
  const current = listeners.get(key) ?? new Set<() => void>();
  current.add(listener);
  listeners.set(key, current);
  return () => {
    current.delete(listener);
    if (current.size === 0) listeners.delete(key);
  };
}

export function getDesktopGoalSnapshot(cwd: string, sessionId: string): PiGoalSnapshot | undefined {
  const controller = controllers.get(controllerKey(cwd, sessionId));
  if (!controller) return undefined;
  return snapshot(controller.runtime.activeGoal, controller.runtime, controller.terminalReason);
}

export async function runDesktopGoalAction(
  cwd: string,
  sessionId: string,
  action: SessionGoalActionInput["action"],
): Promise<PiGoalSnapshot> {
  const controller = controllers.get(controllerKey(cwd, sessionId));
  if (!controller) throw new Error("Goal service is unavailable for this session");
  const operation = controller.tail.then(async () => {
    if (action.type === "settings") {
      const settings: GoalSettings = {
        rpc: { enabled: action.rpcEnabled },
        continuationLimits: {
          automaticTurns: action.automaticTurnLimit,
          noProgressTurns: action.noProgressTurnLimit,
        },
      };
      saveGoalSettings(settings);
      controller.runtime.settings = settings;
      notifyListeners(controllerKey(cwd, sessionId));
      return;
    }
    if (action.type === "start") {
      if (controller.runtime.activeGoal) throw new Error("A Goal already exists");
      await controller.commands.startGoal(action.objective.trim(), action.tokenBudget, controller.ctx);
      if (!controller.runtime.activeGoal) throw new Error("Goal was not started");
      return;
    }
    if (controller.runtime.activeGoal?.id !== action.expectedGoalId) {
      throw new Error("Goal changed before the action was applied");
    }
    switch (action.type) {
      case "edit": {
        const objective = action.objective.trim();
        await controller.commands.editGoal(objective, action.tokenBudget, controller.ctx);
        if (controller.runtime.activeGoal?.text !== objective) throw new Error("Goal was not updated");
        break;
      }
      case "pause":
        controller.commands.pauseGoal(controller.ctx);
        if (controller.runtime.activeGoal?.status !== "paused") throw new Error("Goal was not paused");
        break;
      case "resume":
        await controller.commands.resumeGoal(controller.ctx);
        if (controller.runtime.activeGoal?.status !== "active") throw new Error("Goal was not resumed");
        break;
      case "clear":
        controller.commands.clearGoal(controller.ctx);
        if (controller.runtime.activeGoal) throw new Error("Goal was not cleared");
        break;
    }
  });
  controller.tail = operation.catch(() => undefined);
  await operation;
  return snapshot(controller.runtime.activeGoal, controller.runtime, controller.terminalReason);
}

function snapshot(goal: ActiveGoal | undefined, runtime: GoalRuntime, terminalReason?: string): PiGoalSnapshot {
  const settings: PiGoalSnapshot["settings"] = {
    rpcEnabled: runtime.settings.rpc.enabled,
    automaticTurnLimit: runtime.settings.continuationLimits.automaticTurns,
    noProgressTurnLimit: runtime.settings.continuationLimits.noProgressTurns,
  };
  if (!goal || goal.status === "complete" || goal.status === "queued") return { settings };
  return {
    settings,
    goal: {
      id: goal.id,
      objective: goal.text,
      status: goal.status,
      startedAt: goal.startedAt,
      updatedAt: goal.updatedAt,
      iteration: goal.iteration,
      ...(goal.tokenBudget === undefined ? {} : { tokenBudget: goal.tokenBudget }),
      tokensUsed: goal.tokensUsed,
      timeUsedSeconds: goal.timeUsedSeconds,
      automaticModelTurns: goal.automaticModelTurns,
      automaticTurnLimit: runtime.settings.continuationLimits.automaticTurns,
      noProgressTurns: goal.toolFreeRepeatCount,
      noProgressTurnLimit: runtime.settings.continuationLimits.noProgressTurns,
      ...(goal.safetyPauseCause ? { safetyPauseCause: goal.safetyPauseCause } : {}),
      ...(goal.waiting
        ? {
            waiting: {
              reason: goal.waiting.reason,
              ...(goal.waiting.resumeAt ? { resumeAt: goal.waiting.resumeAt } : {}),
            },
          }
        : {}),
      ...(terminalReason ? { terminalReason } : {}),
    },
  };
}

function notifyListeners(key: string): void {
  for (const listener of listeners.get(key) ?? []) {
    try {
      listener();
    } catch {
      // One renderer publication failure must not prevent other subscribers.
    }
  }
}

function controllerKey(cwd: string, sessionId: string): string {
  const normalizedCwd = cwd.replace(/\\/g, "/");
  return `${process.platform === "win32" ? normalizedCwd.toLowerCase() : normalizedCwd}\0${sessionId}`;
}
