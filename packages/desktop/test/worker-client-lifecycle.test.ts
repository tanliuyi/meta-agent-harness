import { delimiter, dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { NodeRuntimeManifest } from "../src/main/sidecar/node-runtime-locator.ts";
import { createSidecarEnvironment, SidecarWorkerClient } from "../src/main/sidecar/worker-client.ts";

describe("SidecarWorkerClient lifecycle", () => {
  it("locks Pi child routing to the selected Desktop runtime", () => {
    const previousSubagentBinary = process.env.PI_SUBAGENT_PI_BINARY;
    const previousDesktopEntry = process.env.PI_DESKTOP_PI_ENTRY;
    process.env.PI_subagent_pi_binary = "/external/pi";
    process.env.PI_desktop_pi_entry = "/external/entry.js";
    try {
      const environment = createSidecarEnvironment(
        "runtime-id",
        "/agent",
        "/runtime/node",
        "/resources/bin/pi",
        "/resources/thread.js",
      );

      expect(Object.keys(environment).some((name) => name.toUpperCase() === "PI_SUBAGENT_PI_BINARY")).toBe(false);
      expect(environment.PI_DESKTOP_NODE_EXEC_PATH).toBe("/runtime/node");
      expect(environment.PI_DESKTOP_PI_ENTRY).toBe("/resources/thread.js");
      expect(environment.PI_DESKTOP_RUNTIME_COMPATIBILITY_ID).toBe("runtime-id");
      expect(environment.PATH?.split(delimiter).slice(0, 2)).toEqual([
        dirname("/resources/bin/pi"),
        dirname("/runtime/node"),
      ]);
    } finally {
      delete process.env.PI_subagent_pi_binary;
      delete process.env.PI_desktop_pi_entry;
      restoreEnvironment("PI_SUBAGENT_PI_BINARY", previousSubagentBinary);
      restoreEnvironment("PI_DESKTOP_PI_ENTRY", previousDesktopEntry);
    }
  });

  it("escalates an unresponsive worker from graceful shutdown through SIGKILL", async () => {
    const stderr: string[] = [];
    const client = new SidecarWorkerClient({
      manifest: manifest(),
      binding: { role: "metadata", value: { agentDir: "/tmp", userDataDir: "/tmp" } },
      onStderr: (text) => stderr.push(text),
    });
    await client.ready();
    expect(stderr.join("")).toContain("fixture sidecar stderr");
    const pid = client.pid;
    if (!pid) throw new Error("Stubborn sidecar PID is missing");

    const pendingMutation = client.request({ type: "setEditorText", text: "draft" }, 10_000);
    await client.shutdown(25);
    await expect(pendingMutation).rejects.not.toMatchObject({ code: "SIDECAR_MUTATION_UNKNOWN_OUTCOME" });

    expect(() => process.kill(pid, 0)).toThrow();
  }, 5_000);
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function manifest(): NodeRuntimeManifest {
  return {
    nodePath: process.execPath,
    npmCliPath: process.execPath,
    piExecutable: process.execPath,
    entries: {
      thread: "",
      metadata: resolve(import.meta.dirname, "fixtures/stubborn-sidecar.mjs"),
    },
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
      nodePath: "",
      npmCliPath: "",
      piExecutable: "",
      entries: { thread: "", metadata: "" },
      files: {},
    },
  };
}
