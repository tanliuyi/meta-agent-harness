import { useEffect } from "react";

const REVISION_POLL_INTERVAL_MS = 5_000;

export function useDocumentRevisionPolling(checkForChanges: () => Promise<void>): void {
  useEffect(() => startDocumentRevisionPolling(checkForChanges), [checkForChanges]);
}

export function startDocumentRevisionPolling(
  checkForChanges: () => Promise<void>,
  intervalMs = REVISION_POLL_INTERVAL_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checking = false;
  let stopped = false;

  const clearScheduled = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clearScheduled();
    if (stopped || document.visibilityState === "hidden") return;
    timer = setTimeout(() => {
      timer = undefined;
      void check();
    }, intervalMs);
  };
  const check = async () => {
    if (stopped || checking || document.visibilityState === "hidden") return;
    checking = true;
    try {
      await checkForChanges();
    } finally {
      checking = false;
      schedule();
    }
  };
  const onFocus = () => {
    clearScheduled();
    void check();
  };
  const onVisibility = () => {
    clearScheduled();
    if (document.visibilityState !== "hidden") void check();
  };

  schedule();
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stopped = true;
    clearScheduled();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
