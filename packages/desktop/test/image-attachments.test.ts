import { describe, expect, it } from "vitest";
import { imageAttachmentAdapter, toPiImageInputs } from "../src/renderer/src/runtime/image-attachments.ts";

describe("assistant-ui 图片附件", () => {
  it("将 pending 图片转换为 Pi IPC 输入", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "screen.png", { type: "image/png" });
    const attachment = await imageAttachmentAdapter.add({ file });

    await expect(toPiImageInputs([attachment])).resolves.toEqual([
      {
        name: "screen.png",
        mimeType: "image/png",
        data: "AQID",
      },
    ]);
  });

  it("保留已完成附件的文件名", async () => {
    await expect(
      toPiImageInputs([
        {
          id: "image-1",
          type: "image",
          name: "fallback.png",
          status: { type: "complete" },
          content: [{ type: "image", image: "data:image/jpeg;base64,/9j/", filename: "photo.jpg" }],
        },
      ]),
    ).resolves.toEqual([
      {
        name: "photo.jpg",
        mimeType: "image/jpeg",
        data: "/9j/",
      },
    ]);
  });
});
