import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RuntimeCompatibility, SidecarRole } from "../../shared/sidecar-contracts.ts";

export const REQUIRED_NODE_VERSION = "22.19.0";

export interface NodeRuntimeStatus {
  state: "ready" | "missing" | "invalid";
  path?: string;
  version?: string;
  requiredVersion: string;
  message: string;
  installUrl: string;
}

export interface NodeRuntimeManifest {
  nodePath: string;
  npmCliPath: string;
  piExecutable: string;
  entries: Record<SidecarRole, string>;
  compatibility: RuntimeCompatibility;
  integrity: {
    nodePath: string;
    npmCliPath: string;
    piExecutable: string;
    entries: Record<SidecarRole, string>;
    files: Record<string, string>;
  };
}

type NodeRuntimeProbe = Pick<
  RuntimeCompatibility,
  "nodeVersion" | "modulesAbi" | "napi" | "platform" | "arch" | "osRelease" | "libc" | "toolchain"
>;

export function detectNodeRuntime(pathOverride?: string): NodeRuntimeStatus {
  const configured = pathOverride ?? process.env.PI_DESKTOP_NODE_EXEC_PATH;
  const candidates = configured ? [resolve(configured)] : findPathCandidates();
  for (const candidate of candidates) {
    try {
      const runtime = probeNodeRuntime(candidate);
      const incompatibility = nodeRuntimeIncompatibility(runtime);
      if (incompatibility) {
        return {
          state: "invalid",
          path: candidate,
          version: runtime.nodeVersion,
          requiredVersion: REQUIRED_NODE_VERSION,
          message: incompatibility,
          installUrl: nodeRuntimeInstallUrl(),
        };
      }
      return {
        state: "ready",
        path: candidate,
        version: runtime.nodeVersion,
        requiredVersion: REQUIRED_NODE_VERSION,
        message: `已找到 Node.js ${runtime.nodeVersion}`,
        installUrl: nodeRuntimeInstallUrl(),
      };
    } catch {
      // Continue through PATH candidates.
    }
  }
  return {
    state: "missing",
    requiredVersion: REQUIRED_NODE_VERSION,
    message: `未找到 Node.js。请安装 ${REQUIRED_NODE_VERSION} 或更高版本。`,
    installUrl: nodeRuntimeInstallUrl(),
  };
}

export function nodeRuntimeInstallUrl(): string {
  const version = "24.15.0";
  const suffix = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin")
    return `https://nodejs.org/dist/v${version}/node-v${version}-darwin-${suffix}.tar.gz`;
  if (process.platform === "win32") return `https://nodejs.org/dist/v${version}/node-v${version}-win-${suffix}.zip`;
  return `https://nodejs.org/dist/v${version}/node-v${version}-linux-${suffix}.tar.xz`;
}

export function loadNodeRuntimeManifest(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appDir: string;
  nodePathOverride?: string;
  allowUnavailable?: boolean;
}): NodeRuntimeManifest {
  const manifestPath = options.isPackaged
    ? join(options.resourcesPath, "pi-sidecar", "runtime-manifest.json")
    : resolve(options.appDir, "../sidecar/runtime-manifest.json");
  const root = dirname(manifestPath);
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as NodeRuntimeManifest;
  const override = options.nodePathOverride ?? process.env.PI_DESKTOP_NODE_EXEC_PATH;
  const manifest: NodeRuntimeManifest = {
    ...parsed,
    nodePath: override ? resolve(override) : resolve(root, parsed.nodePath),
    npmCliPath: resolve(root, parsed.npmCliPath),
    piExecutable: resolve(root, parsed.piExecutable),
    entries: Object.fromEntries(
      Object.entries(parsed.entries).map(([role, path]) => [role, resolve(root, path)]),
    ) as Record<SidecarRole, string>,
  };
  if (!options.allowUnavailable)
    assertFile(manifest.nodePath, "Node executable", override ? "" : manifest.integrity.nodePath);
  if (manifest.npmCliPath && existsFile(manifest.npmCliPath)) {
    assertFile(manifest.npmCliPath, "npm CLI", manifest.integrity.npmCliPath);
  }
  assertFile(manifest.piExecutable, "Pi executable", manifest.integrity.piExecutable);
  for (const role of Object.keys(manifest.entries) as SidecarRole[]) {
    assertFile(manifest.entries[role], `${role} sidecar entry`, manifest.integrity.entries[role]);
  }
  for (const [path, hash] of Object.entries(manifest.integrity.files)) {
    assertFile(resolve(root, path), `Sidecar runtime file ${path}`, hash);
  }
  if (override) manifest.compatibility = compatibilityForNode(manifest.compatibility, manifest.nodePath);
  return manifest;
}

function assertFile(path: string, description: string, expectedHash: string): void {
  assertRealFilesystemPath(path, description);
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`${description} is not a file: ${path}`);
  const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (expectedHash && actualHash !== expectedHash) {
    throw new Error(`${description} integrity mismatch: expected ${expectedHash}, got ${actualHash}`);
  }
}

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function compatibilityForNode(base: RuntimeCompatibility, nodePath: string): RuntimeCompatibility {
  const runtime = probeNodeRuntime(nodePath);
  const incompatibility = nodeRuntimeIncompatibility(runtime);
  if (incompatibility) throw new Error(incompatibility);
  const identity = { ...runtime, piVersion: base.piVersion };
  return {
    ...base,
    ...runtime,
    runtimeCompatibilityId: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
  };
}

function probeNodeRuntime(nodePath: string): NodeRuntimeProbe {
  const parsed: unknown = JSON.parse(
    execFileSync(
      nodePath,
      [
        "-p",
        '(() => { const variables = process.config.variables; const osRelease = process.platform === "darwin" ? "darwin-23+" : process.platform === "win32" ? "windows-10+" : process.platform === "linux" ? "linux-kernel-4.18+" : "unsupported"; const libc = process.platform === "darwin" ? "libSystem" : process.platform === "win32" ? "ucrt" : process.platform === "linux" ? "glibc-2.28+" : "unknown"; return JSON.stringify({ nodeVersion: process.version, modulesAbi: process.versions.modules, napi: process.versions.napi, platform: process.platform, arch: process.arch, osRelease, libc, toolchain: [variables.host_arch, variables.target_arch, variables.v8_target_arch, variables.clang].filter((value) => value !== undefined).join(":") }); })()',
      ],
      { encoding: "utf8" },
    ),
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid Node.js runtime metadata from ${nodePath}`);
  }
  const { nodeVersion, modulesAbi, napi, platform, arch, osRelease, libc, toolchain } = parsed as Record<
    string,
    unknown
  >;
  if (
    typeof nodeVersion !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(nodeVersion) ||
    !isPositiveIntegerString(modulesAbi) ||
    !isPositiveIntegerString(napi) ||
    typeof platform !== "string" ||
    platform.length === 0 ||
    typeof arch !== "string" ||
    arch.length === 0 ||
    typeof osRelease !== "string" ||
    osRelease.length === 0 ||
    typeof libc !== "string" ||
    libc.length === 0 ||
    typeof toolchain !== "string" ||
    toolchain.length === 0
  ) {
    throw new Error(`Invalid Node.js runtime metadata from ${nodePath}`);
  }
  return { nodeVersion, modulesAbi, napi, platform, arch, osRelease, libc, toolchain };
}

function nodeRuntimeIncompatibility(runtime: NodeRuntimeProbe): string | undefined {
  if (compareVersions(runtime.nodeVersion.slice(1), REQUIRED_NODE_VERSION) < 0) {
    return `Node.js ${REQUIRED_NODE_VERSION} 或更高版本是必需的，当前为 ${runtime.nodeVersion}`;
  }
  if (runtime.platform !== process.platform || runtime.arch !== process.arch) {
    return `Node.js ${runtime.nodeVersion} 与当前 Desktop 不兼容：需要 ${process.platform}/${process.arch}，当前为 ${runtime.platform}/${runtime.arch}`;
  }
  return undefined;
}

function isPositiveIntegerString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function findPathCandidates(): string[] {
  try {
    return execFileSync(
      process.platform === "win32" ? "where.exe" : "which",
      [process.platform === "win32" ? "node.exe" : "node"],
      { encoding: "utf8" },
    )
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function assertRealFilesystemPath(path: string, description: string): void {
  // Node cannot execute a sidecar entry or native runtime directly from app.asar.
  if (/[\\/]app\.asar(?:[\\/]|$)/i.test(path)) {
    throw new Error(`${description} must be outside app.asar: ${path}`);
  }
}
