import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followResizingContentToBottom } from "../src/renderer/src/shared/lib/follow-resizing-content-to-bottom.ts";

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }

  resize() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function createViewport(clientHeight: number, scrollHeight: number) {
  const listeners = new Set<EventListener>();
  return {
    clientHeight,
    scrollHeight,
    scrollTop: 0,
    addEventListener: vi.fn((_type: "scroll", listener: EventListener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: "scroll", listener: EventListener) => listeners.delete(listener)),
    scroll() {
      for (const listener of listeners) listener(new Event("scroll"));
    },
  };
}

describe("tool detail bottom follow", () => {
  const frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames.length = 0;
    ResizeObserverStub.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pins overflowing details initially and after a streaming delta", () => {
    const viewport = createViewport(100, 240);
    const content = {} as Element;
    followResizingContentToBottom(viewport, content);

    expect(ResizeObserverStub.instances[0]?.observe).toHaveBeenCalledWith(content);
    frames.shift()?.(0);
    expect(viewport.scrollTop).toBe(240);

    viewport.scrollHeight = 420;
    ResizeObserverStub.instances[0]?.resize();
    frames.shift()?.(1);
    expect(viewport.scrollTop).toBe(420);
  });

  it("pauses after the user scrolls away and resumes when they return to the bottom", () => {
    const viewport = createViewport(100, 240);
    followResizingContentToBottom(viewport, {} as Element, { respectUserScroll: true });
    frames.shift()?.(0);

    viewport.scrollTop = 60;
    viewport.scroll();
    viewport.scrollHeight = 420;
    ResizeObserverStub.instances[0]?.resize();
    frames.shift()?.(1);
    expect(viewport.scrollTop).toBe(60);

    viewport.scrollTop = 320;
    viewport.scroll();
    viewport.scrollHeight = 500;
    ResizeObserverStub.instances[0]?.resize();
    frames.shift()?.(2);
    expect(viewport.scrollTop).toBe(500);
  });

  it("does not scroll non-overflowing details and cleans up pending work", () => {
    const viewport = createViewport(100, 80);
    const stop = followResizingContentToBottom(viewport, {} as Element, { respectUserScroll: true });

    frames.shift()?.(0);
    expect(viewport.scrollTop).toBe(0);

    ResizeObserverStub.instances[0]?.resize();
    stop();
    expect(ResizeObserverStub.instances[0]?.disconnect).toHaveBeenCalledOnce();
    expect(viewport.removeEventListener).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
  });
});
