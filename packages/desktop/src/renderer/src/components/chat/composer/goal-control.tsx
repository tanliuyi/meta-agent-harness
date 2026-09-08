import CirclePause from "lucide-react/dist/esm/icons/circle-pause.mjs";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.mjs";
import Play from "lucide-react/dist/esm/icons/play.mjs";
import Target from "lucide-react/dist/esm/icons/target.mjs";
import { useState } from "react";
import type { PiThreadPhase } from "../../../../../shared/contracts.ts";
import type { PiGoalSnapshot, SessionGoalActionInput } from "../../../../../shared/pi-goal-contracts.ts";
import { errorMessage } from "../../../shared/lib/error-message.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Tooltip } from "../../../shared/ui/tooltip.tsx";
import { TooltipContent } from "../../../shared/ui/tooltip-content.tsx";
import { TooltipTrigger } from "../../../shared/ui/tooltip-trigger.tsx";

interface GoalToolbarProps {
  projectId: string;
  threadId: string;
  snapshot?: PiGoalSnapshot;
  phase: PiThreadPhase;
  readOnly: boolean;
}

export function GoalToolbar({ projectId, threadId, snapshot, phase, readOnly }: GoalToolbarProps) {
  const goal = snapshot?.goal;
  const [pending, setPending] = useState<SessionGoalActionInput["action"]["type"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!goal || (goal.status !== "active" && goal.status !== "paused")) return null;

  const waiting = goal.status === "active" && goal.waiting !== undefined;
  const canPause = goal.status === "active" && !waiting;
  const running = phase !== "idle";
  const runAction = async (action: SessionGoalActionInput["action"]): Promise<void> => {
    setPending(action.type);
    setError(null);
    try {
      await window.desktop.sessions.runGoalAction({ projectId, threadId, action });
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      className="goal-toolbar mb-2 flex min-h-10 w-full items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-1.5 shadow-sm"
      role="toolbar"
      aria-label="Goal 状态"
    >
      <Target className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="shrink-0 text-xs font-medium text-foreground">
        {goal.status === "paused" ? "已暂停" : waiting ? "等待中" : "执行中"}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={goal.objective}>
        {goal.objective}
      </span>
      <span className="hidden shrink-0 items-center gap-2 text-[10px] tabular-nums text-muted-foreground sm:flex">
        <span>{goal.iteration} 轮</span>
        <span>{formatTokenUsage(goal.tokensUsed, goal.tokenBudget)}</span>
        <span>{formatDuration(goal.timeUsedSeconds)}</span>
      </span>
      {error ? (
        <span className="max-w-44 truncate text-xs text-destructive" role="alert" title={error}>
          {error}
        </span>
      ) : null}
      <Tooltip delayDuration={800}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={canPause ? "暂停 Goal" : "继续 Goal"}
            disabled={readOnly || pending !== null || (!canPause && running)}
            onClick={() =>
              void runAction({
                type: canPause ? "pause" : "resume",
                expectedGoalId: goal.id,
              })
            }
          >
            {pending === "pause" || pending === "resume" ? (
              <LoaderCircle className="animate-spin" />
            ) : canPause ? (
              <CirclePause />
            ) : (
              <Play />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{canPause ? "暂停 Goal" : "继续 Goal"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function formatTokenUsage(used: number, budget?: number): string {
  const formattedUsed = formatCount(used);
  return budget === undefined ? `${formattedUsed} Token` : `${formattedUsed}/${formatCount(budget)} Token`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}分`;
  return `${(seconds / 3600).toFixed(1)}时`;
}
