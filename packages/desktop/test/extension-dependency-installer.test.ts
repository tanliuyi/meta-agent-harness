import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRuntimeManifest } from "../src/main/sidecar/node-runtime-locator.ts";

const childProcessMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: childProcessMock.spawn }));

import { ExtensionDependencyInstaller } from "../src/main/sidecar/extension-dependency-installer.ts";

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
}

describe("ExtensionDependencyInstaller", () => {
  beforeEach(() => childProcessMock.spawn.mockReset());

  it("uses the selected Desktop Node, npm CLI, entry, and runtime identity", async () => {
    const child = new FakeChild();
    childProcessMock.spawn.mockReturnValue(child);
    const progress: string[] = [];
    const installer = new ExtensionDependencyInstaller(manifest(), "/agent");
    installer.onProgress((event) => progress.push(event.phase));

    const preparation = installer.prepare("/project", "npm:pi-hermes-memory");
    await vi.waitFor(() => expect(childProcessMock.spawn).toHaveBeenCalledOnce());
    child.emit("exit", 0, null);
    await preparation;

    expect(childProcessMock.spawn).toHaveBeenCalledOnce();
    expect(childProcessMock.spawn).toHaveBeenCalledWith(
      "/runtime/node",
      ["/runtime/thread.js", "update", "--extension", "npm:pi-hermes-memory"],
      expect.objectContaining({
        cwd: "/project",
        windowsHide: true,
        env: expect.objectContaining({
          PI_CODING_AGENT_DIR: "/agent",
          PI_DESKTOP_NODE_EXEC_PATH: "/runtime/node",
          PI_DESKTOP_NPM_CLI_PATH: "/runtime/npm-cli.js",
          PI_DESKTOP_PI_ENTRY: "/runtime/thread.js",
          PI_DESKTOP_RUNTIME_COMPATIBILITY_ID: "runtime-id",
        }),
      }),
    );
    expect(progress).toEqual(["preparing", "ready"]);
  });

  it("coalesces concurrent preparation requests for the same project and source", async () => {
    const child = new FakeChild();
    childProcessMock.spawn.mockReturnValue(child);
    const installer = new ExtensionDependencyInstaller(manifest(), "/agent");

    const first = installer.prepare("/project-a", "npm:pi-hermes-memory");
    const second = installer.prepare("/project-a", "npm:pi-hermes-memory");
    expect(first).toBe(second);
    await vi.waitFor(() => expect(childProcessMock.spawn).toHaveBeenCalledOnce());

    child.emit("exit", 0, null);
    await Promise.all([first, second]);
  });

  it("serializes preparation requests for different dependencies", async () => {
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    childProcessMock.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const installer = new ExtensionDependencyInstaller(manifest(), "/agent");

    const first = installer.prepare("/project-a", "npm:first-extension");
    const second = installer.prepare("/project-b", "npm:second-extension");
    await vi.waitFor(() => expect(childProcessMock.spawn).toHaveBeenCalledOnce());

    firstChild.emit("exit", 0, null);
    await first;
    await vi.waitFor(() => expect(childProcessMock.spawn).toHaveBeenCalledTimes(2));
    expect(childProcessMock.spawn.mock.calls[1]?.[1]).toContain("npm:second-extension");

    secondChild.emit("exit", 0, null);
    await second;
  });

  it("rejects a runtime without an npm CLI before spawning a package command", async () => {
    const installer = new ExtensionDependencyInstaller({ ...manifest(), npmCliPath: "" }, "/agent");

    await expect(installer.prepare("/project", "npm:pi-hermes-memory")).rejects.toThrow("npm CLI is unavailable");
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  it("rejects non-npm sources before spawning a package command", async () => {
    const installer = new ExtensionDependencyInstaller(manifest(), "/agent");

    await expect(installer.prepare("/project", "git:example/repo")).rejects.toThrow(
      "Invalid extension dependency source",
    );
    await expect(installer.prepare("/project", "npm:--ignore-scripts")).rejects.toThrow(
      "Invalid extension dependency source",
    );
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  it("reports a customer-safe failure while retaining command output in the error", async () => {
    const child = new FakeChild();
    childProcessMock.spawn.mockReturnValue(child);
    const progress: Array<{ phase: string; message: string }> = [];
    const installer = new ExtensionDependencyInstaller(manifest(), "/agent");
    installer.onProgress((event) => progress.push(event));

    const preparation = installer.prepare("/project", "npm:pi-hermes-memory");
    await vi.waitFor(() => expect(childProcessMock.spawn).toHaveBeenCalledOnce());
    child.stderr.write("npm internal detail");
    child.emit("exit", 1, null);

    await expect(preparation).rejects.toThrow("npm internal detail");
    expect(progress.at(-1)).toEqual(expect.objectContaining({ phase: "error", message: "扩展更新失败，请重试。" }));
  });
});

function manifest(): NodeRuntimeManifest {
  return {
    nodePath: "/runtime/node",
    npmCliPath: "/runtime/npm-cli.js",
    piExecutable: "/runtime/bin/pi",
    entries: { thread: "/runtime/thread.js", metadata: "/runtime/metadata.js" },
    compatibility: {
      nodeVersion: "v24.15.0",
      modulesAbi: "137",
      napi: "10",
      platform: process.platform,
      arch: process.arch,
      osRelease: "test",
      libc: "test",
      toolchain: "test",
      piVersion: "test",
      runtimeCompatibilityId: "runtime-id",
    },
    integrity: {
      nodePath: "",
      npmCliPath: "",
      piExecutable: "",
      entries: { thread: "", metadata: "" },
      files: {},
    },
  };
}
