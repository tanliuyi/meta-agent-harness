import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { DraftSessionConfig, Project } from "../../../../shared/contracts.ts";

export const Route = createFileRoute("/new")({ component: NewRoute });

type DraftPhase = "loading" | "editing" | "materializing" | "no-project";

/** A single renderer-only draft; no Pi session exists until its first valid submit. */
function NewRoute() {
  const search = useSearch({ strict: false }) as Record<string, string | undefined>;
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(search.projectId ?? null);
  const [config, setConfig] = useState<DraftSessionConfig | null>(null);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<DraftPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const submitInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void window.desktop.projects
      .list()
      .then((next) => {
        if (!active) return;
        const available = next.filter((project) => project.available);
        setProjects(available);
        setProjectId((selected) =>
          available.some((project) => project.id === selected) ? selected : (available[0]?.id ?? null),
        );
        setPhase(available.length ? "editing" : "no-project");
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setPhase("no-project");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!projectId) {
      setConfig(null);
      return;
    }
    let active = true;
    setConfig(null);
    void window.desktop.sessions
      .getDraftConfig(projectId)
      .then((next) => {
        if (active) setConfig(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlight.current || !projectId || !config?.model || !text.trim() || config.readiness.state !== "ready")
      return;
    submitInFlight.current = true;
    setPhase("materializing");
    setError(null);
    let threadId: string | null = null;
    try {
      const bootstrap = await window.desktop.sessions.create({
        projectId,
        createRequestId: crypto.randomUUID(),
        model: { provider: config.model.provider, id: config.model.id },
        thinkingLevel: config.thinkingLevel,
      });
      threadId = bootstrap.threadId;
      const result = await window.desktop.sessions.prompt({
        requestId: crypto.randomUUID(),
        projectId,
        threadId,
        text,
        images: [],
      });
      if (!result.accepted) throw new Error(result.error ?? "Pi 未接受此输入");
      await navigate({ to: "/projects/$projectId/session/$threadId", params: { projectId, threadId }, replace: true });
    } catch (reason) {
      if (threadId) await window.desktop.sessions.remove(projectId, threadId).catch(() => undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
      setPhase("editing");
    } finally {
      submitInFlight.current = false;
    }
  }

  if (phase === "no-project")
    return (
      <main className="workspace">
        <div className="empty-chat-state">
          <strong>没有可用 Project</strong>
          {error && <span>{error}</span>}
        </div>
      </main>
    );
  const sendingDisabled =
    phase !== "editing" || !projectId || !config?.model || config.readiness.state !== "ready" || !text.trim();
  return (
    <main className="workspace">
      <section className="empty-chat-state">
        <strong>新会话</strong>
        <form onSubmit={submit} className="flex w-full max-w-2xl flex-col gap-3">
          <select
            value={projectId ?? ""}
            disabled={phase === "materializing"}
            onChange={(event) => setProjectId(event.target.value || null)}
            aria-label="Project"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <textarea
            value={text}
            disabled={phase === "materializing"}
            onChange={(event) => setText(event.target.value)}
            placeholder="发送消息"
            aria-label="消息"
          />
          {config && <span>{config.readiness.state === "ready" ? config.model?.name : config.readiness.message}</span>}
          {error && <span role="alert">{error}</span>}
          <button type="submit" disabled={sendingDisabled}>
            {phase === "materializing" ? "创建会话中" : "发送"}
          </button>
        </form>
      </section>
    </main>
  );
}
