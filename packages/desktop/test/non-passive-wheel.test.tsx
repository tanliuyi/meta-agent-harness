// @vitest-environment jsdom

import React, { act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNonPassiveWheel } from "../src/renderer/src/shared/hooks/use-non-passive-wheel.ts";

const target = document.createElement("div");
const targetRef: RefObject<HTMLDivElement | null> = { current: target };
let container: HTMLDivElement;
let root: Root;

function Harness({ handler }: { handler: (event: WheelEvent) => void }) {
  useNonPassiveWheel(targetRef, handler);
  return null;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useNonPassiveWheel", () => {
  it("registers a non-passive listener and calls the latest handler", async () => {
    const addEventListener = vi.spyOn(target, "addEventListener");
    const first = vi.fn((event: WheelEvent) => event.preventDefault());
    const second = vi.fn((event: WheelEvent) => event.preventDefault());

    await act(async () => root.render(<Harness handler={first} />));
    expect(addEventListener).toHaveBeenCalledWith("wheel", expect.any(Function), { passive: false });

    const firstEvent = new WheelEvent("wheel", { cancelable: true });
    expect(target.dispatchEvent(firstEvent)).toBe(false);
    expect(first).toHaveBeenCalledWith(firstEvent);

    await act(async () => root.render(<Harness handler={second} />));
    const secondEvent = new WheelEvent("wheel", { cancelable: true });
    target.dispatchEvent(secondEvent);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(secondEvent);
    expect(addEventListener).toHaveBeenCalledTimes(1);
  });
});
