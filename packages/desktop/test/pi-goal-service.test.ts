import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { GoalCommandController } from "../src/main/pi/extensions/pi-goal/src/commands.ts";
import type { ActiveGoal } from "../src/main/pi/extensions/pi-goal/src/persistence.ts";
import type { GoalRuntime, GoalStateSnapshot } from "../src/main/pi/extensions/pi-goal/src/runtime.ts";
import {
  getDesktopGoalSnapshot,
  registerDesktopGoalService,
  runDesktopGoalAction,
  subscribeDesktopGoal,
} from "../src/main/pi/extensions/pi-goal/src/service.ts";

type ExtensionHandler = (event: Record<string, unknown>, context: ExtensionContext) => unknown;

interface GoalHarness {
  handlers: Map<string, ExtensionHandler>;
  runtime: GoalRuntime;
  commands: GoalCommandController;
  triggerStart(): Promise<void>;
  triggerShutdown(): Promise<void>;
  publish(snapshot: GoalStateSnapshot): void;
}

function createGoal(overrides: Partial<ActiveGoal> = {}): ActiveGoal {
  return {
    id: "goal-1",
    text: "Initial objective",
    status: "active",
    startedAt: 100,
    updatedAt: 200,
    iteration: 2,
    tokensUsed: 1200,
    timeUsedSeconds: 30,
    baselineTokens: 0,
    automaticModelTurns: 1,
    toolFreeRepeatCount: 0,
    ...overrides,
  };
}

function createHarness(
  cwd: string,
  sessionId: string,
  initialGoal: ActiveGoal | undefined = createGoal(),
): GoalHarness {
  const handlers = new Map<string, ExtensionHandler>();
  let stateListener: ((snapshot: GoalStateSnapshot) => void) | undefined;
  const runtime = {
    activeGoal: initialGoal,
    settings: {
      rpc: { enabled: false },
      continuationLimits: { automaticTurns: 25, noProgressTurns: 3 },
    },
    addGoalStateListener(listener: (snapshot: GoalStateSnapshot) => void) {
      stateListener = listener;
      return () => {
        if (stateListener === listener) stateListener = undefined;
      };
    },
  } as unknown as GoalRuntime;
  const commands = {
    async startGoal(objective: string, tokenBudget: number | undefined) {
      runtime.activeGoal = createGoal({ text: objective, tokenBudget });
      stateListener?.({ goalId: "goal-1", status: "active" });
    },
    async editGoal(objective: string, tokenBudget: number | undefined) {
      runtime.activeGoal = { ...runtime.activeGoal!, text: objective, tokenBudget, updatedAt: 300 };
      stateListener?.({ goalId: "goal-1", status: runtime.activeGoal.status });
    },
    pauseGoal() {
      runtime.activeGoal = { ...runtime.activeGoal!, status: "paused" };
      stateListener?.({ goalId: "goal-1", status: "paused", reason: "Paused" });
    },
    async resumeGoal() {
      runtime.activeGoal = { ...runtime.activeGoal!, status: "active" };
      stateListener?.({ goalId: "goal-1", status: "active" });
    },
    clearGoal() {
      runtime.activeGoal = undefined;
      stateListener?.({ goalId: "goal-1", status: "cleared", reason: "Cleared" });
    },
  } as unknown as GoalCommandController;
  const api = {
    on(event: string, handler: ExtensionHandler) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  const context = {
    cwd,
    sessionManager: { getSessionId: () => sessionId },
    ui: { confirm: vi.fn(), notify: vi.fn(), setStatus: vi.fn() },
  } as unknown as ExtensionContext;
  registerDesktopGoalService(api, runtime, commands);
  return {
    handlers,
    runtime,
    commands,
    async triggerStart() {
      await handlers.get("session_start")?.({ type: "session_start", reason: "new" }, context);
    },
    async triggerShutdown() {
      await handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, context);
    },
    publish(snapshot) {
      stateListener?.(snapshot);
    },
  };
}

describe("Desktop Goal service", () => {
  it("publishes native snapshots and rejects stale actions", async () => {
    const harness = createHarness("C:\\Workspace", "session-1");
    const listener = vi.fn();
    const unsubscribe = subscribeDesktopGoal("c:/workspace", "session-1", listener);
    await harness.triggerStart();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getDesktopGoalSnapshot("c:/workspace", "session-1")).toMatchObject({
      goal: expect.objectContaining({
        id: "goal-1",
        objective: "Initial objective",
        status: "active",
        automaticTurnLimit: 25,
        noProgressTurnLimit: 3,
      }),
    });
    await expect(
      runDesktopGoalAction("c:/workspace", "session-1", { type: "pause", expectedGoalId: "stale-goal" }),
    ).rejects.toThrow("Goal changed before the action was applied");

    const paused = await runDesktopGoalAction("c:/workspace", "session-1", {
      type: "pause",
      expectedGoalId: "goal-1",
    });
    expect(paused.goal).toMatchObject({ status: "paused", terminalReason: "Paused" });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await harness.triggerShutdown();
    expect(getDesktopGoalSnapshot("c:/workspace", "session-1")).toBeUndefined();
  });

  it("saves native settings and republishes the snapshot", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "desktop-pi-goal-settings-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const harness = createHarness("/workspace", "session-settings");
    const listener = vi.fn();
    const unsubscribe = subscribeDesktopGoal("/workspace", "session-settings", listener);
    try {
      await harness.triggerStart();
      const updated = await runDesktopGoalAction("/workspace", "session-settings", {
        type: "settings",
        rpcEnabled: true,
        automaticTurnLimit: null,
        noProgressTurnLimit: 5,
      });

      expect(updated.settings).toEqual({ rpcEnabled: true, automaticTurnLimit: null, noProgressTurnLimit: 5 });
      expect(listener).toHaveBeenCalledTimes(2);
      expect(JSON.parse(await readFile(join(agentDir, "pi-goal.json"), "utf8"))).toEqual({
        rpc: { enabled: true },
        continuationLimits: { automaticTurns: null, noProgressTurns: 5 },
      });
    } finally {
      unsubscribe();
      await harness.triggerShutdown();
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("does not let an older extension generation remove its replacement", async () => {
    const oldHarness = createHarness("/workspace", "session-2", createGoal({ text: "Old" }));
    const newHarness = createHarness("/workspace", "session-2", createGoal({ text: "New" }));
    await oldHarness.triggerStart();
    await newHarness.triggerStart();

    await oldHarness.triggerShutdown();
    expect(getDesktopGoalSnapshot("/workspace", "session-2")?.goal?.objective).toBe("New");

    await newHarness.triggerShutdown();
    expect(getDesktopGoalSnapshot("/workspace", "session-2")).toBeUndefined();
  });

  it("serializes overlapping renderer actions", async () => {
    const harness = createHarness("/workspace", "session-3");
    await harness.triggerStart();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const editGoal = vi.spyOn(harness.commands, "editGoal").mockImplementation(async (objective) => {
      order.push(`start:${objective}`);
      if (objective === "First") await firstPending;
      harness.runtime.activeGoal = { ...harness.runtime.activeGoal!, text: objective };
      order.push(`end:${objective}`);
    });

    const first = runDesktopGoalAction("/workspace", "session-3", {
      type: "edit",
      expectedGoalId: "goal-1",
      objective: "First",
    });
    const second = runDesktopGoalAction("/workspace", "session-3", {
      type: "edit",
      expectedGoalId: "goal-1",
      objective: "Second",
    });
    await vi.waitFor(() => expect(order).toEqual(["start:First"]));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(editGoal).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["start:First", "end:First", "start:Second", "end:Second"]);
    expect(getDesktopGoalSnapshot("/workspace", "session-3")?.goal?.objective).toBe("Second");
    await harness.triggerShutdown();
  });
});
