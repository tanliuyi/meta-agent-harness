export type PiGoalStatus = "active" | "paused" | "blocked" | "usage_limited" | "budget_limited";

export interface PiGoalSnapshot {
  settings: {
    rpcEnabled: boolean;
    automaticTurnLimit: number | null;
    noProgressTurnLimit: number | null;
  };
  goal?: {
    id: string;
    objective: string;
    status: PiGoalStatus;
    startedAt: number;
    updatedAt: number;
    iteration: number;
    tokenBudget?: number;
    tokensUsed: number;
    timeUsedSeconds: number;
    automaticModelTurns: number;
    automaticTurnLimit: number | null;
    noProgressTurns: number;
    noProgressTurnLimit: number | null;
    safetyPauseCause?: "continuation_limit" | "no_progress";
    waiting?: {
      reason: string;
      resumeAt?: number;
    };
    terminalReason?: string;
  };
}

export interface SessionGoalActionInput {
  projectId: string;
  threadId: string;
  action:
    | { type: "start"; objective: string; tokenBudget?: number }
    | { type: "edit"; expectedGoalId: string; objective: string; tokenBudget?: number }
    | { type: "pause"; expectedGoalId: string }
    | { type: "resume"; expectedGoalId: string }
    | { type: "clear"; expectedGoalId: string }
    | {
        type: "settings";
        rpcEnabled: boolean;
        automaticTurnLimit: number | null;
        noProgressTurnLimit: number | null;
      };
}
