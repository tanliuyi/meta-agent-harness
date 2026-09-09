import { memo } from "react";
import { type LinkSafetyConfig, Streamdown } from "streamdown";
import { preprocessMarkdownImages } from "../../../../../shared/markdown-image-contracts.ts";
import { useOptionalSessionControlSelector } from "../../session-context.tsx";
import { STREAMDOWN_COMPONENTS } from "./streamdown-code.tsx";
import { LINK_SAFETY, SHIKI_THEMES, STREAMDOWN_PLUGINS } from "./streamdown-config.ts";
import { markdownRemarkPlugins } from "./streamdown-paths.ts";

interface StreamdownMarkdownProps {
  children: string;
  cwd?: string;
  linkSafety?: LinkSafetyConfig;
}

export const StreamdownMarkdown = memo(function StreamdownMarkdown({
  children,
  cwd,
  linkSafety = LINK_SAFETY,
}: StreamdownMarkdownProps) {
  const sessionCwd = useOptionalSessionControlSelector((control) => control?.cwd);
  const owningCwd = cwd ?? sessionCwd;
  return (
    <div className="aui-md text-sm/6">
      <Streamdown
        components={STREAMDOWN_COMPONENTS}
        linkSafety={linkSafety}
        mode="static"
        plugins={STREAMDOWN_PLUGINS}
        remarkPlugins={markdownRemarkPlugins(owningCwd)}
        shikiTheme={SHIKI_THEMES}
      >
        {preprocessMarkdownImages(children)}
      </Streamdown>
    </div>
  );
});
