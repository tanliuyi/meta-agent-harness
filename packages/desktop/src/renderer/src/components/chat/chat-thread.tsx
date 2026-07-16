import { ThreadPrimitive } from "@assistant-ui/react";
import { MessageSquarePlus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useDesktop } from "../../state/desktop-context.tsx";
import { sessionKey } from "../../state/desktop-model.ts";
import { Button } from "../ui/button.tsx";
import { HostRequests } from "./host-requests.tsx";
import { VirtualizedThreadSurface } from "./virtualized-thread.tsx";

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
        <VirtualizedThreadSurface sessionKey={sessionKey(snapshot.projectId, snapshot.threadId)} snapshot={snapshot} />
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
