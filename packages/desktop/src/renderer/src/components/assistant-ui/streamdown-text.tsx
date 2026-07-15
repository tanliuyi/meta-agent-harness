import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo } from "react";

const STREAMDOWN_PLUGINS = { code, math, mermaid, cjk } as const;
const SHIKI_THEMES: ["github-light", "github-dark"] = ["github-light", "github-dark"];

export const StreamdownText = memo(function StreamdownText() {
  return (
    <StreamdownTextPrimitive containerClassName="aui-md" plugins={STREAMDOWN_PLUGINS} shikiTheme={SHIKI_THEMES} defer />
  );
});
