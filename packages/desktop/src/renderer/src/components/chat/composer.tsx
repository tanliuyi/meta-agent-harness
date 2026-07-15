import { ComposerPrimitive, useAssistantRuntime, useAuiState } from "@assistant-ui/react";
import { ArrowUp, RotateCcw, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { SendMode, SessionControlState } from "../../../../shared/contracts.ts";
import { toPiImageInputs } from "../../runtime/image-attachments.ts";
import { ComposerAddAttachment, ComposerAttachments } from "../assistant-ui/attachment.tsx";
import { TooltipIconButton } from "../assistant-ui/tooltip-icon-button.tsx";
import { Button } from "../ui/button.tsx";
import { ModelSelect, ThinkingSelect } from "./composer-controls.tsx";
import { ComposerSuggestions, type ComposerSuggestionsHandle } from "./composer-suggestions.tsx";

/** assistant-ui Composer 与 Pi 运行中控制面的组合入口。 */
export function Composer({ snapshot }: { snapshot: SessionControlState }) {
  const runtime = useAssistantRuntime();
  const text = useAuiState((state) => state.composer.text);
  const isEmpty = useAuiState((state) => state.composer.isEmpty);
  const [mode, setMode] = useState<SendMode>("followUp");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestions = useRef<ComposerSuggestionsHandle>(null);

  useEffect(() => {
    const editorText = snapshot.extensionUi.editorText;
    if (editorText !== undefined && runtime.thread.composer.getState().text !== editorText) {
      runtime.thread.composer.setText(editorText);
    }
  }, [runtime, snapshot.extensionUi.editorText]);

  useEffect(
    () =>
      runtime.thread.composer.unstable_on("attachmentAddError", ({ message }) => {
        setError(message);
      }),
    [runtime],
  );

  const aboveWidgets = snapshot.extensionUi.widgets.filter(({ placement }) => placement === "aboveEditor");
  const belowWidgets = snapshot.extensionUi.widgets.filter(({ placement }) => placement === "belowEditor");

  const submitRunning = async () => {
    if (isEmpty || sending) return;
    setSending(true);
    setError(null);
    try {
      const composer = runtime.thread.composer;
      const state = composer.getState();
      await window.desktop.sessions.enqueue({
        projectId: snapshot.projectId,
        threadId: snapshot.threadId,
        text: state.text.trim(),
        images: await toPiImageInputs(state.attachments),
        mode,
      });
      await composer.reset();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    setError(null);
    if (!snapshot.running) return;
    event.preventDefault();
    void submitRunning();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestions.current?.handleKey(event.key)) return;
    event.preventDefault();
  };

  const clearQueue = async () => {
    try {
      const queued = await window.desktop.sessions.clearQueue(snapshot.projectId, snapshot.threadId);
      const composer = runtime.thread.composer;
      composer.setText([...queued, composer.getState().text].filter((value) => value.trim()).join("\n\n"));
    } catch (value) {
      setError(errorMessage(value));
    }
  };

  const readinessError = snapshot.readiness.state === "ready" ? null : snapshot.readiness.message;

  return (
    <div className="composer-wrap">
      {snapshot.queue.steering.length + snapshot.queue.followUp.length > 0 ? (
        <div className="queue-strip">
          <span>{snapshot.queue.steering.length + snapshot.queue.followUp.length} 条消息正在排队</span>
          <Button variant="ghost" size="sm" onClick={() => void clearQueue()}>
            <RotateCcw size={13} /> 清空
          </Button>
        </div>
      ) : null}
      <ComposerPrimitive.Root className="relative flex w-full flex-col" onSubmit={handleSubmit}>
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div className="relative flex w-full flex-col gap-2 rounded-(--composer-radius) border border-border/60 bg-[color-mix(in_oklab,var(--color-muted)_30%,var(--color-background))] p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:border-border focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] data-[dragging=true]:border-dashed data-[dragging=true]:border-ring">
            <ComposerSuggestions
              ref={suggestions}
              snapshot={snapshot}
              text={text}
              onChange={(value) => runtime.thread.composer.setText(value)}
            />
            <ComposerWidgets widgets={aboveWidgets} />
            <div className="empty:hidden">
              <ComposerAttachments />
            </div>
            <ComposerPrimitive.Input
              className="caret-primary placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-sm leading-relaxed outline-none"
              onKeyDown={handleInputKeyDown}
              placeholder={snapshot.running ? "运行中，可发送后续消息" : "向 Pi 发送消息，@ 引用文件，/ 执行命令"}
              rows={1}
              maxRows={9}
              aria-label="消息输入"
            />
            <div className="flex min-h-8 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <ComposerAddAttachment disabled={sending} />
                {snapshot.running ? (
                  <div className="mode-control" role="group" aria-label="运行中消息模式">
                    <button
                      type="button"
                      className={mode === "followUp" ? "is-active" : ""}
                      onClick={() => setMode("followUp")}
                    >
                      排队
                    </button>
                    <button
                      type="button"
                      className={mode === "steer" ? "is-active" : ""}
                      onClick={() => setMode("steer")}
                    >
                      引导
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <ModelSelect snapshot={snapshot} />
                <ThinkingSelect snapshot={snapshot} />
                {snapshot.running ? (
                  <ComposerPrimitive.Cancel asChild>
                    <TooltipIconButton tooltip="停止运行" side="top" variant="outline" className="size-7 rounded-full">
                      <Square className="size-3 fill-current" />
                    </TooltipIconButton>
                  </ComposerPrimitive.Cancel>
                ) : null}
                {snapshot.running ? (
                  <TooltipIconButton
                    type="submit"
                    tooltip="发送后续消息"
                    side="top"
                    variant="default"
                    className="size-7 rounded-full"
                    disabled={sending || isEmpty || snapshot.readiness.state !== "ready"}
                  >
                    <ArrowUp className="size-4" />
                  </TooltipIconButton>
                ) : (
                  <ComposerPrimitive.Send asChild>
                    <TooltipIconButton tooltip="发送消息" side="top" variant="default" className="size-7 rounded-full">
                      <ArrowUp className="size-4" />
                    </TooltipIconButton>
                  </ComposerPrimitive.Send>
                )}
              </div>
            </div>
            <ComposerWidgets widgets={belowWidgets} />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>
      {error || readinessError ? <p className="composer-error">{error ?? readinessError}</p> : null}
    </div>
  );
}

function ComposerWidgets({ widgets }: { widgets: SessionControlState["extensionUi"]["widgets"] }) {
  if (widgets.length === 0) return null;
  return (
    <div className="composer-widgets">
      {widgets.map((widget) => (
        <pre key={widget.key}>{widget.lines.join("\n")}</pre>
      ))}
    </div>
  );
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
