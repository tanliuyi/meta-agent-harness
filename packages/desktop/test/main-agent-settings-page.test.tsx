import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../src/renderer/src/shared/ui/tooltip-provider.tsx";
import type { MainAgentCatalog, MainAgentProfile, MainAgentStoreSnapshot } from "../src/shared/main-agent-contracts.ts";

const profile: MainAgentProfile = {
  id: "reader",
  revision: 1,
  name: "只读智能体",
  description: "仅检查文件",
  builtin: false,
  configuration: {
    prompt: {
      mode: "replace",
      text: "C:/literal/SYSTEM.md",
      includeGlobalRules: false,
      includeProjectRules: true,
      includeSkills: false,
    },
    tools: [],
    builtinPluginIds: [],
  },
};
const snapshot: MainAgentStoreSnapshot = {
  version: 1,
  revision: "revision",
  defaultAgentId: profile.id,
  profiles: [profile],
};
const catalog: MainAgentCatalog = {
  tools: [{ id: "read", name: "read", source: "builtin", available: true }],
  builtinPlugins: [{ id: "pi-browser", name: "浏览器", description: "浏览器能力", available: true }],
};

vi.mock("../src/renderer/src/features/settings/agents/use-main-agent-settings-controller.ts", () => ({
  useMainAgentSettingsController: () => ({
    snapshot,
    catalog,
    draft: structuredClone(profile),
    status: "ready",
    error: undefined,
    notice: undefined,
    dirty: false,
    errors: [],
    busy: false,
    routeBlocked: false,
    mutateDraft: vi.fn(),
    save: vi.fn(),
    reload: vi.fn(),
    select: vi.fn(),
    create: vi.fn(),
    discardDraft: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    setDefault: vi.fn(),
    resetBuiltin: vi.fn(),
    discardAndProceed: vi.fn(),
    cancelRouteChange: vi.fn(),
  }),
}));

import { MainAgentSettingsPage } from "../src/renderer/src/features/settings/agents/main-agent-settings-page.tsx";

describe("main agent settings page", () => {
  it("renders literal prompt controls and distinct explicit-empty configuration", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MainAgentSettingsPage />
      </TooltipProvider>,
    );

    expect(markup).toContain("只读智能体");
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain("C:/literal/SYSTEM.md");
    expect(markup).toContain("按字面文本使用，不读取路径");
    expect(markup).toContain("加载全局规则");
    expect(markup).toContain("加载项目规则");
    expect(markup).toContain("提供技能目录");
    expect(markup).toContain("不勾选任何工具会保存显式空白名单");
    expect(markup).toContain("会话回退（rewind）作为基础行为保留");
    expect(markup).toContain("浏览器能力");
  });
});
