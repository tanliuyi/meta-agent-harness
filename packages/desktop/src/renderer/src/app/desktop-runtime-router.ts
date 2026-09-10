import { isDesktopRoute } from "../../../shared/desktop-runtime-contracts.ts";

interface RuntimeRouter {
  readonly state: { location: { pathname: string; href: string }; status: string; isLoading: boolean };
  navigate(options: { to: string }): Promise<void>;
}

/** A named renderer operation for the main-owned bridge; no IPC method dispatch. */
export function createDesktopRuntimeRouter(router: RuntimeRouter) {
  const state = () => ({
    path: router.state.location.pathname,
    href: router.state.location.href,
    status: router.state.status,
    isLoading: router.state.isLoading,
  });
  return {
    state,
    async navigate(path: string) {
      if (!isDesktopRoute(path)) throw new Error("Unsupported Desktop route");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          router.navigate({ to: path }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Desktop navigation timed out")), 10_000);
          }),
        ]);
        const observed = state();
        return { requestedPath: path, reached: observed.path === path, ...observed };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
