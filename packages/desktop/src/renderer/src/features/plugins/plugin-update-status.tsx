import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { updateAvailable } from "./plugin-marketplace-utils.ts";

export const MARKETPLACE_PLUGINS_CHANGED_EVENT = "pi-desktop:marketplace-plugins-changed";

const PluginUpdatesAvailableContext = createContext(false);

export function notifyMarketplacePluginsChanged(): void {
  window.dispatchEvent(new Event(MARKETPLACE_PLUGINS_CHANGED_EVENT));
}

export function PluginUpdateStatusProvider({ children }: { children: ReactNode }) {
  const [updatesAvailable, setUpdatesAvailable] = useState(false);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    try {
      const installed = await window.desktop.marketplace.getInstalled();
      const plugins = await Promise.allSettled(
        installed.plugins.map((plugin) => window.desktop.marketplace.getPlugin(plugin.id)),
      );
      if (generation !== requestGeneration.current) return;
      setUpdatesAvailable(
        plugins.some(
          (plugin) =>
            plugin.status === "fulfilled" && plugin.value !== null && updateAvailable(plugin.value, installed.plugins),
        ),
      );
    } catch {
      // A temporary marketplace failure must not clear a previously discovered update.
    }
  }, []);

  useEffect(() => {
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(MARKETPLACE_PLUGINS_CHANGED_EVENT, onFocus);
    return () => {
      requestGeneration.current += 1;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(MARKETPLACE_PLUGINS_CHANGED_EVENT, onFocus);
    };
  }, [refresh]);

  return (
    <PluginUpdatesAvailableContext.Provider value={updatesAvailable}>{children}</PluginUpdatesAvailableContext.Provider>
  );
}

export function usePluginUpdatesAvailable(): boolean {
  return useContext(PluginUpdatesAvailableContext);
}
