import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check.mjs";
import CircleX from "lucide-react/dist/esm/icons/circle-x.mjs";
import Clock from "lucide-react/dist/esm/icons/clock.mjs";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.mjs";
import Workflow from "lucide-react/dist/esm/icons/workflow.mjs";
import { useState } from "react";
import type {
  DesktopSubagentWidgetContent,
  DesktopSubagentWidgetNode,
} from "../../../../shared/desktop-extension-contracts.ts";

export function SessionSubagentStatus({
  content,
  sessionKey,
}: {
  content: DesktopSubagentWidgetContent;
  sessionKey: string;
}) {
  return <SessionSubagentStatusContent key={sessionKey} content={content} />;
}

function SessionSubagentStatusContent({ content }: { content: DesktopSubagentWidgetContent }) {
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});

  return (
    <section className="session-subagents" data-slot="session-subagent-status">
      <header className="session-subagents-header">
        <span className="session-subagents-icon">
          <Bot aria-hidden="true" />
        </span>
        <span className="session-subagents-title">子代理</span>
      </header>
      <dl className="session-subagents-summary" aria-label="子代理运行摘要">
        <SummaryField label="活动" value={String(content.summary.activeAgents)} tone="active" />
        <SummaryField
          label="异步运行"
          value={`${content.summary.asyncRunsUsed}/${content.summary.asyncRunsLimit || "∞"}`}
        />
        <SummaryField label="Token" value={formatCompactNumber(content.summary.totalTokens)} />
      </dl>
      <div className="session-subagent-runs">
        {content.nodes.map((node) => {
          const identity = nodeIdentity("root", node);
          return (
            <SubagentRunCard
              key={identity}
              node={node}
              identity={identity}
              expandedById={expandedById}
              onExpandedChange={(nodeId, expanded) =>
                setExpandedById((current) => ({ ...current, [nodeId]: expanded }))
              }
            />
          );
        })}
      </div>
      {content.omittedNodeCount > 0 ? (
        <p className="session-subagent-omitted">另有 {content.omittedNodeCount} 项未包含在状态数据中</p>
      ) : null}
    </section>
  );
}

function SummaryField({ label, value, tone }: { label: string; value: string; tone?: "active" }) {
  return (
    <div data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SubagentRunCard({
  node,
  identity,
  expandedById,
  onExpandedChange,
}: {
  node: DesktopSubagentWidgetNode;
  identity: string;
  expandedById: Record<string, boolean>;
  onExpandedChange(identity: string, expanded: boolean): void;
}) {
  const hasDetails = nodeHasDetails(node);
  const expanded = expandedById[identity] ?? false;
  const state = displayState(node.state, node.verdict);
  const contentId = `subagent-details-${safeDomId(identity)}`;
  const NodeIcon = node.kind === "workflow" ? Workflow : Bot;

  return (
    <article className="session-subagent-run" data-state={state.tone}>
      <div className="session-subagent-run-heading">
        <button
          type="button"
          className="session-subagent-disclosure"
          aria-expanded={hasDetails ? expanded : undefined}
          aria-controls={hasDetails ? contentId : undefined}
          disabled={!hasDetails}
          onClick={() => onExpandedChange(identity, !expanded)}
        >
          {hasDetails ? <ChevronRight className="session-subagent-chevron" aria-hidden="true" /> : null}
          <span className="session-subagent-kind-icon">
            <NodeIcon aria-hidden="true" />
          </span>
          <span className="session-subagent-run-labels">
            <strong title={displayLabel(node)}>{displayLabel(node)}</strong>
            <span>{nodeSummary(node)}</span>
          </span>
          <StatusIcon state={state} node={node} />
        </button>
      </div>
      {hasDetails && expanded ? (
        <div id={contentId} className="session-subagent-details">
          {displayDescription(node.description) ? (
            <p className="session-subagent-description">{displayDescription(node.description)}</p>
          ) : null}
          <NodeMetrics node={node} />
          {node.children?.length ? (
            <div className="session-subagent-child-list" aria-label={`${displayLabel(node)} 的任务`}>
              {node.children.map((child) => {
                const childIdentity = nodeIdentity(identity, child);
                return (
                  <SubagentChild
                    key={childIdentity}
                    node={child}
                    identity={childIdentity}
                    expandedById={expandedById}
                    onExpandedChange={onExpandedChange}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SubagentChild({
  node,
  identity,
  expandedById,
  onExpandedChange,
}: {
  node: DesktopSubagentWidgetNode;
  identity: string;
  expandedById: Record<string, boolean>;
  onExpandedChange(identity: string, expanded: boolean): void;
}) {
  const hasDetails = nodeHasDetails(node);
  const expanded = expandedById[identity] ?? false;
  const state = displayState(node.state, node.verdict);
  const contentId = `subagent-details-${safeDomId(identity)}`;

  return (
    <div className="session-subagent-child" data-state={state.tone}>
      <div className="session-subagent-child-row">
        <button
          type="button"
          className="session-subagent-child-trigger"
          aria-expanded={hasDetails ? expanded : undefined}
          aria-controls={hasDetails ? contentId : undefined}
          disabled={!hasDetails}
          onClick={() => onExpandedChange(identity, !expanded)}
        >
          {hasDetails ? <ChevronRight className="session-subagent-chevron" aria-hidden="true" /> : null}
          <span className="session-subagent-child-label">
            <strong title={displayLabel(node)}>{displayLabel(node)}</strong>
            <span>{nodeSummary(node)}</span>
          </span>
          <StatusIcon state={state} node={node} />
        </button>
      </div>
      {hasDetails && expanded ? (
        <div id={contentId} className="session-subagent-child-details">
          <NodeMetrics node={node} />
          {node.children?.length ? (
            <div className="session-subagent-child-list" aria-label={`${displayLabel(node)} 的任务`}>
              {node.children.map((child) => {
                const childIdentity = nodeIdentity(identity, child);
                return (
                  <SubagentChild
                    key={childIdentity}
                    node={child}
                    identity={childIdentity}
                    expandedById={expandedById}
                    onExpandedChange={onExpandedChange}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusIcon({ state, node }: { state: ReturnType<typeof displayState>; node: DesktopSubagentWidgetNode }) {
  const elapsed =
    node.startedAt === undefined
      ? undefined
      : formatElapsed(Math.max(0, (node.endedAt ?? Date.now()) - node.startedAt));
  const Icon =
    state.tone === "running"
      ? LoaderCircle
      : state.tone === "complete"
        ? CircleCheck
        : state.tone === "failed" || state.label === "已取消"
          ? CircleX
          : Clock;

  return (
    <span className="session-subagent-run-status">
      {elapsed ? (
        <span className="session-subagent-elapsed" title="耗时">
          {elapsed}
        </span>
      ) : null}
      <span
        className="session-subagent-status"
        data-tone={state.tone}
        role="img"
        aria-label={state.label}
        title={state.label}
      >
        <Icon aria-hidden="true" className={state.tone === "running" ? "motion-safe:animate-spin" : undefined} />
      </span>
    </span>
  );
}

function NodeMetrics({ node }: { node: DesktopSubagentWidgetNode }) {
  const metrics = [
    node.modelThinking ? ["模型 / 思考", node.modelThinking] : undefined,
    node.activity ? ["当前活动", displayActivity(node.activity)] : undefined,
    node.toolCount !== undefined ? ["工具调用", String(node.toolCount)] : undefined,
    node.turnCount !== undefined ? ["轮次", String(node.turnCount)] : undefined,
    node.tokens !== undefined && node.tokens > 0 ? ["Token", formatCompactNumber(node.tokens)] : undefined,
    node.window !== undefined && node.window > 0 ? ["上下文窗口", formatCompactNumber(node.window)] : undefined,
    node.verdict ? ["结论", verdictLabel(node.verdict)] : undefined,
  ].filter((metric): metric is string[] => metric !== undefined);

  return metrics.length > 0 ? (
    <dl className="session-subagent-metrics">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  ) : null;
}

function nodeIdentity(parentIdentity: string, node: DesktopSubagentWidgetNode): string {
  const runIdentity = node.runId ? `${node.runId}:` : "";
  return `${parentIdentity}/${node.kind}:${runIdentity}${node.id}`;
}

function nodeHasDetails(node: DesktopSubagentWidgetNode): boolean {
  return Boolean(
    node.description ||
      node.modelThinking ||
      node.activity ||
      node.tokens !== undefined ||
      node.window !== undefined ||
      node.toolCount !== undefined ||
      node.turnCount !== undefined ||
      node.verdict ||
      node.children?.length,
  );
}

function safeDomId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
}

function displayState(
  state: string,
  verdict?: DesktopSubagentWidgetNode["verdict"],
): { label: string; tone: "running" | "complete" | "failed" | "pending" } {
  if (verdict === "fail" || ["failed", "rejected", "error", "fail"].includes(state)) {
    return { label: "失败", tone: "failed" };
  }
  if (["running", "in_progress", "active"].includes(state)) return { label: "运行中", tone: "running" };
  if (["complete", "completed", "done", "pass"].includes(state)) return { label: "已完成", tone: "complete" };
  if (state === "cancelled" || state === "canceled") return { label: "已取消", tone: "pending" };
  if (state === "queued") return { label: "排队中", tone: "pending" };
  if (state === "pending") return { label: "等待中", tone: "pending" };
  return { label: state, tone: "pending" };
}

function displayLabel(node: DesktopSubagentWidgetNode): string {
  if (node.kind === "workflow" && node.label.trim().toLowerCase() === "workflow") return "工作流";
  return node.label;
}

function nodeSummary(node: DesktopSubagentWidgetNode): string {
  if (node.kind === "workflow") {
    const completed =
      node.children?.filter((child) => displayState(child.state, child.verdict).tone === "complete").length ?? 0;
    const progress = node.children?.length ? ` · ${completed}/${node.children.length} 完成` : "";
    return `${kindLabel(node.kind)}${progress}`;
  }
  if (node.activity) return displayActivity(node.activity);
  const description = displayDescription(node.description);
  return description && description !== node.label ? description : kindLabel(node.kind);
}

function displayDescription(description: string | undefined): string | undefined {
  if (!description?.startsWith("workflow child:")) return description;
  const humanDescriptionIndex = description.indexOf(" · ");
  return humanDescriptionIndex < 0 ? undefined : description.slice(humanDescriptionIndex + 3);
}

function displayActivity(activity: string): string {
  if (activity === "active_long_running" || activity === "long-running") return "长时间运行中";
  if (activity === "needs_attention" || activity === "needs attention") return "需要关注";
  if (activity.startsWith("tool ")) return `正在使用 ${activity.slice(5)}`;
  return activity;
}

function kindLabel(kind: DesktopSubagentWidgetNode["kind"]): string {
  switch (kind) {
    case "workflow":
      return "工作流";
    case "step":
      return "步骤";
    case "host-step":
      return "主机步骤";
    case "external":
      return "外部任务";
    case "project-pane":
      return "项目任务";
    case "subagent":
      return "子代理运行";
  }
}

function verdictLabel(verdict: NonNullable<DesktopSubagentWidgetNode["verdict"]>): string {
  if (verdict === "pass") return "通过";
  if (verdict === "fail") return "失败";
  return "未定";
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}分 ${remaining}秒`;
}
