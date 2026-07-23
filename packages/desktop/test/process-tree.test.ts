import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { terminateProcessTree } from "../src/shared/process-tree.ts";

describe("process tree termination", () => {
  it("terminates a detached parent and its descendant", async () => {
    const parent = spawn(
      process.execPath,
      [
        "-e",
        [
          'const { spawn } = require("node:child_process");',
          'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
          'process.stdout.write(String(child.pid) + "\\n");',
          "setInterval(() => {}, 1000);",
        ].join(""),
      ],
      {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
    if (!parent.pid || !parent.stdout) throw new Error("Process tree fixture failed to start");
    const descendantPid = await readPid(parent.stdout);

    try {
      terminateProcessTree(parent.pid, "SIGKILL");
      await Promise.all([waitUntilStopped(parent.pid), waitUntilStopped(descendantPid)]);
      expect(isRunning(parent.pid)).toBe(false);
      expect(isRunning(descendantPid)).toBe(false);
    } finally {
      terminateProcessTree(parent.pid, "SIGKILL");
      terminateProcessTree(descendantPid, "SIGKILL");
    }
  }, 10_000);
});

function readPid(stream: NodeJS.ReadableStream): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for descendant PID")), 2_000);
    stream.once("data", (chunk: Buffer | string) => {
      clearTimeout(timer);
      const pid = Number(chunk.toString().trim());
      if (!Number.isSafeInteger(pid) || pid < 1) reject(new Error("Invalid descendant PID"));
      else resolve(pid);
    });
  });
}

async function waitUntilStopped(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (isRunning(pid)) {
    if (Date.now() >= deadline) throw new Error(`Process ${pid} did not stop`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
