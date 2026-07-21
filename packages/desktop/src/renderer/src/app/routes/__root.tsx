import { createRootRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { Sidebar } from "../../components/layout/sidebar.tsx";
import { SessionCacheHost } from "../../components/session-cache-host.tsx";
import { NodeRuntimeGate } from "../../features/node-runtime/node-runtime-gate.tsx";
import { DesktopCatalogProvider } from "../../state/desktop-catalog-provider.tsx";
import { useSessionCacheSnapshot } from "../../state/session-cache-context.tsx";
import { DesktopErrorToast } from "../desktop-error-toast.tsx";
import { DesktopWindowTitle } from "../desktop-window-title.tsx";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <Navigate to="/" replace />,
});

/** Keeps cached activities mounted while the route outlet moves through settings and navigation. */
function RootLayout() {
  const cache = useSessionCacheSnapshot();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isSettings = pathname.startsWith("/settings");
  return (
    <div className="app-frame" data-platform={window.desktop.platform}>
      <DesktopWindowTitle />
      <div className="app-shell">
        {isSettings ? null : (
          <DesktopCatalogProvider>
            <NodeRuntimeGate />
            <Sidebar />
            <DesktopErrorToast />
          </DesktopCatalogProvider>
        )}
        <SessionCacheHost records={cache.records} activeKey={isSettings ? null : cache.activeKey} />
        <Outlet />
      </div>
    </div>
  );
}
