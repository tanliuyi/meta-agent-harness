import { describe, expect, it } from "vitest";
import { parseExtensionDependencyRequirement } from "../src/shared/extension-dependency-contracts.ts";

describe("extension dependency recovery contracts", () => {
  it("extracts an npm source without exposing runtime details", () => {
    const requirement = parseExtensionDependencyRequirement(
      new Error(
        'Error invoking remote method \'desktop:sessions:draft-config\': Error: Missing source for runtime abc123: npm:pi-hermes-memory. Run "pi update --extensions" with this runtime to prepare configured packages, or run "pi install npm:pi-hermes-memory".',
      ),
      "project-1",
    );

    expect(requirement).toEqual({ source: "npm:pi-hermes-memory", projectId: "project-1" });
    expect(requirement).not.toHaveProperty("runtimeDependencyId");
  });

  it("supports scoped and versioned npm sources", () => {
    expect(
      parseExtensionDependencyRequirement(
        'Missing source for runtime runtime:id: npm:@scope/extension@1.2.3. Run "pi update --extensions" with this runtime',
      ),
    ).toEqual({ source: "npm:@scope/extension@1.2.3" });
  });

  it("ignores unrelated session failures", () => {
    expect(parseExtensionDependencyRequirement(new Error("Sidecar startup timed out"), "project-1")).toBeUndefined();
  });
});
