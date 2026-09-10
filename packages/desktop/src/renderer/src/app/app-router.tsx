import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { createDesktopRuntimeRouter } from "./desktop-runtime-router.ts";
import { routeTree } from "./route-tree.gen";

const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
});

Object.defineProperty(window, "__desktopRuntimeRouter", {
  configurable: true,
  value: createDesktopRuntimeRouter(router),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/** 声明 renderer 的 TanStack Router 实例。 */
export function AppRouter() {
  return <RouterProvider router={router} />;
}
