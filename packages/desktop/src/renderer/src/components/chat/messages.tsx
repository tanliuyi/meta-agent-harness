import {
  ActionBarPrimitive,
  AuiIf,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { Check, Copy } from "lucide-react";
import { createContext, type ReactNode, useContext, useLayoutEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { UserMessageAttachments } from "../assistant-ui/attachment.tsx";
import { ReasoningContent, ReasoningRoot, ReasoningText, ReasoningTrigger } from "../assistant-ui/reasoning.tsx";
import { StreamdownText } from "../assistant-ui/streamdown-text.tsx";
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from "../assistant-ui/tool-group.tsx";
import { TooltipIconButton } from "../assistant-ui/tooltip-icon-button.tsx";
import { ToolView } from "./tool-view.tsx";

const GROUP_PARTS = groupPartByType({
  reasoning: ["group-chain-of-thought", "group-reasoning"],
  "tool-call": ["group-chain-of-thought", "group-tool"],
  "standalone-tool-call": [],
});

interface MessageEntranceAnimationState {
  isRunning: boolean;
  seenMessageIds: Set<string>;
}

const MessageEntranceAnimationContext = createContext<MessageEntranceAnimationState | null>(null);

export function MessageEntranceAnimationProvider({
  children,
  isRunning,
  messageIds,
}: {
  children: ReactNode;
  isRunning: boolean;
  messageIds: readonly string[];
}) {
  const [seenMessageIds] = useState(() => new Set(messageIds));
  useLayoutEffect(() => {
    if (!isRunning) {
      for (const messageId of messageIds) seenMessageIds.add(messageId);
    }
  }, [isRunning, messageIds, seenMessageIds]);
  const value = useMemo(() => ({ isRunning, seenMessageIds }), [isRunning, seenMessageIds]);
  return <MessageEntranceAnimationContext.Provider value={value}>{children}</MessageEntranceAnimationContext.Provider>;
}

export const THREAD_MESSAGE_COMPONENTS = { UserMessage, AssistantMessage };

function UserMessage() {
  const animateEntrance = useMessageEntranceAnimation();
  return (
    <MessagePrimitive.Root
      data-slot="aui-user-message-root"
      data-role="user"
      className={cn(
        "grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 [&:where(>*)]:col-start-2",
        animateEntrance && "fade-in slide-in-from-bottom-1 animate-in duration-150",
      )}
    >
      <UserMessageAttachments />
      <div className="relative col-start-2 min-w-0">
        <div className="bg-muted text-foreground rounded-lg px-3.5 py-2 text-sm leading-relaxed wrap-break-word empty:hidden">
          <MessagePrimitive.Parts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const animateEntrance = useMessageEntranceAnimation();
  return (
    <MessagePrimitive.Root
      data-slot="aui-assistant-message-root"
      data-role="assistant"
      className={cn("relative -mb-7 pb-7", animateEntrance && "fade-in slide-in-from-bottom-1 animate-in duration-150")}
    >
      <div className="px-2 text-sm leading-relaxed text-foreground wrap-break-word">
        <MessagePrimitive.GroupedParts groupBy={GROUP_PARTS}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chain-of-thought":
                return <div data-slot="aui-chain-of-thought">{children}</div>;
              case "group-tool":
                return (
                  <ToolGroupRoot variant="ghost" defaultOpen={part.status.type === "running"}>
                    <ToolGroupTrigger count={part.indices.length} active={part.status.type === "running"} />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "group-reasoning": {
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot variant="ghost" streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
              case "reasoning":
                return <StreamdownText />;
              case "tool-call":
                return part.toolUI ?? <ToolView {...part} />;
              case "data":
                return part.dataRendererUI;
              case "indicator":
                return (
                  <span className="animate-pulse text-muted-foreground" aria-label="Assistant 正在工作">
                    ●
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            <ErrorPrimitive.Message className="line-clamp-2" />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
      <AuiIf
        condition={(state) => {
          const lastPart = state.message.parts.at(-1);
          return lastPart?.type === "text" && lastPart.text.trim().length > 0;
        }}
      >
        <div className="ms-2 flex min-h-7 items-center pt-1">
          <ActionBarPrimitive.Root
            hideWhenRunning
            autohide="not-last"
            className="animate-in fade-in flex gap-1 text-muted-foreground duration-200"
          >
            <ActionBarPrimitive.Copy asChild>
              <TooltipIconButton tooltip="复制消息" side="top">
                <AuiIf condition={(state) => state.message.isCopied}>
                  <Check className="animate-in zoom-in-50 fade-in" />
                </AuiIf>
                <AuiIf condition={(state) => !state.message.isCopied}>
                  <Copy className="animate-in zoom-in-75 fade-in" />
                </AuiIf>
              </TooltipIconButton>
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        </div>
      </AuiIf>
    </MessagePrimitive.Root>
  );
}

function useMessageEntranceAnimation(): boolean {
  const messageId = useAuiState((state) => state.message.id);
  const state = useContext(MessageEntranceAnimationContext);
  const animate = state?.isRunning === true && !state.seenMessageIds.has(messageId);
  useLayoutEffect(() => {
    state?.seenMessageIds.add(messageId);
  }, [messageId, state]);
  return animate;
}
