import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Circle from "lucide-react/dist/esm/icons/circle.mjs";
import Link2 from "lucide-react/dist/esm/icons/link-2.mjs";
import ListTodo from "lucide-react/dist/esm/icons/list-todo.mjs";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.mjs";
import { memo, useEffect, useRef, useState } from "react";
import type { SessionControlState } from "../../../../../shared/contracts.ts";
import type {
  DesktopTodoTaskStatus,
  DesktopTodoWidgetContent,
  DesktopWidgetViewport,
} from "../../../../../shared/desktop-extension-contracts.ts";
import { readCssToken, resolveTerminalTheme, TERMINAL_FONT_TOKEN } from "../../../shared/lib/terminal-theme.ts";
import { Popover } from "../../../shared/ui/popover.tsx";
import { PopoverContent } from "../../../shared/ui/popover-content.tsx";
import { PopoverTrigger } from "../../../shared/ui/popover-trigger.tsx";
import { useTheme } from "../../../state/theme.tsx";

type Widget = SessionControlState["extensionHost"]["widgets"][number];
interface ComposerWidgetsProps {
  widgets: Widget[];
  onViewportChange?(viewport: DesktopWidgetViewport): Promise<void>;
}

/** Generic Pi widget presentation. String payloads are text, never inferred as plugin protocols. */
export const ComposerWidgets = memo(function ComposerWidgets({ widgets, onViewportChange }: ComposerWidgetsProps) {
  if (widgets.length === 0) return null;
  return (
    <div className="composer-widget-list grid min-w-0 gap-2 px-2 py-2 text-xs">
      {widgets.map((widget) => (
        <ComposerWidget key={widget.key} widget={widget} onViewportChange={onViewportChange} />
      ))}
    </div>
  );
});

function ComposerWidget({
  widget,
  onViewportChange,
}: {
  widget: Widget;
  onViewportChange?: ComposerWidgetsProps["onViewportChange"];
}) {
  if (widget.nativeContent?.type === "todo") return <ComposerTodoWidget content={widget.nativeContent} />;
  return widget.hostId || widget.lines.some((line) => line.includes("\x1b")) ? (
    <ComposerTerminalWidget widget={widget} onViewportChange={onViewportChange} />
  ) : (
    <pre className="m-0 min-w-0 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
      {widget.lines.join("\n")}
    </pre>
  );
}

function ComposerTodoWidget({ content }: { content: DesktopTodoWidgetContent }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const progress = content.summary.total === 0 ? 0 : (content.summary.completed / content.summary.total) * 100;
  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    setOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="desktop-todo-list-trigger"
          aria-label={`${content.labels.heading} ${content.summary.completed}/${content.summary.total}`}
          className="mx-auto flex h-10 w-44 items-center gap-2 rounded-xl border border-border/70 bg-card/80 px-3 text-card-foreground shadow-sm outline-none transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-ring/40"
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
          onFocus={keepOpen}
          onBlur={scheduleClose}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ListTodo className="size-3.5" aria-hidden="true" />
          </span>
          <span className="text-xs font-semibold">{content.labels.heading}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {content.summary.completed}/{content.summary.total}
          </span>
          <ChevronDown
            className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-slot="desktop-todo-list-popover"
        side="top"
        align="center"
        sideOffset={8}
        className="w-[min(36rem,calc(100vw-2rem))] overflow-hidden p-0"
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
        onFocusCapture={keepOpen}
        onBlurCapture={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ListTodo className="size-4" aria-hidden="true" />
          </span>
          <span className="text-xs font-semibold">{content.labels.heading}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {content.summary.completed}/{content.summary.total}
          </span>
          {content.summary.inProgress > 0 ? (
            <span className="ml-auto text-[11px] text-warning">
              {content.summary.inProgress} {content.labels.statuses.inProgress}
            </span>
          ) : null}
        </header>
        <div className="mx-3 mt-2.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <ul className="m-0 grid max-h-80 list-none gap-0.5 overflow-y-auto px-3 pb-3 pt-2" aria-live="polite">
          {content.tasks.map((task) => (
            <li key={task.id} className="flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1.5">
              <TodoStatusIcon status={task.status} />
              <span className="sr-only">{todoStatusLabel(task.status, content.labels.statuses)}</span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block break-words text-xs leading-5 ${
                    task.status === "completed"
                      ? "text-muted-foreground line-through"
                      : task.status === "pending"
                        ? "text-foreground/70"
                        : "text-foreground"
                  }`}
                >
                  {task.subject}
                </span>
                {task.status === "in_progress" && task.activeForm ? (
                  <span className="block text-[11px] leading-4 text-muted-foreground">{task.activeForm}</span>
                ) : null}
              </span>
              {task.blockedBy?.length ? (
                <span className="flex shrink-0 items-center gap-1 pt-0.5 font-mono text-[10px] text-muted-foreground">
                  <Link2 className="size-3" aria-hidden="true" />
                  {task.blockedBy.map((id) => `#${id}`).join(",")}
                </span>
              ) : null}
            </li>
          ))}
          {content.hiddenTaskCount > 0 ? (
            <li className="px-1.5 pt-1 text-[11px] text-muted-foreground">
              +{content.hiddenTaskCount} {content.labels.more}
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function TodoStatusIcon({ status }: { status: DesktopTodoTaskStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />;
    case "in_progress":
      return <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-warning" aria-hidden="true" />;
    case "pending":
      return <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
}

function todoStatusLabel(
  status: DesktopTodoTaskStatus,
  labels: DesktopTodoWidgetContent["labels"]["statuses"],
): string {
  return status === "in_progress" ? labels.inProgress : labels[status];
}

function ComposerTerminalWidget({
  widget,
  onViewportChange,
}: {
  widget: Widget;
  onViewportChange?: ComposerWidgetsProps["onViewportChange"];
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const latest = useRef({ widget, onViewportChange });
  latest.current = { widget, onViewportChange };
  const { resolvedTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [rowHeight, setRowHeight] = useState(18);

  useEffect(() => {
    if (!container.current) return;
    const rootStyle = getComputedStyle(document.documentElement);
    const { ansi, ...theme } = resolveTerminalTheme(rootStyle);
    const terminal = new Terminal({
      cols: widget.columns ?? 80,
      rows: Math.max(1, Math.min(40, widget.lines.length)),
      fontFamily: readCssToken(rootStyle, TERMINAL_FONT_TOKEN),
      fontSize: 12,
      lineHeight: 1.5,
      letterSpacing: 0,
      theme: { ...theme, ...ansi, background: "rgba(0, 0, 0, 0)" },
      allowTransparency: true,
      allowProposedApi: true,
      disableStdin: true,
      cursorBlink: false,
      scrollback: 0,
      screenReaderMode: true,
      minimumContrastRatio: 4.5,
      rescaleOverlappingGlyphs: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.open(container.current);
    const measureRows = () => {
      const row = container.current?.querySelector<HTMLElement>(".xterm-rows > div");
      const measured = row?.getBoundingClientRect().height;
      if (measured && Number.isFinite(measured) && measured > 0) setRowHeight(measured);
    };
    requestAnimationFrame(measureRows);
    terminalRef.current = terminal;
    fitRef.current = fit;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = "";
    const resize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const dimensions = fit.proposeDimensions();
        if (!dimensions) return;
        const columns = Math.max(1, Math.min(300, dimensions.cols));
        const current = latest.current;
        const signature = `${columns}:${resolvedTheme}`;
        if (signature === previous) return;
        previous = signature;
        terminal.resize(columns, Math.max(1, Math.min(40, current.widget.lines.length)));
        if (current.widget.hostId && current.onViewportChange) {
          void current
            .onViewportChange({ hostId: current.widget.hostId, key: current.widget.key, columns, theme: resolvedTheme })
            .catch((value: unknown) => {
              if (active) setError(value instanceof Error ? value.message : String(value));
            });
        }
      }, 100);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    resize();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      observer.disconnect();
      terminalRef.current = null;
      fitRef.current = null;
      terminal.dispose();
    };
  }, [resolvedTheme, widget.hostId, widget.key]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const columns = fitRef.current?.proposeDimensions()?.cols ?? widget.columns ?? 80;
    terminal.resize(Math.max(1, Math.min(300, columns)), Math.max(1, Math.min(40, widget.lines.length)));
    // Each snapshot replaces the screen; styles do not bleed between Pi render lines.
    terminal.write(
      `\x1b[0m\x1b[2J\x1b[H\x1b[?25l${widget.lines
        .slice(0, 40)
        .map((line) => `${line}\x1b[0m\x1b]8;;\x07`)
        .join("\r\n")}`,
    );
  }, [widget.lines, widget.columns, resolvedTheme]);

  return (
    <section aria-label={`插件 ${widget.key}`} className="min-w-0">
      <div>
        <div
          ref={container}
          className="composer-terminal-widget"
          style={{ height: rowHeight * Math.max(1, Math.min(40, widget.lines.length)) }}
        />
      </div>
      {widget.truncated || widget.lines.length > 40 ? (
        <p className="m-0 pt-1 text-muted-foreground">插件内容已截断</p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 pt-1 text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
