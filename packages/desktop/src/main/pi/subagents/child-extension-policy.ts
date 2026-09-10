import type { SubagentChildExtension } from "../../../shared/subagent-contracts.ts";
import type { ResolvedSubagentCapabilityCeiling } from "../extensions/pi-subagents/src/runs/shared/capability-ceiling.ts";

/** Load tool-bearing extensions atomically: ACP may disable native compaction when loaded. */
export function permittedChildExtensions(
  extensions: readonly SubagentChildExtension[],
  excludeTools: readonly string[] | undefined,
  ceiling: ResolvedSubagentCapabilityCeiling | undefined,
): SubagentChildExtension[] {
  if (ceiling?.denyExtensions) return [];
  const excluded = new Set(excludeTools);
  const allowed = ceiling?.allowedTools === undefined ? undefined : new Set(ceiling.allowedTools);
  const selected = new Map<string, SubagentChildExtension>();
  for (const extension of extensions) {
    if (extension.tools.some((tool) => excluded.has(tool) || (allowed && !allowed.has(tool)))) continue;
    selected.set(extension.path, { path: extension.path, tools: [...new Set(extension.tools)] });
  }
  return [...selected.values()];
}
