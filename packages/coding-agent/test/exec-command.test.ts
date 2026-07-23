import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execCommand } from "../src/core/exec.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("execCommand", () => {
	it.skipIf(process.platform !== "win32")("executes Windows command launchers", async () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-exec-command-"));
		temporaryDirectories.push(directory);
		const launcher = join(directory, "probe.cmd");
		writeFileSync(launcher, "@echo off\r\necho %~1\r\n");
		const previousComspec = process.env.comspec;
		process.env.comspec = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");

		try {
			await expect(execCommand(launcher, ["ready"], directory)).resolves.toMatchObject({
				stdout: "ready\r\n",
				code: 0,
				killed: false,
			});
		} finally {
			if (previousComspec === undefined) delete process.env.comspec;
			else process.env.comspec = previousComspec;
		}
	});
});
