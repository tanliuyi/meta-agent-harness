import { useEffect, useState } from "react";
import type { NodeRuntimeProgress, NodeRuntimeStatus } from "../../shared/desktop-api.ts";
import { ChatThread } from "./components/chat/chat-thread.tsx";
import { Sidebar } from "./components/layout/sidebar.tsx";
import { Topbar } from "./components/layout/topbar.tsx";
import { WindowsHeader } from "./components/layout/windows-header.tsx";
import { BottomTerminal } from "./components/panel/bottom-terminal.tsx";
import { WorkbenchPanel } from "./components/panel/workbench-panel.tsx";
import { errorMessage } from "./lib/error-message.ts";
import { useDesktop } from "./state/desktop-context.tsx";

/** Meta Agent Desktop 主工作台。 */
export function App() {
  const { project, threadId, snapshot, loading, error, clearError } = useDesktop();
  const [nodeRuntime, setNodeRuntime] = useState<NodeRuntimeStatus | null>(null);
  const [nodeProgress, setNodeProgress] = useState<NodeRuntimeProgress | null>(null);
  const [installingNode, setInstallingNode] = useState(false);
  const sessionKey = project && threadId ? `${project.id}:${threadId}` : "empty";
  const windowTitle = snapshot?.extensionUi.windowTitle ?? snapshot?.title ?? project?.name ?? "Meta Agent";
  useEffect(() => {
    document.title = windowTitle;
  }, [windowTitle]);
  useEffect(() => {
    let active = true;
    void window.desktop.nodeRuntime.getStatus().then((status) => {
      if (active) setNodeRuntime(status);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => window.desktop.nodeRuntime.onProgress(setNodeProgress), []);
  const installNode = async () => {
    setInstallingNode(true);
    try {
      const status = await window.desktop.nodeRuntime.install();
      setNodeRuntime(status);
    } catch (value) {
      setNodeProgress({ phase: "error", percent: 0, message: "Node.js 安装失败", error: errorMessage(value) });
    } finally {
      setInstallingNode(false);
    }
  };
  const platform = window.desktop.platform;
  return (
    <div className="app-frame" data-platform={platform}>
      {platform === "win32" ? <WindowsHeader title={windowTitle} /> : null}
      <div className="app-shell">
        {nodeRuntime && nodeRuntime.state !== "ready" ? (
          <section className="node-runtime-blocker" role="alert">
            <div>
              <strong>需要 Node.js 才能运行 Desktop sidecar</strong>
              <p>{nodeProgress?.message ?? nodeRuntime.message}</p>
              <small>安装完成后 Desktop 会自动重启并重新连接 Pi。</small>
            </div>
            <div className="node-runtime-actions">
              <button type="button" onClick={() => void installNode()} disabled={installingNode}>
                {installingNode ? `安装中 ${nodeProgress?.percent ?? 0}%` : "一键安装 Node.js"}
              </button>
              {nodeProgress && nodeProgress.phase !== "error" ? (
                <progress max={100} value={nodeProgress.percent} aria-label="Node.js 安装进度" />
              ) : null}
            </div>
          </section>
        ) : null}
        <Sidebar />
        <section className="workspace">
          <Topbar />
          <div className="workspace-row">
            <main className="chat-workspace">
              {loading ? <div className="app-loading">正在恢复工作区...</div> : <ChatThread />}
            </main>
            <WorkbenchPanel key={sessionKey} />
          </div>
          <BottomTerminal key={sessionKey} />
        </section>
        {error ? (
          <div className="error-toast" role="alert">
            <pre>{error}</pre>
            <button type="button" onClick={clearError}>
              关闭
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
