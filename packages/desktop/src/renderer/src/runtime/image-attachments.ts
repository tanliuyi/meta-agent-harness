import { type Attachment, SimpleImageAttachmentAdapter } from "@assistant-ui/react";
import type { ImageInput } from "../../../shared/contracts.ts";

/** Composer 与 Pi enqueue 共用的图片附件适配器。 */
export const imageAttachmentAdapter = new SimpleImageAttachmentAdapter();

type ComposerAttachment = Attachment;
type PendingImageAttachment = Parameters<SimpleImageAttachmentAdapter["send"]>[0];

/** 将 assistant-ui Composer 中的图片附件转换为 Pi IPC 输入。 */
export async function toPiImageInputs(attachments: readonly Attachment[]): Promise<ImageInput[]> {
  const images: ImageInput[] = [];
  for (const attachment of attachments) {
    const complete = isPendingImageAttachment(attachment) ? await imageAttachmentAdapter.send(attachment) : attachment;
    for (const part of complete.content) {
      if (part.type !== "image") continue;
      images.push(parseImageDataUrl(part.image, part.filename ?? attachment.name));
    }
  }
  return images;
}

function isPendingImageAttachment(attachment: ComposerAttachment): attachment is PendingImageAttachment {
  return attachment.status.type !== "complete";
}

function parseImageDataUrl(dataUrl: string, name: string): ImageInput {
  const comma = dataUrl.indexOf(",");
  const metadata = comma === -1 ? "" : dataUrl.slice(0, comma);
  const match = /^data:([^;,]+);base64$/i.exec(metadata);
  if (!match?.[1]) throw new Error(`无法读取图片附件: ${name}`);
  return {
    name,
    mimeType: match[1],
    data: dataUrl.slice(comma + 1),
  };
}
