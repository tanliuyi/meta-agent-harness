import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2.mjs";
import Circle from "lucide-react/dist/esm/icons/circle.mjs";
import Link2 from "lucide-react/dist/esm/icons/link-2.mjs";
import ListTodo from "lucide-react/dist/esm/icons/list-todo.mjs";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.mjs";
import type {
  DesktopTodoTaskStatus,
  DesktopTodoWidgetContent,
} from "../../../../shared/desktop-extension-contracts.ts";

export function SessionTodoList({ content }: { content: DesktopTodoWidgetContent }) {
  const progress = content.summary.total === 0 ? 0 : (content.summary.completed / content.summary.total) * 100;
  return (
    <section className="border-t border-border/60 px-3 pb-3 pt-3" data-slot="session-todo-list">
      <header className="flex items-center gap-2">
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
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
      </div>
      <ul className="m-0 grid list-none gap-0.5 pt-2" aria-live="polite">
        {content.tasks.map((task) => (
          <li key={task.id} className="flex min-w-0 items-start gap-2 rounded-md px-1 py-1.5">
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
          <li className="px-1 pt-1 text-[11px] text-muted-foreground">
            +{content.hiddenTaskCount} {content.labels.more}
          </li>
        ) : null}
      </ul>
    </section>
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
