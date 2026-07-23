import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repoRoot, "packages", "desktop", "output", "pi-sidecar", "bin");
const windows = process.platform === "win32";
const launcherName = windows ? "pi.cmd" : "pi";
const outputPath = join(outputRoot, launcherName);
const launcher = windows
  ? [
      "@echo off",
      "if not defined PI_DESKTOP_NODE_EXEC_PATH (echo PI_DESKTOP_NODE_EXEC_PATH is required 1>&2 & exit /b 1)",
      "if not defined PI_DESKTOP_PI_ENTRY (echo PI_DESKTOP_PI_ENTRY is required 1>&2 & exit /b 1)",
      '"%PI_DESKTOP_NODE_EXEC_PATH%" "%PI_DESKTOP_PI_ENTRY%" %*',
      "",
    ].join("\r\n")
  : `#!/bin/sh
set -eu
: "\${PI_DESKTOP_NODE_EXEC_PATH:?PI_DESKTOP_NODE_EXEC_PATH is required}"
: "\${PI_DESKTOP_PI_ENTRY:?PI_DESKTOP_PI_ENTRY is required}"
exec "$PI_DESKTOP_NODE_EXEC_PATH" "$PI_DESKTOP_PI_ENTRY" "$@"
`;

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
writeFileSync(outputPath, launcher);
if (!windows) chmodSync(outputPath, 0o755);
console.log(`Built Desktop Pi launcher: ${outputPath}`);
