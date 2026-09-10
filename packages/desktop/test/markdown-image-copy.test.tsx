// @vitest-environment jsdom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownImage } from "../src/renderer/src/components/assistant-ui/streamdown/streamdown-image.tsx";

vi.mock("../src/renderer/src/components/assistant-ui/attachment/attachment-preview.tsx", () => ({
  AttachmentPreview: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/renderer/src/components/assistant-ui/tooltip-icon-button.tsx", () => ({
  TooltipIconButton: ({ tooltip, onClick, children }: { tooltip: string; onClick?(): void; children: ReactNode }) => (
    <button title={tooltip} onClick={onClick}>
      {children}
    </button>
  ),
}));
let root: Root;
let container: HTMLDivElement;
const read = vi.fn();
const copy = vi.fn();
const close = vi.fn();
const drawImage = vi.fn();
const convertToBlob = vi.fn();
const decode = vi.fn();
const canvas = vi.fn();
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  read.mockResolvedValue({ bytes: new Uint8Array([1, 2]), contentType: "image/webp" });
  copy.mockResolvedValue(undefined);
  decode.mockResolvedValue({ width: 2400, height: 1600, close });
  convertToBlob.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([9, 8]).buffer });
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(width: number, height: number) {
        canvas(width, height);
      }
      getContext() {
        return { drawImage };
      }
      convertToBlob = convertToBlob;
    },
  );
  Object.defineProperty(window, "desktop", { configurable: true, value: { markdownImages: { read, copy } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("Markdown image copy", () => {
  it("copies natural-size source bytes when the image is clipped outside the viewport", async () => {
    await act(async () => root.render(<MarkdownImage src="/images/a.webp" />));
    const bounds = vi.spyOn(container.querySelector("img")!, "getBoundingClientRect").mockImplementation(() => {
      throw new Error("clipped coordinates must not be read");
    });
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="复制图片"]')!.click());
    expect(read).toHaveBeenCalledWith("/images/a.webp");
    expect(canvas).toHaveBeenCalledWith(2400, 1600);
    expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 2400 }), 0, 0);
    expect(copy).toHaveBeenCalledWith(new Uint8Array([9, 8]));
    expect(close).toHaveBeenCalledOnce();
    expect(bounds).not.toHaveBeenCalled();
    expect(container.querySelector('button[title="已复制"]')).not.toBeNull();
  });
  it("reports decode errors and does not write invalid bytes", async () => {
    decode.mockRejectedValueOnce(new Error("invalid bytes"));
    await act(async () => root.render(<MarkdownImage src="data:image/gif;base64,invalid" />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="复制图片"]')!.click());
    expect(copy).not.toHaveBeenCalled();
    expect(container.querySelector('button[title="复制失败"]')).not.toBeNull();
  });
  it("releases the decoded bitmap when clipboard writing fails", async () => {
    copy.mockRejectedValueOnce(new Error("clipboard unavailable"));
    await act(async () => root.render(<MarkdownImage src="https://example.com/a.avif" />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="复制图片"]')!.click());
    expect(close).toHaveBeenCalledOnce();
    expect(container.querySelector('button[title="复制失败"]')).not.toBeNull();
  });
});
