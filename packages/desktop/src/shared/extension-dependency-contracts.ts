export interface ExtensionDependencyRequirement {
  source: string;
  projectId?: string;
}

export interface PrepareExtensionDependenciesInput {
  source: string;
  projectId?: string;
}

export interface ExtensionDependencyProgress {
  phase: "preparing" | "ready" | "error";
  message: string;
}

export function parseExtensionDependencyRequirement(
  error: unknown,
  projectId?: string,
): ExtensionDependencyRequirement | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/Missing source for runtime .+?: (npm:.+?)\. Run "pi update --extensions"/);
  const source = match?.[1]?.trim();
  return source ? { source, ...(projectId ? { projectId } : {}) } : undefined;
}
