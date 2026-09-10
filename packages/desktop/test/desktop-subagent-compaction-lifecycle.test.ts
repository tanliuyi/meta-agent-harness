import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../src/main/pi/extensions/pi-subagents/src/agents/agents.ts";
import { runChildSession } from "../src/main/pi/extensions/pi-subagents/src/runs/background/run-child-session.ts";
import { runSync } from "../src/main/pi/extensions/pi-subagents/src/runs/foreground/execution.ts";
import { buildInProcessChildLaunch } from "../src/main/pi/extensions/pi-subagents/src/runs/shared/child-launch.ts";
import {
  type ChildLifecycleState,
  projectChildLifecycle,
} from "../src/main/pi/extensions/pi-subagents/src/runs/shared/child-lifecycle.ts";
import { createDesktopChildSessionFactory } from "../src/main/pi/subagents/desktop-child-session-factory.ts";
import type { SubagentRuntime } from "../src/main/pi/subagents/subagent-runtime.ts";

const agent: AgentConfig = {
  name: "worker",
  description: "Worker",
  systemPromptMode: "append",
  inheritProjectContext: false,
  inheritGlobalContext: false,
  inheritSkills: false,
  systemPrompt: "Complete the task.",
  source: "builtin",
  filePath: "worker.md",
  completionGuard: false,
};

describe("Desktop subagent compaction lifecycle", () => {
  it.each([
    ["foreground", "compaction"],
    ["background", "compaction"],
    ["foreground", "steering"],
    ["background", "steering"],
  ])(
    "keeps %s children alive while post-answer %s exceeds the drain grace",
    async (mode, activity) => {
      let cancelled = false;
      const cancel = vi.fn(async () => {
        cancelled = true;
      });
      const runtime: SubagentRuntime = {
        async *run(request) {
          yield { type: "started", runId: request.runId };
          yield {
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "final answer" }],
              provider: "faux",
              model: "model",
              stopReason: "stop",
              timestamp: Date.now(),
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
            },
          };
          yield {
            type: "child_event",
            event:
              activity === "compaction" ? { type: "compaction_start", reason: "threshold" } : { type: "turn_start" },
          };
          await delay(1200);
          if (activity === "compaction") {
            yield {
              type: "child_event",
              event: { type: "compaction_end", reason: "threshold", aborted: false, willRetry: false },
            };
          }
          if (cancelled) yield { type: "failed", runId: request.runId, error: "Subagent cancelled." };
          else yield { type: "completed", runId: request.runId };
        },
        resume(request) {
          return this.run(request);
        },
        cancel,
        async steer() {},
        async dispose() {},
      };
      const factory = createDesktopChildSessionFactory(runtime);
      try {
        const result =
          mode === "foreground"
            ? await runSync(process.cwd(), [agent], "worker", "task", {
                childSessionFactory: factory,
                runId: "compaction-lifecycle",
                acceptance: false,
              })
            : await runChildSession({
                factory,
                prompt: "task",
                appendChildEvent() {},
                writeOutputLine() {},
                launch: buildInProcessChildLaunch({
                  cwd: process.cwd(),
                  runId: "compaction-lifecycle",
                  host: "runner",
                  childAgentName: "worker",
                  childIndex: 0,
                  sessionEnabled: false,
                  inheritProjectContext: false,
                  inheritGlobalContext: false,
                  inheritSkills: false,
                }),
              });
        expect(cancel).not.toHaveBeenCalled();
        expect(result).toMatchObject({ exitCode: 0, finalOutput: "final answer" });
      } finally {
        await factory.dispose();
      }
    },
    30_000,
  );

  it("does not arm a terminal drain between compaction and the next tool-loop response", () => {
    const state: ChildLifecycleState = { compactionRetryActive: false };
    expect(projectChildLifecycle({ type: "compaction_start" }, false, state)).toBe("cancel-drain");
    expect(projectChildLifecycle({ type: "agent_settled" }, false, state)).toBe("none");
    expect(projectChildLifecycle({ type: "compaction_end", willRetry: false }, false, state)).toBe("none");
    expect(projectChildLifecycle({ type: "agent_settled" }, false, state)).toBe("start-drain");
  });

  it("keeps drain protection suspended through recovery and restores it at settlement", () => {
    const state: ChildLifecycleState = { compactionRetryActive: false };
    expect(projectChildLifecycle({ type: "message_end" }, true, state)).toBe("start-drain");
    expect(projectChildLifecycle({ type: "compaction_start" }, false, state)).toBe("cancel-drain");
    expect(projectChildLifecycle({ type: "auto_retry_start" }, false, state)).toBe("cancel-drain");
    expect(projectChildLifecycle({ type: "compaction_end", willRetry: true }, false, state)).toBe("cancel-drain");
    expect(projectChildLifecycle({ type: "agent_settled" }, false, state)).toBe("none");
    projectChildLifecycle({ type: "agent_start" }, false, state);
    expect(projectChildLifecycle({ type: "agent_settled" }, false, state)).toBe("start-drain");
  });
});
