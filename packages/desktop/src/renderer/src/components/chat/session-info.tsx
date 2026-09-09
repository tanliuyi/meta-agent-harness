import Check from "lucide-react/dist/esm/icons/check.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  DesktopSubagentWidgetContent,
  DesktopTodoWidgetContent,
} from "../../../../shared/desktop-extension-contracts.ts";
import { TooltipIconButton } from "../assistant-ui/tooltip-icon-button.tsx";
import { useSessionControlSelector, useSessionIdentity } from "../session-context.tsx";
import { SessionSubagentStatus } from "./session-subagent-status.tsx";
import { SessionTodoList } from "./session-todo-list.tsx";

/** 当前主会话的只读基本信息。 */
export function SessionInfo({ open }: { open: boolean }) {
  const identity = useSessionIdentity();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const syncScrollbarWidth = () => {
      const style = getComputedStyle(panel);
      const borderWidth = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth);
      const scrollbarWidth = Math.max(0, panel.offsetWidth - panel.clientWidth - borderWidth);
      panel.style.setProperty("--session-info-scrollbar-width", `${scrollbarWidth}px`);
    };
    syncScrollbarWidth();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(syncScrollbarWidth);
    observer?.observe(panel);
    return () => {
      observer?.disconnect();
      panel.style.removeProperty("--session-info-scrollbar-width");
    };
  }, []);

  const copySessionId = async () => {
    await navigator.clipboard.writeText(identity.threadId);
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <aside
      ref={panelRef}
      id="session-info-panel"
      className="session-info-panel"
      data-open={open}
      aria-hidden={!open}
      aria-label="会话信息"
    >
      <dl className="session-info-list session-info-list-technical">
        <div className="session-info-id-row">
          <dt>会话 ID</dt>
          <dd>
            <span className="session-info-id-value" title={identity.threadId}>
              {identity.threadId}
            </span>
            <TooltipIconButton
              className="session-info-copy"
              tooltip={copied ? "已复制" : "复制会话 ID"}
              side="top"
              onClick={() => void copySessionId().catch(() => undefined)}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </TooltipIconButton>
          </dd>
        </div>
      </dl>
      {open ? <SessionNativeWidgets sessionKey={`${identity.projectId}:${identity.threadId}`} /> : null}
    </aside>
  );
}

function SessionNativeWidgets({ sessionKey }: { sessionKey: string }) {
  const widgets = useSessionControlSelector((control) => control?.extensionHost.widgets);
  const todoLists = widgets
    ?.filter(
      (widget): widget is typeof widget & { nativeContent: DesktopTodoWidgetContent } =>
        widget.nativeContent?.type === "todo",
    )
    .map((widget) => <SessionTodoList key={widget.key} content={widget.nativeContent} />);
  const subagentWidgets = widgets?.filter(
    (widget): widget is typeof widget & { nativeContent: DesktopSubagentWidgetContent } =>
      widget.nativeContent?.type === "subagents",
  );
  const fleetWidget = subagentWidgets?.find((widget) => widget.nativeContent.source === "fleet");
  const asyncWidget = subagentWidgets?.find((widget) => widget.nativeContent.source === "async");
  const subagentContent = fleetWidget
    ? mergeSubagentContent(fleetWidget.nativeContent, asyncWidget?.nativeContent)
    : asyncWidget?.nativeContent;
  return (
    <>
      {todoLists}
      {subagentContent ? (
        <SessionSubagentStatus key={sessionKey} content={subagentContent} sessionKey={sessionKey} />
      ) : null}
    </>
  );
}

export function mergeSubagentContent(
  fleet: DesktopSubagentWidgetContent,
  asyncContent: DesktopSubagentWidgetContent | undefined,
): DesktopSubagentWidgetContent {
  if (!asyncContent) return fleet;
  const asyncByRunId = new Map(asyncContent.nodes.map((node) => [node.runId ?? node.id, node]));
  const fleetRunIds = new Set<string>();
  const mergedRunIds = new Set<string>();
  const terminalStates = new Set([
    "complete",
    "completed",
    "done",
    "failed",
    "rejected",
    "error",
    "partial",
    "paused",
    "stopped",
    "cancelled",
    "canceled",
  ]);
  const terminalOnly = (
    node: DesktopSubagentWidgetContent["nodes"][number],
  ): DesktopSubagentWidgetContent["nodes"][number] | undefined => {
    const children = node.children?.flatMap((child) => {
      const terminal = terminalOnly(child);
      return terminal ? [terminal] : [];
    });
    if (!terminalStates.has(node.state) && !node.verdict && !children?.length) return undefined;
    return { ...node, children };
  };
  const mergeFleetNodes = (nodes: DesktopSubagentWidgetContent["nodes"]): DesktopSubagentWidgetContent["nodes"] =>
    nodes.map((node) => {
      const children = node.children ? mergeFleetNodes(node.children) : undefined;
      if (!node.runId) return { ...node, children };
      fleetRunIds.add(node.runId);
      const asyncNode = asyncByRunId.get(node.runId);
      if (!asyncNode || node.kind === "workflow" || mergedRunIds.has(node.runId)) return { ...node, children };
      mergedRunIds.add(node.runId);
      const existingIds = new Set((children ?? []).map((child) => child.id));
      const terminalChildren = asyncNode.children?.flatMap((child) => {
        const terminal = terminalOnly(child);
        return terminal && !existingIds.has(terminal.id) ? [terminal] : [];
      });
      return terminalChildren?.length
        ? { ...node, children: [...(children ?? []), ...terminalChildren] }
        : { ...node, children };
    });

  const nodes = mergeFleetNodes(fleet.nodes);
  const asyncOnlyNodes = asyncContent.nodes.filter((node) => !fleetRunIds.has(node.runId ?? node.id));
  if (asyncOnlyNodes.length === 0 && asyncContent.omittedNodeCount === 0 && mergedRunIds.size === 0) return fleet;
  return {
    ...fleet,
    nodes: [...nodes, ...asyncOnlyNodes],
    omittedNodeCount: fleet.omittedNodeCount + asyncContent.omittedNodeCount,
  };
}
