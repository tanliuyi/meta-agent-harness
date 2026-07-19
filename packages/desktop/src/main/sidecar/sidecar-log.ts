import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";

export class SidecarLog {
  readonly path: string;
  private readonly stream: WriteStream;

  constructor(userDataDir: string) {
    const directory = join(userDataDir, "logs");
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, "sidecar.log");
    this.stream = createWriteStream(this.path, { flags: "a" });
  }

  write(scope: string, value: string): void {
    const message = value.trimEnd();
    if (!message) return;
    const line = `${new Date().toISOString()} [${scope}] ${message}\n`;
    process.stderr.write(line);
    this.stream.write(line);
  }

  dispose(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}
