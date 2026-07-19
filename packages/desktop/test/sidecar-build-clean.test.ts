import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanDesktopSidecarOutput } from "../../../scripts/clean-desktop-sidecar-output.mjs";

describe("Desktop sidecar build cleanup", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("removes outputs left behind by deleted sidecar sources", () => {
    const root = mkdtempSync(join(tmpdir(), "desktop-sidecar-clean-"));
    temporaryDirectories.push(root);
    const outputRoot = join(root, "out", "sidecar");
    const staleWorker = join(outputRoot, "sidecar", "projection-worker-main.js");
    mkdirSync(join(outputRoot, "sidecar"), { recursive: true });
    writeFileSync(staleWorker, "stale");

    cleanDesktopSidecarOutput(outputRoot);

    expect(existsSync(outputRoot)).toBe(false);
  });
});
