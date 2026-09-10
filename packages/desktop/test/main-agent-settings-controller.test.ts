import { describe, expect, it } from "vitest";
import {
  createMainAgentDraft,
  createNewMainAgentDraft,
  mainAgentDraftEqual,
  validateMainAgentDraft,
} from "../src/renderer/src/features/settings/agents/use-main-agent-settings-controller.ts";
import type { MainAgentProfile } from "../src/shared/main-agent-contracts.ts";

const profile: MainAgentProfile = {
  id: "profile",
  revision: 2,
  name: "Reader",
  description: "Reads files",
  builtin: false,
  configuration: {
    prompt: {
      mode: "append",
      text: "/literal/prompt/path",
      includeGlobalRules: true,
      includeProjectRules: false,
      includeSkills: true,
    },
    tools: [],
    builtinPluginIds: ["pi-browser"],
  },
};

describe("main agent settings model", () => {
  it("creates an independent user draft without collapsing explicit empty selections", () => {
    const draft = createMainAgentDraft(profile);

    expect(draft.configuration.tools).toEqual([]);
    expect(draft.configuration.builtinPluginIds).toEqual(["pi-browser"]);
    draft.configuration.prompt.text = "changed";
    expect(profile.configuration.prompt.text).toBe("/literal/prompt/path");
    expect(mainAgentDraftEqual(profile, draft)).toBe(false);
  });

  it("creates new profiles from the selected configuration with a new identity", () => {
    const draft = createNewMainAgentDraft(profile);

    expect(draft).toMatchObject({ id: null, revision: 0, builtin: false, name: "新智能体" });
    expect(draft.configuration).toEqual(profile.configuration);
  });

  it("rejects blank replacement text but accepts literal paths and explicit empty tools", () => {
    const draft = createMainAgentDraft(profile);
    draft.configuration.prompt.mode = "replace";
    draft.configuration.prompt.text = "  ";
    expect(validateMainAgentDraft(draft)).toContain("完全替换基础提示词时，提示词不能为空");

    draft.configuration.prompt.text = "C:/existing/SYSTEM.md";
    draft.configuration.tools = [];
    expect(validateMainAgentDraft(draft)).toEqual([]);
  });
});
