import { useSyncExternalStore } from "react";
import type { UpdaterState } from "../../../shared/updater-contracts.ts";

let snapshot: UpdaterState = { status: "idle", currentVersion: "" };
let initialized = false;
const listeners = new Set<() => void>();

function publish(next: UpdaterState): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function initialize(): void {
  if (initialized) return;
  initialized = true;
  window.desktop.updater.onStateChanged(publish);
  void window.desktop.updater.getState().then(publish, (error: unknown) => {
    publish({
      ...snapshot,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function subscribe(listener: () => void): () => void {
  initialize();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): UpdaterState {
  initialize();
  return snapshot;
}

/** Subscribes to the process-wide updater state exposed by preload. */
export function useUpdaterState(): UpdaterState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const updaterActions = {
  check: () => window.desktop.updater.check().catch(() => undefined),
  download: () => window.desktop.updater.download().catch(() => undefined),
  install: () => window.desktop.updater.install().catch(() => undefined),
};
