import { defaultRemarkPlugins, type StreamdownProps } from "streamdown";
import { resolveMarkdownDestination } from "../../../../../shared/markdown-image-contracts.ts";

type MarkdownUrlNode = {
  type: string;
  url?: unknown;
  children?: MarkdownUrlNode[];
};

function resolveMarkdownDestinations(options?: { cwd?: string }) {
  return (tree: MarkdownUrlNode): void => {
    const stack = [tree];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (
        (node.type === "link" || node.type === "image" || node.type === "definition") &&
        typeof node.url === "string"
      ) {
        node.url = resolveMarkdownDestination(node.url, options?.cwd) ?? node.url;
      }
      if (node.children) stack.push(...node.children);
    }
  };
}

export function markdownRemarkPlugins(cwd?: string): NonNullable<StreamdownProps["remarkPlugins"]> {
  return [...Object.values(defaultRemarkPlugins), [resolveMarkdownDestinations, { cwd }]];
}
