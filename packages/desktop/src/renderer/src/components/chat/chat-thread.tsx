import { ThreadPrimitive } from "@assistant-ui/react";
import { ArrowDown, MessageSquarePlus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useDesktop } from "../../state/desktop-context.tsx";
import { TooltipIconButton } from "../assistant-ui/tooltip-icon-button.tsx";
import { Button } from "../ui/button.tsx";
import { Composer } from "./composer.tsx";
import { HostRequests } from "./host-requests.tsx";
import { Messages } from "./messages.tsx";
import { SessionStatus } from "./session-status.tsx";

/** 中央聊天工作区。 */
export function ChatThread() {
  const { project, bootstrap, snapshot, createThread } = useDesktop();
  if (!project) return <Empty title="打开一个 Project" detail="选择本地工作区后，Pi 会在对应 cwd 中运行。" />;
  if (!bootstrap || !snapshot) {
    return (
      <Empty title="创建第一个会话" detail="每个会话独立保存消息、运行状态和右侧 Workbench Panel。">
        <Button onClick={() => void createThread()}>
          <MessageSquarePlus size={15} /> 新建会话
        </Button>
      </Empty>
    );
  }
  return (
    <>
      <ThreadPrimitive.Root
        className="thread-root aui-root flex h-full flex-col bg-background"
        style={
          {
            "--thread-max-width": "760px",
            "--composer-bg": "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
            "--composer-radius": "8px",
            "--composer-padding": "8px",
          } as CSSProperties
        }
      >
        <ThreadPrimitive.Viewport
          turnAnchor="top"
          className="thread-viewport relative flex flex-1 flex-col overflow-x-hidden overflow-y-scroll scroll-smooth"
        >
          <div className="thread-column mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
            <div data-slot="aui-message-group" className="mb-14 flex flex-col empty:hidden">
              <Messages />
            </div>
            <ThreadPrimitive.ViewportFooter className="thread-footer sticky bottom-0 mt-auto flex flex-col gap-2 overflow-visible bg-background pb-4">
              <ThreadPrimitive.ScrollToBottom asChild>
                <TooltipIconButton
                  tooltip="滚动到底部"
                  side="top"
                  variant="outline"
                  className="absolute -top-12 z-10 self-center rounded-full bg-background shadow-sm disabled:invisible"
                >
                  <ArrowDown />
                </TooltipIconButton>
              </ThreadPrimitive.ScrollToBottom>
              <SessionStatus snapshot={snapshot} />
              <Composer snapshot={snapshot} />
            </ThreadPrimitive.ViewportFooter>
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
      <HostRequests snapshot={snapshot} />
    </>
  );
}

function Empty({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <MessageSquarePlus size={22} />
      </div>
      <h2>{title}</h2>
      <p>{detail}</p>
      {children}
    </div>
  );
}
