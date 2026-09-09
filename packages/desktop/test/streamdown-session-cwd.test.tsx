import { TooltipProvider } from "@renderer/shared/ui/tooltip-provider";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/components/session-context.tsx", () => ({
  useOptionalSessionControlSelector: (selector: (control: { cwd: string }) => unknown) =>
    selector({ cwd: "C:/sessions/owning-thread" }),
}));

import { StreamdownMarkdown } from "../src/renderer/src/components/assistant-ui/streamdown/streamdown-markdown.tsx";

describe("Streamdown session cwd", () => {
  it("resolves relative Markdown from the owning session control", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <StreamdownMarkdown linkSafety={{ enabled: false }}>
          {"![image](assets/a%2528b%2529.png) [file](docs/a%2523b.md)"}
        </StreamdownMarkdown>
      </TooltipProvider>,
    );

    expect(markup).toContain("source=C%3A%2Fsessions%2Fowning-thread%2Fassets%2Fa%2528b%2529.png");
    expect(markup).toContain('href="/.meta-agent-local/windows/C:/sessions/owning-thread/docs/a%2523b.md"');
    expect(markup).toContain("lucide-file");
    expect(markup).not.toContain("[blocked]");
  });
});
