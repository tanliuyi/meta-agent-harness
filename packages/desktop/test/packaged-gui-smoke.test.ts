import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGuiSmokeDesktopState,
  createMinimalGuiEnvironment,
  includeDetachedMetadataWorkers,
  inspectGuiSidecarReadiness,
  locateDesktopExecutable,
  parseArguments,
} from "../../../scripts/smoke-desktop-gui.mjs";

describe("packaged Desktop GUI smoke contract", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("parses an artifact path with spaces and explicit lifecycle mode", () => {
    expect(
      parseArguments([
        "--artifact",
        "/tmp/Meta Agent 安装.app",
        "--mode",
        "normal",
        "--timeout",
        "5000",
        "--keep-temp",
      ]),
    ).toEqual({
      artifact: resolve("/tmp/Meta Agent 安装.app"),
      help: false,
      keepTemp: true,
      mode: "normal",
      timeoutMs: 5000,
    });
  });

  it("rejects invalid mode and readiness timeout values", () => {
    expect(() => parseArguments(["--mode", "resume"])).toThrow("--mode must be one of");
    expect(() => parseArguments(["--timeout", "99"])).toThrow("between 1000 and 300000");
  });

  it("locates a macOS app executable without normalizing Unicode bundle paths", () => {
    const root = mkdtempSync(join(tmpdir(), "desktop-gui-smoke-fixture-"));
    temporaryDirectories.push(root);
    const app = join(root, "安装 路径", "Meta Agent.app");
    const executable = join(app, "Contents", "MacOS", "Meta Agent");
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    writeFileSync(
      join(app, "Contents", "Info.plist"),
      '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Meta Agent</string></dict></plist>',
    );
    writeFileSync(executable, "placeholder");

    expect(locateDesktopExecutable(app, "darwin")).toBe(executable);
  });

  it("places the selected Node before a minimal system PATH and strips shell overrides", () => {
    const environment = createMinimalGuiEnvironment(
      {
        ELECTRON_RUN_AS_NODE: "1",
        HOME: "/tmp/home",
        OPENAI_API_KEY: "must-not-leak",
        PATH: "/untrusted/user/path",
      },
      "/usr/local/bin/node",
      { agentDir: "/tmp/agent", cwd: "/tmp/cwd", root: "/tmp", userDataDir: "/tmp/user-data" },
    );

    expect(environment).toMatchObject({
      HOME: "/tmp/home",
      PI_CODING_AGENT_DIR: "/tmp/agent",
      PI_DESKTOP_NODE_EXEC_PATH: "/usr/local/bin/node",
    });
    expect(environment.PATH.startsWith("/usr/local/bin")).toBe(true);
    expect(environment.PATH).not.toContain("/untrusted/user/path");
    expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(environment.OPENAI_API_KEY).toBeUndefined();
  });

  it("seeds an active project so renderer startup triggers the metadata sidecar", () => {
    expect(createGuiSmokeDesktopState("/tmp/working directory", 123)).toEqual({
      version: 1,
      activeProjectId: "desktop-gui-smoke-project",
      projects: [
        {
          id: "desktop-gui-smoke-project",
          name: "Desktop GUI smoke project",
          cwd: "/tmp/working directory",
          lastOpenedAt: 123,
        },
      ],
      archivedThreads: {},
      workbenches: {},
    });
  });

  it("keeps polling after renderer readiness until the metadata sidecar appears", () => {
    const version = { Browser: "Chrome/1" };
    const targets = [{ type: "page", url: "file:///Applications/Meta Agent.app/renderer/index.html" }];
    expect(inspectGuiSidecarReadiness(version, targets, [], "/usr/local/bin/node")).toEqual({
      status: "pending",
      reason: "GUI became reachable but no Node metadata sidecar was observed",
    });

    const processes = [
      {
        pid: 42,
        ppid: 41,
        command:
          "/usr/local/bin/node /Applications/Meta Agent.app/Contents/Resources/app.asar.unpacked/out/sidecar/metadata-worker-main.js",
      },
    ];
    expect(inspectGuiSidecarReadiness(version, targets, processes, "/usr/local/bin/node")).toEqual({
      status: "ready",
      result: {
        processes,
        sidecarCommand: processes[0]?.command,
        targetUrl: targets[0]?.url,
      },
    });
  });

  it("ignores metadata workers that existed before the Windows smoke scenario", () => {
    const existing = {
      pid: 42,
      ppid: 1,
      command:
        '"C:\\Program Files\\nodejs\\node.exe" C:\\Installed\\resources\\app.asar.unpacked\\out\\sidecar\\metadata-worker-main.js',
    };
    const launched = {
      pid: 84,
      ppid: 1,
      command:
        '"C:\\Program Files\\nodejs\\node.exe" C:\\Artifact\\resources\\app.asar.unpacked\\out\\sidecar\\metadata-worker-main.js',
    };

    expect(includeDetachedMetadataWorkers([], [existing, launched], new Set([existing.pid]))).toEqual([launched]);
  });

  it("recognizes a quoted Windows Node sidecar command", () => {
    const version = { Browser: "Chrome/1" };
    const targets = [{ type: "page", url: "file:///C:/Meta%20Agent/resources/app.asar/renderer/index.html" }];
    const processes = [
      {
        pid: 42,
        ppid: 41,
        command:
          '"C:\\Program Files\\nodejs\\node.exe" C:\\Meta Agent\\resources\\app.asar.unpacked\\out\\sidecar\\metadata-worker-main.js',
      },
    ];

    expect(inspectGuiSidecarReadiness(version, targets, processes, "C:\\Program Files\\nodejs\\node.exe")).toEqual({
      status: "ready",
      result: {
        processes,
        sidecarCommand: processes[0]?.command,
        targetUrl: targets[0]?.url,
      },
    });
  });

  it("locates an executable in an unpacked Linux artifact directory", () => {
    const root = mkdtempSync(join(tmpdir(), "desktop-gui-smoke-fixture-"));
    temporaryDirectories.push(root);
    const executable = join(root, "Meta Agent.AppImage");
    writeFileSync(executable, "placeholder");
    chmodSync(executable, 0o755);

    expect(locateDesktopExecutable(root, "linux")).toBe(executable);
  });
});
