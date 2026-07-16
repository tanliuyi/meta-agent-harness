import { ThreadListPrimitive } from "@assistant-ui/react";
import { CircleHelp, FolderPlus, Plus, Search, Settings } from "lucide-react";
import { useRef, useState } from "react";
import { useDesktop } from "../../state/desktop-context.tsx";
import {
  preventPrimitiveThreadAction,
  runControlledThreadAction,
  runPendingThreadAction,
} from "../../state/thread-list-commands.ts";
import { Button } from "../ui/button.tsx";
import { ConfirmDialog } from "../ui/confirm-dialog.tsx";
import { ScrollArea } from "../ui/scroll-area.tsx";
import { ProjectList } from "./project-list.tsx";

type PendingDelete = { id: string; title: string } | null;

/** Codex Desktop 风格的 Project 与 session 主导航。 */
export function Sidebar() {
  const desktop = useDesktop();
  const pendingActions = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const draftPending = desktop.draft?.phase === "materializing" || pendingKeys.has("draft");
  const canStartDraft = desktop.projects.some(({ available }) => available);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const projectId = pendingDelete.id;
    setPendingDelete(null);
    void desktop.removeProject(projectId);
  };

  return (
    <ThreadListPrimitive.Root asChild>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <strong>Meta Agent</strong>
          <Button variant="ghost" size="icon" aria-label="搜索">
            <Search size={16} />
          </Button>
        </div>
        <nav className="sidebar-actions" aria-label="主要操作">
          <ThreadListPrimitive.New asChild disabled={!canStartDraft || draftPending}>
            <Button
              variant="ghost"
              data-slot="aui_thread-list-new"
              className="hover:bg-muted data-active:bg-muted h-8 w-full justify-start gap-2 rounded-md px-2.5 text-sm font-normal"
              data-active={desktop.draft !== null || undefined}
              onClickCapture={preventPrimitiveThreadAction}
              onClick={(event) =>
                runControlledThreadAction(event, () => {
                  void runPendingThreadAction(pendingActions.current, "draft", setPendingKeys, async () => {
                    await desktop.beginDraft();
                    requestAnimationFrame(() =>
                      document.querySelector<HTMLTextAreaElement>("[data-draft-composer] textarea")?.focus(),
                    );
                  });
                })
              }
            >
              <Plus size={16} />
              <span className="whitespace-nowrap">新建任务</span>
            </Button>
          </ThreadListPrimitive.New>
        </nav>

        <div className="sidebar-section-heading">
          <span>项目</span>
          <Button variant="ghost" size="icon" aria-label="添加项目" onClick={() => void desktop.chooseProject()}>
            <FolderPlus size={15} />
          </Button>
        </div>
        <ScrollArea className="sidebar-projects">
          <ProjectList
            projects={desktop.projects}
            projectId={desktop.project?.id}
            onProjectExpand={(id) => void desktop.loadProjectThreads(id)}
            onProjectDelete={(project) => setPendingDelete({ id: project.id, title: project.name })}
          />
        </ScrollArea>
        <div className="sidebar-footer">
          <button type="button">
            <Settings size={15} />
            设置
          </button>
          <Button variant="ghost" size="icon" aria-label="帮助">
            <CircleHelp size={15} />
          </Button>
        </div>
        <ConfirmDialog
          open={pendingDelete !== null}
          title="移除项目"
          description={`仅从 Meta Agent 移除“${pendingDelete?.title ?? ""}”，不会删除工作区文件。`}
          confirmLabel="移除"
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          onConfirm={confirmDelete}
        />
      </aside>
    </ThreadListPrimitive.Root>
  );
}
