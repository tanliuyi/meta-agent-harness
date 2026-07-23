import { spawn } from "node:child_process";
import { join } from "node:path";

export function windowsSystemDirectory(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const rootEntry = Object.entries(environment).find(([name]) => {
    const normalized = name.toLowerCase();
    return normalized === "systemroot" || normalized === "windir";
  });
  return rootEntry?.[1] ? join(rootEntry[1], "System32") : undefined;
}

/** Terminates a detached process group on Unix and a process tree on Windows. */
export function terminateProcessTree(
  pid: number,
  signal: NodeJS.Signals,
  fallback: () => void = () => terminateSingleProcess(pid, signal),
): void {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
    } catch {
      fallback();
    }
    return;
  }

  const systemDirectory = windowsSystemDirectory();
  const executable = systemDirectory ? join(systemDirectory, "taskkill.exe") : "taskkill";
  const args = ["/pid", String(pid), "/T", "/F"];
  let fellBack = false;
  const runFallback = () => {
    if (fellBack) return;
    fellBack = true;
    fallback();
  };
  const killer = spawn(executable, args, {
    stdio: "ignore",
    windowsHide: true,
    detached: true,
  });
  killer.once("error", runFallback);
  killer.once("exit", (code) => {
    if (code !== 0) runFallback();
  });
  killer.unref();
}

function terminateSingleProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // The target already exited.
  }
}
