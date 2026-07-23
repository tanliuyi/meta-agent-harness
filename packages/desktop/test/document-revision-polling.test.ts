import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startDocumentRevisionPolling } from "../src/renderer/src/features/settings/use-document-revision-polling.ts";

describe("document revision polling", () => {
  let windowTarget: EventTarget;
  let documentTarget: EventTarget;
  let visibilityState: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    windowTarget = new EventTarget();
    documentTarget = new EventTarget();
    visibilityState = "visible";
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("document", {
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
      get visibilityState() {
        return visibilityState;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("keeps a single polling chain when focus triggers an immediate check", async () => {
    const check = vi.fn(async () => undefined);
    const stop = startDocumentRevisionPolling(check, 100);

    windowTarget.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(check).toHaveBeenCalledTimes(3);

    stop();
  });

  test("continues polling after a check has no work", async () => {
    const check = vi.fn(async () => undefined);
    const stop = startDocumentRevisionPolling(check, 100);

    await vi.advanceTimersByTimeAsync(200);

    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  test("pauses while hidden and checks immediately when visible", async () => {
    const check = vi.fn(async () => undefined);
    const stop = startDocumentRevisionPolling(check, 100);

    visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(200);
    expect(check).not.toHaveBeenCalled();

    visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);

    stop();
  });
});
