import { useParams } from "@tanstack/react-router";
import { memo } from "react";
import { useDesktopSelector } from "../../state/desktop-context.tsx";
import { selectProjects } from "../../state/desktop-selectors.ts";
import { ProjectItem } from "./project-item.tsx";

interface ProjectListProps {
  newTaskDisabled: boolean;
  onNewTask(projectId: string): void;
}

/** 渲染 Project 与其活动 session 列表。 */
export const ProjectList = memo(function ProjectList({ newTaskDisabled, onNewTask }: ProjectListProps) {
  const projects = useDesktopSelector(selectProjects);
  const params = useParams({ strict: false }) as Record<string, string | undefined>;
  const activeProjectId = params.projectId;

  return (
    <ul className="m-0 list-none p-0">
      {projects.map((project) => (
        <ProjectItem
          key={project.id}
          project={project}
          active={activeProjectId === project.id}
          newTaskDisabled={newTaskDisabled}
          onNewTask={onNewTask}
        />
      ))}
    </ul>
  );
});
