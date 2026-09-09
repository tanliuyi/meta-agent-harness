import { TooltipProvider } from "@renderer/shared/ui/tooltip-provider";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownImageReferenceProvider } from "../src/renderer/src/components/assistant-ui/streamdown/streamdown-image-reference.tsx";
import { StreamdownMarkdown } from "../src/renderer/src/components/assistant-ui/streamdown/streamdown-markdown.tsx";
import {
  isEncodedMarkdownLocalPath,
  markdownImageFilename,
  markdownImageReference,
  markdownImageSourceToUrl,
  markdownLocalPath,
  preprocessMarkdownImages,
  resolveMarkdownDestination,
  resolveRelativeMarkdownPath,
} from "../src/shared/markdown-image-contracts.ts";

describe("Markdown images", () => {
  it("通过 Desktop 图片协议加载本地绝对路径", () => {
    const source = "/Users/test/My Images/mecha.png";

    expect(markdownImageSourceToUrl(source)).toBe(
      "meta-agent-markdown-image://local/image?source=%2FUsers%2Ftest%2FMy%20Images%2Fmecha.png",
    );
  });

  it("通过 Desktop 图片协议加载网络图片，保留 data 图片 URL", () => {
    expect(markdownImageSourceToUrl("https://example.com/mecha.png")).toBe(
      "meta-agent-markdown-image://local/image?source=https%3A%2F%2Fexample.com%2Fmecha.png",
    );
    expect(markdownImageSourceToUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("按所属会话 cwd 解析相对图片和文件链接", () => {
    const markdown = [
      "![gundam_mecha](gundam_mecha.png)",
      "[文件位置](./art/gundam_mecha.png)",
      "[上级文档](../README.md)",
      '[带标题](docs/guide.md "指南")',
    ].join("\n\n");

    expect(resolveMarkdownDestination("gundam_mecha.png", "/workspace/session-a")).toBe(
      "/workspace/session-a/gundam_mecha.png",
    );
    expect(resolveMarkdownDestination("./art/gundam_mecha.png", "/workspace/session-a")).toBe(
      "/workspace/session-a/art/gundam_mecha.png",
    );
    expect(resolveMarkdownDestination("../README.md", "/workspace/session-a")).toBe("/workspace/README.md");
    expect(resolveRelativeMarkdownPath("images/My%20Mecha.png", "C:\\workspace\\session-b")).toBe(
      "/.meta-agent-local/windows/C:/workspace/session-b/images/My%20Mecha.png",
    );
    expect(resolveRelativeMarkdownPath("../mecha.png", "C:\\workspace\\session-b")).toBe(
      "/.meta-agent-local/windows/C:/workspace/mecha.png",
    );
    expect(resolveMarkdownDestination("C:\\workspace\\mecha.png")).toBe(
      "/.meta-agent-local/windows/C:/workspace/mecha.png",
    );
  });

  it("没有所属 cwd 时不猜测路径，并保留绝对路径、URL、fragment 和危险协议", () => {
    const markdown = [
      "![relative](mecha.png)",
      "[absolute](/workspace/mecha.png)",
      "[external](https://example.com/mecha.png)",
      "[fragment](#details)",
      "[danger](javascript:alert(1))",
    ].join("\n");

    expect(preprocessMarkdownImages(markdown)).toBe(markdown);
    expect(preprocessMarkdownImages(markdown, "/workspace/session-a")).toContain("[danger](javascript:alert(1))");
    expect(resolveRelativeMarkdownPath("mecha.png", "relative/cwd")).toBeUndefined();
  });

  it("preserves code literals, URL escapes, destination enclosures, and filesystem roots", () => {
    const markdown = [
      "`[inline](docs/inline.md)`",
      "```md",
      "![fenced](images/fenced.png)",
      "```",
      "[hash](docs/a%23b.md)",
      "![paren](<images/a)b.png>)",
    ].join("\n");

    expect(preprocessMarkdownImages(markdown)).toBe(markdown);
    expect(resolveRelativeMarkdownPath("x.png", "/")).toBe("/x.png");
    expect(resolveRelativeMarkdownPath("../../../x.png", "\\\\server\\share\\project")).toBe(
      "/.meta-agent-local/windows/UNC/server/share/x.png",
    );
    expect(resolveRelativeMarkdownPath("../../../../x.png", "\\\\server\\share")).toBe(
      "/.meta-agent-local/windows/UNC/server/share/x.png",
    );

    const encodedLinkMarkup = renderToStaticMarkup(
      <StreamdownMarkdown cwd="/workspace" linkSafety={{ enabled: false }}>
        {"[hash](docs/a%23b.md)"}
      </StreamdownMarkdown>,
    );
    expect(encodedLinkMarkup).toContain('href="/workspace/docs/a%23b.md"');
  });

  it("preserves parsed CommonMark code nodes while resolving ordinary links", () => {
    const markdown = [
      "    [indented](docs/indented.md)",
      "> ```md",
      "> [quoted fence](docs/quoted.md)",
      "> ```",
      "- item",
      "  ````md",
      "  [list fence](docs/list.md)",
      "  ````",
      "`cross-line code",
      "[cross-line](docs/cross.md)",
      "end code`",
      "``[exact code](docs/exact.md)``",
      "``[not code](docs/ordinary.md)```",
      "[ordinary](docs/resolved.md)",
    ].join("\n");

    expect(preprocessMarkdownImages(markdown)).toBe(markdown);

    const markup = renderToStaticMarkup(
      <StreamdownMarkdown cwd="/workspace" linkSafety={{ enabled: false }}>
        {"`code\n[file](docs/code.md)\ncode`\n\n[ordinary](docs/ordinary.md)"}
      </StreamdownMarkdown>,
    );
    expect(markup).toContain("[file](docs/code.md)");
    expect(markup).not.toContain("[file](/workspace/docs/code.md)");
    expect(markup).toContain('href="/workspace/docs/ordinary.md"');
  });

  it("keeps Windows and UNC URL escapes encoded until their final consumer", () => {
    const encodedWindowsTarget = resolveMarkdownDestination("docs/a%23b.md", "C:/workspace") ?? "";
    expect(encodedWindowsTarget).toBe("/.meta-agent-local/windows/C:/workspace/docs/a%23b.md");
    expect(isEncodedMarkdownLocalPath(encodedWindowsTarget)).toBe(true);
    expect(markdownLocalPath(encodedWindowsTarget)).toBe("C:/workspace/docs/a%23b.md");

    const encodedWindowsSource = resolveMarkdownDestination("docs/a%2523b.png", "C:/workspace") ?? "";
    expect(markdownImageSourceToUrl(encodedWindowsSource)).toBe(
      "meta-agent-markdown-image://local/image?source=C%3A%2Fworkspace%2Fdocs%2Fa%2523b.png",
    );
    expect(markdownImageFilename(encodedWindowsSource, "image")).toBe("a%23b.png");

    const encodedUncTarget = resolveMarkdownDestination("docs/a%23b.md", "\\\\server\\share") ?? "";
    expect(markdownLocalPath(encodedUncTarget)).toBe("//server/share/docs/a%23b.md");
    expect(isEncodedMarkdownLocalPath(encodedUncTarget)).toBe(true);

    const encodedUncSource = resolveMarkdownDestination("docs/a%2523b.png", "\\\\server\\share") ?? "";
    expect(markdownLocalPath(encodedUncSource)).toBe("//server/share/docs/a%2523b.png");
    expect(markdownImageSourceToUrl(encodedUncSource)).toBe(
      "meta-agent-markdown-image://local/image?source=%2F%2Fserver%2Fshare%2Fdocs%2Fa%2523b.png",
    );
    expect(markdownImageFilename(encodedUncSource, "image")).toBe("a%23b.png");
  });

  it("在 Streamdown 中按 cwd 渲染截图中的相对图片和文件链接", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MarkdownImageReferenceProvider onReference={() => undefined}>
          <StreamdownMarkdown cwd="/workspace/session-a" linkSafety={{ enabled: false }}>
            {"![gundam_mecha](gundam_mecha.png)\n\n文件位置：[gundam_mecha.png](gundam_mecha.png)"}
          </StreamdownMarkdown>
        </MarkdownImageReferenceProvider>
      </TooltipProvider>,
    );

    expect(markup).toContain(
      'src="meta-agent-markdown-image://local/image?source=%2Fworkspace%2Fsession-a%2Fgundam_mecha.png"',
    );
    expect(markup).toContain('href="/workspace/session-a/gundam_mecha.png"');
    expect(markup).toContain("gundam_mecha.png");
    expect(markup).not.toContain("Image blocked");
    expect(markup).not.toContain("[blocked]");
  });

  it("不同 cwd 的渲染结果互不串用", () => {
    const render = (cwd: string) =>
      renderToStaticMarkup(
        <TooltipProvider>
          <StreamdownMarkdown cwd={cwd}>{"![mecha](images/mecha.png)"}</StreamdownMarkdown>
        </TooltipProvider>,
      );

    expect(render("/workspace/session-a")).toContain("source=%2Fworkspace%2Fsession-a%2Fimages%2Fmecha.png");
    expect(render("C:\\workspace\\session-b")).toContain("source=C%3A%2Fworkspace%2Fsession-b%2Fimages%2Fmecha.png");
  });

  it("相对目标缺少 cwd 或使用危险协议时继续由 Streamdown 拦截", () => {
    const relativeMarkup = renderToStaticMarkup(<StreamdownMarkdown>{"![mecha](mecha.png)"}</StreamdownMarkdown>);
    const dangerousMarkup = renderToStaticMarkup(
      <StreamdownMarkdown>{"[danger](javascript:alert(1))"}</StreamdownMarkdown>,
    );

    expect(relativeMarkup).toContain("[Image blocked: mecha]");
    expect(dangerousMarkup).toContain("[blocked]");
  });

  it("生成可发送给 Composer 的图片引用和下载文件名", () => {
    expect(markdownImageReference("/Users/test/My%20Images/mecha.png", "gundam-style-mecha")).toBe(
      "![gundam-style-mecha](</Users/test/My Images/mecha.png>)",
    );
    expect(markdownImageFilename("/Users/test/My%20Images/mecha.png", "gundam-style-mecha")).toBe("mecha.png");
  });

  it("在 Streamdown 中渲染响应式图片和完整操作", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MarkdownImageReferenceProvider onReference={() => undefined}>
          <StreamdownMarkdown>{"![gundam-style-mecha](/Users/test/My Images/mecha.png)"}</StreamdownMarkdown>
        </MarkdownImageReferenceProvider>
      </TooltipProvider>,
    );

    expect(markup).toContain('class="markdown-image"');
    expect(markup).toContain(
      'src="meta-agent-markdown-image://local/image?source=%2FUsers%2Ftest%2FMy%20Images%2Fmecha.png"',
    );
    expect(markup).toContain('alt="gundam-style-mecha"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('data-streamdown="image-actions"');
    expect(markup).toContain("预览图片");
    expect(markup).toContain("下载图片");
    expect(markup).toContain("引用图片");
  });

  it("distinguishes external and local links with icons without decorating fragments or linked images", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <StreamdownMarkdown cwd="/workspace" linkSafety={{ enabled: false }}>
          {
            '[external](https://example.com "External") [file](docs/readme.md) [reference][guide] [fragment](#details) [![image](image.png)](https://example.com/image)\n\n[guide]: docs/guide.md'
          }
        </StreamdownMarkdown>
      </TooltipProvider>,
    );

    expect(markup.match(/lucide-external-link/gu)).toHaveLength(1);
    expect(markup.match(/lucide-file/gu)).toHaveLength(2);
    expect(markup).toContain('title="External"');
    expect(markup).toContain('href="/workspace/docs/guide.md"');
    expect(markup).toContain('href="#details"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("[blocked]");
  });

  it("decodes URL escapes exactly once at the image protocol boundary", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <StreamdownMarkdown cwd="/workspace" linkSafety={{ enabled: false }}>
          {
            "![paren](images/a%28b%29.png) ![space](images/a%20b.png) ![hash](images/a%23b.png) ![percent](images/a%25b.png) ![literal escape](images/a%2528b.png)"
          }
        </StreamdownMarkdown>
      </TooltipProvider>,
    );

    expect(markup).toContain("source=%2Fworkspace%2Fimages%2Fa(b).png");
    expect(markup).toContain("source=%2Fworkspace%2Fimages%2Fa%20b.png");
    expect(markup).toContain("source=%2Fworkspace%2Fimages%2Fa%23b.png");
    expect(markup).toContain("source=%2Fworkspace%2Fimages%2Fa%25b.png");
    expect(markup).toContain("source=%2Fworkspace%2Fimages%2Fa%2528b.png");
  });

  it("preserves Streamdown link safety rendering while adding icons", () => {
    const markup = renderToStaticMarkup(
      <StreamdownMarkdown
        linkSafety={{
          enabled: true,
          renderModal: ({ url }) => <span data-modal-url={url} />,
        }}
      >
        {'[external](https://example.com "External")'}
      </StreamdownMarkdown>,
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain('data-streamdown="link"');
    expect(markup).toContain('title="External"');
    expect(markup).toContain('data-modal-url="https://example.com/"');
    expect(markup).toContain("lucide-external-link");
  });

  it("在无 SessionScope 的悬浮预览中禁用链接安全，链接直接渲染为锚点", () => {
    const markup = renderToStaticMarkup(
      <StreamdownMarkdown linkSafety={{ enabled: false }}>
        {"点此查看 [项目文档](https://example.com/docs)"}
      </StreamdownMarkdown>,
    );

    expect(markup).toContain('href="https://example.com/docs"');
    expect(markup).not.toContain("打开外部链接？");
  });
});
