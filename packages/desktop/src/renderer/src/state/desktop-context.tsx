import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { DevToolsModal } from "@assistant-ui/react-devtools";
import { createContext, type ReactNode, useContext, useRef } from "react";
import type { DesktopThreadActions } from "../runtime/use-pi-runtime.ts";
import { usePiRuntime } from "../runtime/use-pi-runtime.ts";
import type { DesktopContextValue } from "./desktop-model.ts";
import { useDesktopController } from "./use-desktop-controller.ts";

const DesktopContext = createContext<DesktopContextValue | null>(null);

/** 向 renderer 组件树注入 Desktop controller。 */
export function DesktopProvider({ children }: { children: ReactNode }) {
  const threadActions = useRef<DesktopThreadActions | null>(null);
  const desktop = useDesktopController(threadActions);
  const { runtime, actions } = usePiRuntime({
    projects: desktop.projects,
    project: desktop.project,
    threadCatalogs: desktop.threadCatalogs,
    threadId: desktop.threadId,
    isSendDisabled: desktop.draft
      ? desktop.draft.config?.readiness.state !== "ready"
      : desktop.snapshot?.readiness.state !== "ready",
  });
  threadActions.current = actions;
  return (
    <DesktopContext.Provider value={desktop}>
      <AssistantRuntimeProvider runtime={runtime}>
        <DevToolsModal />
        {children}
      </AssistantRuntimeProvider>
    </DesktopContext.Provider>
  );
}

/** 读取 Desktop 工作台状态。 */
export function useDesktop(): DesktopContextValue {
  const value = useContext(DesktopContext);
  if (!value) throw new Error("useDesktop 必须在 DesktopProvider 内使用");
  return value;
}
