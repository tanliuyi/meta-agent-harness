import { useSyncExternalStore } from "react";
import type { SessionToolUpdate } from "../../../shared/contracts.ts";

const updates = new Map<string, SessionToolUpdate>();
const listeners = new Map<string, Set<() => void>>();

export function applyToolUpdate(update: SessionToolUpdate): void {
  updates.set(update.toolCallId, update);
  for (const listener of listeners.get(update.toolCallId) ?? []) listener();
}

export function clearToolUpdates(): void {
  if (updates.size === 0) return;
  updates.clear();
  for (const entries of listeners.values()) {
    for (const listener of entries) listener();
  }
}

export function useToolUpdate(toolCallId: string): SessionToolUpdate | undefined {
  return useSyncExternalStore(
    (listener) => {
      let entries = listeners.get(toolCallId);
      if (!entries) {
        entries = new Set();
        listeners.set(toolCallId, entries);
      }
      entries.add(listener);
      return () => {
        entries.delete(listener);
        if (entries.size === 0) listeners.delete(toolCallId);
      };
    },
    () => updates.get(toolCallId),
    () => undefined,
  );
}
