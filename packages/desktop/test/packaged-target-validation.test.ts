import { describe, expect, it } from "vitest";
import { assertTargetRuntime } from "../../../scripts/validate-desktop-package.mjs";

const manifest = (platform: string, arch: string) => ({ compatibility: { platform, arch } });

describe("packaged Desktop target validation", () => {
  it("accepts a runtime matching the electron-builder target", () => {
    expect(() =>
      assertTargetRuntime({ electronPlatformName: "win32", arch: 1 }, manifest("win32", "x64")),
    ).not.toThrow();
  });

  it("rejects a host runtime that does not match the target platform or arch", () => {
    expect(() => assertTargetRuntime({ electronPlatformName: "win32", arch: 1 }, manifest("darwin", "arm64"))).toThrow(
      "package=win32/x64, runtime=darwin/arm64",
    );
  });

  it("rejects universal packaging until both sidecar runtimes are materialized", () => {
    expect(() => assertTargetRuntime({ electronPlatformName: "darwin", arch: 4 }, manifest("darwin", "arm64"))).toThrow(
      "Universal Desktop packaging requires per-architecture sidecar runtimes",
    );
  });
});
