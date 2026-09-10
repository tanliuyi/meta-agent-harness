import { ClipboardItem, clipboard, ipcMain, nativeImage } from "electron";
import { CHANNELS } from "../../shared/channels.ts";
import type { MarkdownImageData } from "../../shared/markdown-image-contracts.ts";
import { serveMarkdownImage } from "../settings/user-avatar-protocol.ts";

export const MARKDOWN_IMAGE_IPC_CHANNELS = [CHANNELS.markdownImagesRead, CHANNELS.markdownImagesCopy] as const;

export function registerMarkdownImageIpc(): readonly string[] {
  ipcMain.handle(CHANNELS.markdownImagesRead, (_event, source: string) => readMarkdownImage(source));
  ipcMain.handle(CHANNELS.markdownImagesCopy, async (_event, png: Uint8Array) => {
    if (!(png instanceof Uint8Array)) throw new Error("Invalid image bytes");
    const image = nativeImage.createFromBuffer(Buffer.from(png));
    if (image.isEmpty()) throw new Error("Unable to decode image");
    await clipboard.write([
      new ClipboardItem({ "image/png": new Blob([Uint8Array.from(image.toPNG())], { type: "image/png" }) }),
    ]);
  });
  return MARKDOWN_IMAGE_IPC_CHANNELS;
}

async function readMarkdownImage(source: string): Promise<MarkdownImageData> {
  const response = await serveMarkdownImage(source);
  if (!response.ok) throw new Error(`Unable to read image: ${response.status}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}
