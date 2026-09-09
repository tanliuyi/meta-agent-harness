import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { memo } from "react";
import { preprocessMarkdownImages } from "../../../../../shared/markdown-image-contracts.ts";
import { useOptionalSessionControlSelector } from "../../session-context.tsx";
import { STREAMDOWN_COMPONENTS } from "./streamdown-code.tsx";
import { LINK_SAFETY, SHIKI_THEMES, STREAMDOWN_PLUGINS } from "./streamdown-config.ts";
import { markdownRemarkPlugins } from "./streamdown-paths.ts";

export const StreamdownText = memo(function StreamdownText() {
  const cwd = useOptionalSessionControlSelector((control) => control?.cwd);
  return (
    <StreamdownTextPrimitive
      defer
      components={STREAMDOWN_COMPONENTS}
      containerClassName="aui-md"
      linkSafety={LINK_SAFETY}
      plugins={STREAMDOWN_PLUGINS}
      preprocess={preprocessMarkdownImages}
      remarkPlugins={markdownRemarkPlugins(cwd)}
      shikiTheme={SHIKI_THEMES}
    />
  );
});
