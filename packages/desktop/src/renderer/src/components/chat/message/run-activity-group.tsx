import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ReasoningContent } from "../../assistant-ui/reasoning/reasoning-content.tsx";
import { ReasoningRoot } from "../../assistant-ui/reasoning/reasoning-root.tsx";
import { ReasoningTrigger } from "../../assistant-ui/reasoning/reasoning-trigger.tsx";

export function RunActivityGroup({
  running,
  startedAt,
  children,
}: {
  running: boolean;
  startedAt: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const previousRunning = useRef(running);

  useEffect(() => {
    if (previousRunning.current && !running) {
      setOpen(false);
      setNow(Date.now());
    }
    previousRunning.current = running;
  }, [running]);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [running]);

  const duration = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const label = `${running ? "正在处理" : "已处理"} ${formatElapsedDuration(duration)}`;

  return (
    <ReasoningRoot
      variant="ghost"
      className="aui-run-activity-root"
      open={running || open}
      onOpenChange={(nextOpen) => {
        if (!running) setOpen(nextOpen);
      }}
    >
      <ReasoningTrigger
        className="aui-run-activity-trigger"
        label={label}
        active={running}
        hideChevron={running}
        disabled={running}
      />
      <ReasoningContent className="aui-run-activity-content text-foreground" fade={false} aria-busy={running}>
        <div className="aui-run-activity-body flex flex-col gap-3 py-2">{children}</div>
      </ReasoningContent>
    </ReasoningRoot>
  );
}

function formatElapsedDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    ...(hours > 0 ? [`${padDurationPart(hours)}h`] : []),
    ...(minutes > 0 ? [`${padDurationPart(minutes)}m`] : []),
    `${padDurationPart(seconds)}s`,
  ];
  return parts.join(" ");
}

function padDurationPart(value: number): string {
  return value.toString().padStart(2, "0");
}
