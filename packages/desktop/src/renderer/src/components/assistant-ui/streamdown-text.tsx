import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@renderer/components/ui/dialog";
// import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo } from "react";
import type { LinkSafetyConfig, LinkSafetyModalProps } from "streamdown";
import { Streamdown } from "streamdown";

const STREAMDOWN_PLUGINS = { code, math, mermaid } as const;
const SHIKI_THEMES: ["github-light", "github-dark"] = ["github-light", "github-dark"];

const LINK_SAFETY: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => <LinkSafetyModal {...props} />,
};

export const StreamdownText = memo(function StreamdownText() {
  return (
    <StreamdownTextPrimitive
      containerClassName="aui-md"
      linkSafety={LINK_SAFETY}
      plugins={STREAMDOWN_PLUGINS}
      shikiTheme={SHIKI_THEMES}
    />
  );
});

export const StreamdownMarkdown = memo(function StreamdownMarkdown({ children }: { children: string }) {
  return (
    <div className="aui-md">
      <Streamdown linkSafety={LINK_SAFETY} mode="static" plugins={STREAMDOWN_PLUGINS} shikiTheme={SHIKI_THEMES}>
        {children}
      </Streamdown>
    </div>
  );
});

function LinkSafetyModal({ url, isOpen, onClose }: LinkSafetyModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-3 sm:max-w-lg">
        <DialogTitle>打开外部链接？</DialogTitle>
        <DialogDescription className="break-all">{url}</DialogDescription>
        <div className="mt-3 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <Button
            onClick={() => {
              void window.desktop.links.open(url).catch((error: unknown) => {
                console.error("Failed to open link:", error);
              });
              onClose();
            }}
          >
            继续打开
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
