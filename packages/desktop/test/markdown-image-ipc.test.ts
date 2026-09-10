import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerMarkdownImageIpc } from "../src/main/ipc/markdown-image-ipc.ts";
import { CHANNELS } from "../src/shared/channels.ts";

const electron = vi.hoisted(() => ({
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  serveMarkdownImage: vi.fn(),
  createFromBuffer: vi.fn(),
  write: vi.fn(),
}));

vi.mock("electron", () => ({
  nativeImage: { createFromBuffer: electron.createFromBuffer },
  clipboard: { write: electron.write },
  ClipboardItem: class {
    readonly items: Record<string, Blob>;
    constructor(items: Record<string, Blob>) {
      this.items = items;
    }
  },
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => electron.handles.set(channel, listener),
  },
}));

vi.mock("../src/main/settings/user-avatar-protocol.ts", () => ({
  serveMarkdownImage: electron.serveMarkdownImage,
}));

describe("Markdown image IPC", () => {
  beforeEach(() => {
    electron.handles.clear();
    electron.serveMarkdownImage.mockReset();
    electron.createFromBuffer.mockReset();
    electron.write.mockReset();
  });

  it("returns original image bytes for renderer downloads", async () => {
    electron.serveMarkdownImage.mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "image/gif" } }),
    );
    registerMarkdownImageIpc();

    const result = await electron.handles.get(CHANNELS.markdownImagesRead)?.({}, "C:/images/a.gif");

    expect(result).toMatchObject({ contentType: "image/gif" });
    expect(Array.from((result as { bytes: Uint8Array }).bytes)).toEqual([1, 2, 3]);
    expect(electron.serveMarkdownImage).toHaveBeenCalledWith("C:/images/a.gif");
  });

  it("copies decoded bytes without consulting viewport coordinates", async () => {
    const image = { isEmpty: () => false, toPNG: () => Buffer.from([7, 8]) };
    electron.createFromBuffer.mockReturnValue(image);
    registerMarkdownImageIpc();
    const bytes = Uint8Array.from([1, 2, 3]);
    await electron.handles.get(CHANNELS.markdownImagesCopy)?.({}, bytes);
    expect(electron.createFromBuffer).toHaveBeenCalledWith(Buffer.from(bytes));
    const items = electron.write.mock.calls[0]?.[0] as Array<{ items: Record<string, Blob> }>;
    const png = items[0]!.items["image/png"]!;
    expect(png.type).toBe("image/png");
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(new Uint8Array([7, 8]));
  });

  it("rejects invalid decoded bytes without replacing the clipboard", async () => {
    electron.createFromBuffer.mockReturnValue({ isEmpty: () => true });
    registerMarkdownImageIpc();
    await expect(electron.handles.get(CHANNELS.markdownImagesCopy)?.({}, new Uint8Array([0]))).rejects.toThrow(
      "Unable to decode image",
    );
    expect(electron.write).not.toHaveBeenCalled();
  });

  it("waits for the system clipboard and propagates write failures", async () => {
    electron.createFromBuffer.mockReturnValue({ isEmpty: () => false, toPNG: () => Buffer.from([7]) });
    let reject!: (error: Error) => void;
    electron.write.mockReturnValue(
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
    );
    registerMarkdownImageIpc();
    let settled = false;
    const copying = Promise.resolve(electron.handles.get(CHANNELS.markdownImagesCopy)?.({}, new Uint8Array([1])));
    const result = copying.then(
      () => {
        settled = true;
      },
      (error) => {
        settled = true;
        throw error;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    reject(new Error("clipboard unavailable"));
    await expect(result).rejects.toThrow("clipboard unavailable");
  });

  it("rejects missing images", async () => {
    electron.serveMarkdownImage.mockResolvedValue(new Response("Not found", { status: 404 }));
    registerMarkdownImageIpc();

    await expect(electron.handles.get(CHANNELS.markdownImagesRead)?.({}, "/missing.png")).rejects.toThrow(
      "Unable to read image: 404",
    );
  });
});
