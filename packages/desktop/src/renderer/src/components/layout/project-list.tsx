import { ChevronDown, ChevronRight, Folder, MoreHorizontal, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import type { Project } from "../../../../shared/contracts.ts";
import { Button } from "../ui/button.tsx";
import { DesktopThreadList } from "./desktop-thread-list.tsx";

interface ProjectListProps {
  projects: Project[];
  projectId?: string;
  onProjectExpand(projectId: string): void;
  onProjectDelete(project: Project): void;
}

/** 渲染 Project 与其活动、归档 session 列表。 */
export function ProjectList(props: ProjectListProps) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(props.projectId ? [props.projectId] : []),
  );

  useEffect(() => {
    const projectId = props.projectId;
    if (!projectId) return;
    setExpandedProjectIds((current) => {
      if (current.has(projectId)) return current;
      return new Set(current).add(projectId);
    });
  }, [props.projectId]);

  return props.projects.map((project) => {
    const active = props.projectId === project.id;
    const expanded = expandedProjectIds.has(project.id);

    return (
      <ProjectItem
        key={project.id}
        {...props}
        project={project}
        active={active}
        expanded={expanded}
        onExpandedChange={(nextExpanded) => {
          setExpandedProjectIds((current) => {
            const next = new Set(current);
            if (nextExpanded) next.add(project.id);
            else next.delete(project.id);
            return next;
          });
          if (nextExpanded) props.onProjectExpand(project.id);
        }}
      />
    );
  });
}

interface ProjectItemProps extends Omit<ProjectListProps, "projects" | "projectId"> {
  project: Project;
  active: boolean;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
}

function ProjectItem(props: ProjectItemProps) {
  return (
    <section className="project-group" data-project-id={props.project.id}>
      <div
        className="project-row group hover:bg-muted focus-visible:bg-muted has-focus-visible:bg-muted has-data-[state=open]:bg-muted relative flex h-8 items-center rounded-md transition-colors focus-visible:outline-none"
        data-active={props.active || undefined}
      >
        <button
          type="button"
          className="project-main focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 text-start text-sm outline-none group-hover:pe-9 group-has-focus-visible:pe-9 group-has-data-[state=open]:pe-9 focus-visible:ring-[3px]"
          aria-current={props.active ? "page" : undefined}
          aria-expanded={props.expanded}
          aria-controls={`project-threads-${props.project.id}`}
          onClick={() => props.onExpandedChange(!props.expanded)}
        >
          {props.expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{props.project.name}</span>
          {props.project.available ? null : <span className="project-warning">不可用</span>}
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="data-[state=open]:bg-accent absolute end-1.5 top-1/2 size-6 -translate-y-1/2 p-0 opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label="项目操作"
            >
              <MoreHorizontal className="size-3.5" />
              <span className="sr-only">项目操作</span>
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="right"
              align="start"
              sideOffset={6}
              className="bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
            >
              <DropdownMenu.Item
                className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
                onSelect={() => props.onProjectDelete(props.project)}
              >
                <Trash2 size={14} /> 移除项目
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {props.expanded ? <DesktopThreadList id={`project-threads-${props.project.id}`} project={props.project} /> : null}
    </section>
  );
}
