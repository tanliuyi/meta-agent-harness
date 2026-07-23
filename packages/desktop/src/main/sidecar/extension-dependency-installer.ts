import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ExtensionDependencyProgress } from "../../shared/extension-dependency-contracts.ts";
import { terminateProcessTree } from "../../shared/process-tree.ts";
import type { NodeRuntimeManifest } from "./node-runtime-locator.ts";
import { createSidecarEnvironment } from "./sidecar-environment.ts";

const MAX_OUTPUT_CHARS = 256 * 1024;
const PREPARATION_TIMEOUT_MS = 15 * 60 * 1000;

export class ExtensionDependencyInstaller {
  private readonly manifest: NodeRuntimeManifest;
  private readonly agentDir: string;
  private readonly log?: (text: string) => void;
  private readonly listeners = new Set<(progress: ExtensionDependencyProgress) => void>();
  private readonly preparations = new Map<string, Promise<void>>();
  private queue: Promise<void> = Promise.resolve();
  private activeChild?: ChildProcess;
  private disposed = false;

  constructor(manifest: NodeRuntimeManifest, agentDir: string, log?: (text: string) => void) {
    this.manifest = manifest;
    this.agentDir = agentDir;
    this.log = log;
  }

  onProgress(listener: (progress: ExtensionDependencyProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  prepare(cwd: string, source: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Extension dependency installer is disposed"));
    if (!/^npm:(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[^\s]+)?$/i.test(source)) {
      return Promise.reject(new Error("Invalid extension dependency source"));
    }
    const key = `${resolve(cwd)}\0${source}`;
    const existing = this.preparations.get(key);
    if (existing) return existing;

    const preparation = this.queue.then(async () => {
      if (this.disposed) throw new Error("Extension dependency installer is disposed");
      await this.prepareOnce(cwd, source);
    });
    const tracked = preparation.finally(() => {
      if (this.preparations.get(key) === tracked) this.preparations.delete(key);
    });
    this.preparations.set(key, tracked);
    this.queue = tracked.catch(() => {});
    return tracked;
  }

  dispose(): void {
    this.disposed = true;
    const child = this.activeChild;
    this.activeChild = undefined;
    if (child?.pid) terminateProcessTree(child.pid, "SIGKILL", () => child.kill("SIGKILL"));
  }

  private async prepareOnce(cwd: string, source: string): Promise<void> {
    this.emit({ phase: "preparing", message: "正在更新扩展..." });
    try {
      await this.runUpdate(cwd, source);
      this.emit({ phase: "ready", message: "扩展已更新，正在重启 Desktop..." });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.log?.(`Extension dependency update failed: ${detail}`);
      this.emit({ phase: "error", message: "扩展更新失败，请重试。" });
      throw error;
    }
  }

  private runUpdate(cwd: string, source: string): Promise<void> {
    if (!this.manifest.npmCliPath) {
      return Promise.reject(new Error("npm CLI is unavailable for the selected Desktop runtime"));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(this.manifest.nodePath, [this.manifest.entries.thread, "update", "--extension", source], {
        cwd,
        env: createSidecarEnvironment(
          this.manifest.compatibility.runtimeCompatibilityId,
          this.agentDir,
          this.manifest.nodePath,
          this.manifest.npmCliPath,
          this.manifest.piExecutable,
          this.manifest.entries.thread,
        ),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      this.activeChild = child;
      let output = "";
      const append = (chunk: Buffer | string): void => {
        const text = chunk.toString();
        output = `${output}${text}`.slice(-MAX_OUTPUT_CHARS);
        this.log?.(text);
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      const timer = setTimeout(() => {
        if (child.pid) terminateProcessTree(child.pid, "SIGKILL", () => child.kill("SIGKILL"));
        reject(new Error("Extension dependency update timed out"));
      }, PREPARATION_TIMEOUT_MS);
      child.once("error", (error) => {
        clearTimeout(timer);
        if (this.activeChild === child) this.activeChild = undefined;
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (this.activeChild === child) this.activeChild = undefined;
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `Extension dependency update exited with ${code ?? signal ?? "unknown"}${output ? `\n${output.trim()}` : ""}`,
            ),
          );
      });
    });
  }

  private emit(progress: ExtensionDependencyProgress): void {
    for (const listener of this.listeners) listener(progress);
  }
}
