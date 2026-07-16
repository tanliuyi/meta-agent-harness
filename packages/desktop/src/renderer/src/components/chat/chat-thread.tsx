import { ThreadPrimitive } from "@assistant-ui/react";
import { MessageSquarePlus } from "lucide-react";
import type { CSSProperties } from "react";
import { useDesktop } from "../../state/desktop-context.tsx";
import { sessionKey } from "../../state/desktop-model.ts";
import { Composer } from "./composer.tsx";
import { HostRequests } from "./host-requests.tsx";
import { VirtualizedThreadSurface } from "./virtualized-thread.tsx";

/** 中央聊天工作区。 */
export function ChatThread() {
  const desktop = useDesktop();
  const { project, bootstrap, snapshot } = desktop;
  if (desktop.draft) {
    const draftProject = desktop.projects.find(({ id }) => id === desktop.draft?.projectId) ?? null;
    return (
      <ThreadPrimitive.Root className="thread-root aui-root flex h-full flex-col bg-background" style={THREAD_STYLE}>
        <div className="min-h-0 flex-1" />
        <div className="thread-footer relative shrink-0 bg-background">
          <div className="relative mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-2 px-4 pb-4">
            <Composer
              mode="draft"
              projects={desktop.projects}
              project={draftProject}
              config={desktop.draft.config}
              configLoading={desktop.draft.configLoading}
              phase={desktop.draft.phase}
              onProjectChange={desktop.selectDraftProject}
              onModelChange={desktop.selectDraftModel}
              onThinkingChange={desktop.selectDraftThinking}
              onSubmit={desktop.submitDraft}
            />
          </div>
        </div>
      </ThreadPrimitive.Root>
    );
  }
  if (!project) return <Empty title="打开一个 Project" detail="选择本地工作区后，Pi 会在对应 cwd 中运行。" />;
  if (!bootstrap || !snapshot) {
    return <Empty title="准备新会话" detail="正在初始化 Composer。" />;
  }
  return (
    <>
      <ThreadPrimitive.Root className="thread-root aui-root flex h-full flex-col bg-background" style={THREAD_STYLE}>
        <VirtualizedThreadSurface sessionKey={sessionKey(snapshot.projectId, snapshot.threadId)} snapshot={snapshot} />
      </ThreadPrimitive.Root>
      <HostRequests snapshot={snapshot} />
    </>
  );
}

const THREAD_STYLE = {
  "--thread-max-width": "760px",
  "--composer-bg": "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
  "--composer-radius": "8px",
  "--composer-padding": "8px",
} as CSSProperties;

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <MessageSquarePlus size={22} />
      </div>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}
