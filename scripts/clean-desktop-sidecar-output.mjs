import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputRoot = join(repoRoot, "packages", "desktop", "out", "sidecar");

export function cleanDesktopSidecarOutput(outputRoot = defaultOutputRoot) {
  rmSync(outputRoot, { recursive: true, force: true });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  cleanDesktopSidecarOutput();
}
