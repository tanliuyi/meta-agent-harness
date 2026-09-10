import { AttachmentPreview } from "@renderer/components/assistant-ui/attachment/attachment-preview";
import { TooltipIconButton } from "@renderer/components/assistant-ui/tooltip-icon-button";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.mjs";
import Maximize from "lucide-react/dist/esm/icons/maximize.mjs";
import Quote from "lucide-react/dist/esm/icons/quote.mjs";
import { type ComponentPropsWithoutRef, useEffect, useRef, useState } from "react";
import {
  markdownImageFilename,
  markdownImageReference,
  markdownImageSourceForLoading,
  markdownImageSourceToUrl,
} from "../../../../../shared/markdown-image-contracts.ts";
import { useMarkdownImageReference } from "./streamdown-image-reference.tsx";

type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & { node?: unknown };
type ActionState = "idle" | "working" | "succeeded" | "error";

export function MarkdownImage({ src, alt = "", className, node: _node, ...props }: MarkdownImageProps) {
  const referenceImage = useMarkdownImageReference();
  const resetTimers = useRef(new Set<number>());
  const [downloadState, setDownloadState] = useState<ActionState>("idle");
  const [copyState, setCopyState] = useState<ActionState>("idle");
  const [referenced, setReferenced] = useState(false);
  const resolvedSrc = src ? markdownImageSourceToUrl(src) : undefined;
  const imageClassName = className ? `markdown-image ${className}` : "markdown-image";
  const description = alt || "Markdown 图片";

  useEffect(
    () => () => {
      for (const timer of resetTimers.current) window.clearTimeout(timer);
    },
    [],
  );

  const resetFeedbackAfterDelay = (callback: () => void) => {
    const timer = window.setTimeout(() => {
      resetTimers.current.delete(timer);
      callback();
    }, 2_000);
    resetTimers.current.add(timer);
  };

  const downloadImage = async () => {
    if (!src || downloadState === "working") return;
    setDownloadState("working");
    try {
      const data = await window.desktop.markdownImages.read(markdownImageSourceForLoading(src));
      const objectUrl = URL.createObjectURL(new Blob([data.bytes], { type: data.contentType }));
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = markdownImageFilename(src ?? "", alt);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setDownloadState("succeeded");
      resetFeedbackAfterDelay(() => setDownloadState("idle"));
    } catch {
      setDownloadState("error");
      resetFeedbackAfterDelay(() => setDownloadState("idle"));
    }
  };

  const copyImage = async () => {
    if (!src || copyState === "working") return;
    setCopyState("working");
    try {
      // Decode validated bytes at natural size, independent of viewport clipping and CORS.
      const data = await window.desktop.markdownImages.read(markdownImageSourceForLoading(src));
      const image = await createImageBitmap(new Blob([data.bytes], { type: data.contentType }));
      try {
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image conversion is unavailable");
        context.drawImage(image, 0, 0);
        const png = await canvas.convertToBlob({ type: "image/png" });
        await window.desktop.markdownImages.copy(new Uint8Array(await png.arrayBuffer()));
      } finally {
        image.close();
      }
      setCopyState("succeeded");
      resetFeedbackAfterDelay(() => setCopyState("idle"));
    } catch {
      setCopyState("error");
      resetFeedbackAfterDelay(() => setCopyState("idle"));
    }
  };

  const reference = () => {
    if (!src || !referenceImage) return;
    referenceImage(markdownImageReference(src, alt));
    setReferenced(true);
    resetFeedbackAfterDelay(() => setReferenced(false));
  };

  if (!resolvedSrc) return null;

  return (
    <AttachmentPreview src={resolvedSrc}>
      <figure className="markdown-image-block" data-streamdown="image-block">
        <button type="button" className="markdown-image-preview-trigger" aria-label={`预览图片：${description}`}>
          <img
            {...props}
            className={imageClassName}
            src={resolvedSrc}
            alt={alt}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </button>
        <div className="markdown-image-actions" data-streamdown="image-actions">
          <TooltipIconButton className="markdown-image-action" tooltip="预览图片" side="top">
            <Maximize aria-hidden="true" />
          </TooltipIconButton>
          <TooltipIconButton
            className="markdown-image-action"
            tooltip={downloadState === "succeeded" ? "已下载" : downloadState === "error" ? "下载失败" : "下载图片"}
            side="top"
            disabled={downloadState === "working"}
            onClick={(event) => {
              event.stopPropagation();
              void downloadImage();
            }}
          >
            {downloadState === "working" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : downloadState === "succeeded" ? (
              <Check aria-hidden="true" />
            ) : downloadState === "error" ? (
              <CircleAlert aria-hidden="true" />
            ) : (
              <Download aria-hidden="true" />
            )}
          </TooltipIconButton>
          <TooltipIconButton
            className="markdown-image-action"
            tooltip={copyState === "succeeded" ? "已复制" : copyState === "error" ? "复制失败" : "复制图片"}
            side="top"
            disabled={copyState === "working"}
            onClick={(event) => {
              event.stopPropagation();
              void copyImage();
            }}
          >
            {copyState === "working" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : copyState === "succeeded" ? (
              <Check aria-hidden="true" />
            ) : copyState === "error" ? (
              <CircleAlert aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </TooltipIconButton>
          {referenceImage ? (
            <TooltipIconButton
              className="markdown-image-action"
              tooltip={referenced ? "已引用" : "引用图片"}
              side="top"
              onClick={(event) => {
                event.stopPropagation();
                reference();
              }}
            >
              {referenced ? <Check aria-hidden="true" /> : <Quote aria-hidden="true" />}
            </TooltipIconButton>
          ) : null}
        </div>
      </figure>
    </AttachmentPreview>
  );
}
