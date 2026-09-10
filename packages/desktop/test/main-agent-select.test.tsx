import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MainAgentSelect, mainAgentSelectOptions } from "../src/renderer/src/components/chat/main-agent-select.tsx";
import { TooltipProvider } from "../src/renderer/src/shared/ui/tooltip-provider.tsx";
import type { MainAgentDraftContext } from "../src/shared/main-agent-contracts.ts";

const context: MainAgentDraftContext = {
  selection: { id: "reviewer", revision: 4 },
  profiles: [
    { id: "desktop-default", revision: 1, name: "默认智能体", description: "默认行为", builtin: true },
    { id: "reviewer", revision: 4, name: "代码审查", description: "只读审查配置", builtin: false },
  ],
  snapshot: {
    version: 1,
    profileId: "reviewer",
    profileRevision: 4,
    profileName: "代码审查",
    createdAt: 1,
    configuration: {
      prompt: { mode: "default", text: "", includeGlobalRules: true, includeProjectRules: true, includeSkills: true },
      tools: ["read"],
      builtinPluginIds: [],
    },
  },
  tools: [],
  builtinPlugins: [],
  promptSources: [],
};

describe("MainAgentSelect", () => {
  it("renders the selected main-session profile without subagent execution wording", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MainAgentSelect context={context} onValueChange={vi.fn()} />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="选择主智能体"');
    expect(markup).toContain("代码审查");
    expect(markup).not.toContain("子智能体");
    expect(markup).not.toContain("执行者");
  });

  it("labels a manual child draft that still uses its parent snapshot", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MainAgentSelect context={context} inherited inheritedProfile={context.snapshot} onValueChange={vi.fn()} />
      </TooltipProvider>,
    );

    expect(markup).toContain("继承");
  });

  it("keeps inheritance as an explicit reselectable option after choosing another profile", () => {
    const options = mainAgentSelectOptions(
      { ...context, selection: { id: "desktop-default", revision: 1 } },
      context.snapshot,
    );

    expect(options[0]).toMatchObject({
      kind: "inherit-parent",
      id: "reviewer",
      revision: 4,
      name: "代码审查",
    });
    expect(options).toContainEqual(expect.objectContaining({ kind: "profile", id: "desktop-default" }));
    expect(options.filter(({ id, revision }) => id === "reviewer" && revision === 4)).toHaveLength(1);
  });
});
