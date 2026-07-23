import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: childProcessMock.execFileSync }));

import {
  detectNodeRuntime,
  loadNodeRuntimeManifest,
  type NodeRuntimeManifest,
} from "../src/main/sidecar/node-runtime-locator.ts";

describe("Desktop Node runtime locator", () => {
  let resourcesPath: string;
  let previousNodeOverride: string | undefined;

  beforeEach(() => {
    childProcessMock.execFileSync.mockReset();
    previousNodeOverride = process.env.PI_DESKTOP_NODE_EXEC_PATH;
    delete process.env.PI_DESKTOP_NODE_EXEC_PATH;
    resourcesPath = mkdtempSync(join(tmpdir(), "desktop-node-runtime-locator-"));
  });

  afterEach(() => {
    if (previousNodeOverride === undefined) delete process.env.PI_DESKTOP_NODE_EXEC_PATH;
    else process.env.PI_DESKTOP_NODE_EXEC_PATH = previousNodeOverride;
    rmSync(resourcesPath, { recursive: true, force: true });
  });

  it("rejects executable paths inside app.asar", () => {
    const manifestPath = writeManifest("app.asar");

    expect(() =>
      loadNodeRuntimeManifest({ isPackaged: true, resourcesPath, appDir: join(resourcesPath, "unused") }),
    ).toThrow(`Node executable must be outside app.asar`);
    expect(manifestPath).toBe(join(resourcesPath, "pi-sidecar", "runtime-manifest.json"));
  });

  it("accepts hashed files in app.asar.unpacked", () => {
    writeManifest("app.asar.unpacked");

    const manifest = loadNodeRuntimeManifest({
      isPackaged: true,
      resourcesPath,
      appDir: join(resourcesPath, "unused"),
    });

    expect(manifest.nodePath).toContain("app.asar.unpacked");
    expect(manifest.entries.thread).toContain("app.asar.unpacked");
  });

  it.each(["v22.19.0", "v24.15.0", "v25.0.0"])("accepts compatible Node runtime %s", (nodeVersion) => {
    mockNodeRuntime({ nodeVersion });

    expect(detectNodeRuntime(join(resourcesPath, "node"))).toMatchObject({
      state: "ready",
      version: nodeVersion,
    });
  });

  it("uses an explicit executable name when searching PATH", () => {
    const nodePath = join(resourcesPath, process.platform === "win32" ? "node.exe" : "node");
    childProcessMock.execFileSync.mockReturnValueOnce(`${nodePath}\n`).mockReturnValueOnce(
      JSON.stringify({
        nodeVersion: "v24.15.0",
        modulesAbi: "137",
        napi: "10",
        platform: process.platform,
        arch: process.arch,
        osRelease: "test-os",
        libc: "test-libc",
        toolchain: "test-toolchain",
      }),
    );

    expect(detectNodeRuntime()).toMatchObject({ state: "ready", path: nodePath });
    expect(childProcessMock.execFileSync).toHaveBeenNthCalledWith(
      1,
      process.platform === "win32" ? "where.exe" : "which",
      [process.platform === "win32" ? "node.exe" : "node"],
      { encoding: "utf8" },
    );
  });

  it("rejects a Node runtime for another architecture", () => {
    const arch = process.arch === "arm64" ? "x64" : "arm64";
    mockNodeRuntime({ arch });

    expect(detectNodeRuntime(join(resourcesPath, "node"))).toMatchObject({
      state: "invalid",
      version: "v24.15.0",
      message: expect.stringContaining(`需要 ${process.platform}/${process.arch}，当前为 ${process.platform}/${arch}`),
    });
  });

  it("rejects a Node runtime for another platform", () => {
    const platform = process.platform === "darwin" ? "linux" : "darwin";
    mockNodeRuntime({ platform });

    expect(detectNodeRuntime(join(resourcesPath, "node"))).toMatchObject({
      state: "invalid",
      version: "v24.15.0",
      message: expect.stringContaining(`需要 ${process.platform}/${process.arch}，当前为 ${platform}/${process.arch}`),
    });
  });

  it.each([{ modulesAbi: "unknown" }, { napi: "unknown" }])("does not accept invalid ABI metadata: %o", (metadata) => {
    mockNodeRuntime(metadata);

    expect(detectNodeRuntime(join(resourcesPath, "node"))).toMatchObject({ state: "missing" });
  });

  it("derives the npm CLI from a selected packaged Node runtime", () => {
    const manifestPath = writeManifest("app.asar.unpacked");
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as NodeRuntimeManifest;
    parsed.npmCliPath = "";
    parsed.integrity.npmCliPath = "";
    writeFileSync(manifestPath, JSON.stringify(parsed));

    const runtimeRoot = join(resourcesPath, "selected-node");
    const nodePath = join(runtimeRoot, process.platform === "win32" ? "node.exe" : "bin/node");
    const npmCliPath = join(
      runtimeRoot,
      ...(process.platform === "win32"
        ? ["node_modules", "npm", "bin", "npm-cli.js"]
        : ["lib", "node_modules", "npm", "bin", "npm-cli.js"]),
    );
    mkdirSync(dirname(nodePath), { recursive: true });
    mkdirSync(dirname(npmCliPath), { recursive: true });
    writeRuntimeFile(nodePath, "node");
    writeRuntimeFile(npmCliPath, "npm");
    mockNodeRuntime();

    const manifest = loadNodeRuntimeManifest({
      isPackaged: true,
      resourcesPath,
      appDir: join(resourcesPath, "unused"),
      nodePathOverride: nodePath,
    });

    expect(manifest.npmCliPath).toBe(npmCliPath);
  });

  it("recomputes build-specific compatibility for the selected Node runtime", () => {
    writeManifest("app.asar.unpacked");
    const nodePath = writeRuntimeFile(join(resourcesPath, "node"), "node");
    mockNodeRuntime({ osRelease: "windows-10+", libc: "ucrt", toolchain: "x64:x64:0" });

    const manifest = loadNodeRuntimeManifest({
      isPackaged: true,
      resourcesPath,
      appDir: join(resourcesPath, "unused"),
      nodePathOverride: nodePath,
    });

    const identity = {
      nodeVersion: "v24.15.0",
      modulesAbi: "137",
      napi: "10",
      platform: process.platform,
      arch: process.arch,
      osRelease: "windows-10+",
      libc: "ucrt",
      toolchain: "x64:x64:0",
      piVersion: "test",
    };
    expect(manifest.compatibility).toMatchObject({
      ...identity,
      runtimeCompatibilityId: hash(JSON.stringify(identity)),
    });
  });

  it("rejects an incompatible manifest Node override", () => {
    writeManifest("app.asar.unpacked");
    const nodePath = writeRuntimeFile(join(resourcesPath, "node"), "node");
    mockNodeRuntime({ arch: process.arch === "arm64" ? "x64" : "arm64" });

    expect(() =>
      loadNodeRuntimeManifest({
        isPackaged: true,
        resourcesPath,
        appDir: join(resourcesPath, "unused"),
        nodePathOverride: nodePath,
      }),
    ).toThrow("与当前 Desktop 不兼容");
  });

  function writeManifest(container: string): string {
    const manifestRoot = join(resourcesPath, "pi-sidecar");
    const runtimeRoot = join(resourcesPath, container, "runtime");
    mkdirSync(manifestRoot, { recursive: true });
    mkdirSync(runtimeRoot, { recursive: true });
    const nodePath = writeRuntimeFile(join(runtimeRoot, "node"), "node");
    const npmCliPath = writeRuntimeFile(join(runtimeRoot, "npm-cli.js"), "npm");
    const piExecutable = writeRuntimeFile(join(runtimeRoot, process.platform === "win32" ? "pi.cmd" : "pi"), "pi");
    const roles = ["thread", "metadata"] as const;
    const entries = Object.fromEntries(
      roles.map((role) => [role, writeRuntimeFile(join(runtimeRoot, `${role}.js`), role)]),
    ) as NodeRuntimeManifest["entries"];
    const manifest: NodeRuntimeManifest = {
      nodePath: relative(manifestRoot, nodePath),
      npmCliPath: relative(manifestRoot, npmCliPath),
      piExecutable: relative(manifestRoot, piExecutable),
      entries: Object.fromEntries(
        Object.entries(entries).map(([role, path]) => [role, relative(manifestRoot, path)]),
      ) as NodeRuntimeManifest["entries"],
      compatibility: {
        nodeVersion: process.version,
        modulesAbi: process.versions.modules,
        napi: process.versions.napi ?? "unknown",
        platform: process.platform,
        arch: process.arch,
        osRelease: "test",
        libc: "test",
        toolchain: "test",
        piVersion: "test",
        runtimeCompatibilityId: "test",
      },
      integrity: {
        nodePath: hash("node"),
        npmCliPath: hash("npm"),
        piExecutable: hash("pi"),
        entries: Object.fromEntries(roles.map((role) => [role, hash(role)])) as NodeRuntimeManifest["entries"],
        files: {},
      },
    };
    const manifestPath = join(manifestRoot, "runtime-manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    return manifestPath;
  }
});

function mockNodeRuntime(
  overrides: Partial<{
    nodeVersion: string;
    modulesAbi: string;
    napi: string;
    platform: string;
    arch: string;
    osRelease: string;
    libc: string;
    toolchain: string;
  }> = {},
): void {
  childProcessMock.execFileSync.mockReturnValue(
    JSON.stringify({
      nodeVersion: "v24.15.0",
      modulesAbi: "137",
      napi: "10",
      platform: process.platform,
      arch: process.arch,
      osRelease: "test-os",
      libc: "test-libc",
      toolchain: "test-toolchain",
      ...overrides,
    }),
  );
}

function writeRuntimeFile(path: string, content: string): string {
  writeFileSync(path, content);
  return path;
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
