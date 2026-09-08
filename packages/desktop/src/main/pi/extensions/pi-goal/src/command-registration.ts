import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { completeGoalArguments, isRemovedQueueCommand, parseCommand } from "./command.ts";
import type { GoalCommandController } from "./commands.ts";
import { notifyTerminal, safeTerminalText } from "./errors.ts";
import type { GoalRuntime } from "./runtime.ts";

export function registerGoalCommand(pi: ExtensionAPI, runtime: GoalRuntime, commands: GoalCommandController) {
  pi.registerCommand("goal", {
    description: "Run a goal to completion: /goal [--tokens 100k] <goal_to_complete>",
    getArgumentCompletions: (prefix) => completeGoalArguments(prefix),
    handler: async (args, ctx) => {
      if (runtime.hasLegacyQueueInterface() && isRemovedQueueCommand(args)) {
        reportRemovedQueueCommand(ctx, runtime);
        return;
      }
      const result = parseCommand(args);
      if (typeof result === "string") {
        reportCommandError(result, ctx);
        return;
      }
      if (result.kind === "show") {
        commands.showGoal(ctx);
        return;
      }
      switch (result.kind) {
        case "pause":
          commands.pauseGoal(ctx);
          return;
        case "resume":
          await commands.resumeGoal(ctx);
          return;
        case "clear":
          commands.clearGoal(ctx);
          return;
        case "edit":
          await commands.editGoal(result.objective ?? "", result.tokenBudget, ctx);
          return;
        case "start":
          await commands.startGoal(result.objective ?? "", result.tokenBudget, ctx);
          return;
      }
    },
  });
}

function reportCommandError(message: string, ctx: ExtensionCommandContext) {
  const safeMessage = safeTerminalText(message);
  if (ctx.mode === "print" || ctx.mode === "json") throw new Error(safeMessage);
  notifyTerminal(ctx.ui, safeMessage, "warning");
}

function reportRemovedQueueCommand(ctx: ExtensionCommandContext, runtime: GoalRuntime) {
  const message = runtime.activeGoal
    ? "Ordered goal queue has been removed. Use /goal edit to reprioritize the active objective instead."
    : "Ordered goal queue has been removed. Start /goal <objectives> to continue with one merged objective, or use /goal clear to discard the old queue state.";
  if (ctx.mode === "print" || ctx.mode === "json") throw new Error(message);
  notifyTerminal(ctx.ui, message, "warning");
}
