import type { ExtensionScope } from "./desktop-extension-contracts.ts";

export function isExtensionInScope(
  scope: ExtensionScope | undefined,
  projectIds: readonly string[] | undefined,
  projectId: string | undefined,
): boolean {
  return scope !== "project" || Boolean(projectId && projectIds?.includes(projectId));
}
