import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunActivityGroup } from "../src/renderer/src/components/chat/message/run-activity-group.tsx";

describe("RunActivityGroup", () => {
  it("run 进行中强制展开并禁用折叠入口", () => {
    const now = Date.now();
    const markup = renderToStaticMarkup(
      <RunActivityGroup running startedAt={now - 12_000}>
        <span>step content</span>
      </RunActivityGroup>,
    );

    expect(markup).toContain('data-state="open"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("正在处理");
    expect(markup).toContain("正在处理 12s");
    expect(markup).toContain("aui-run-activity-root");
    expect(markup).toContain("aui-run-activity-trigger");
    expect(markup).toContain("aui-run-activity-content");
    expect(markup).toContain("aui-run-activity-body");
    expect(markup).not.toContain('data-slot="reasoning-fade"');
    expect(markup).not.toContain('data-slot="reasoning-trigger-chevron"');
    expect(markup).toContain("step content");
  });

  it("run 进行中使用固定两位数的时分秒格式", () => {
    const now = Date.now();
    const markup = renderToStaticMarkup(
      <RunActivityGroup running startedAt={now - (3 * 3_600 + 4 * 60 + 5) * 1_000}>
        <span>step content</span>
      </RunActivityGroup>,
    );

    expect(markup).toContain("03h 04m 05s");
  });

  it("run 结束后默认折叠、展示固定处理耗时并启用折叠入口", () => {
    const now = Date.now();
    const markup = renderToStaticMarkup(
      <RunActivityGroup running={false} startedAt={now - (4 * 60 + 5) * 1_000}>
        <span>step content</span>
      </RunActivityGroup>,
    );

    expect(markup).toContain('data-state="closed"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).toContain("已处理 04m 05s");
    expect(markup).not.toContain('data-slot="reasoning-fade"');
    expect(markup).not.toContain("step content");
  });
});
