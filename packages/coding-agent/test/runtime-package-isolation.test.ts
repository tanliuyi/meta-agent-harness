import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

interface PackageManagerInternals {
	runNpmCommand(args: string[], options?: { cwd?: string }): Promise<void>;
}

describe("runtime-specific package dependencies", () => {
	let root: string;
	let agentDir: string;
	let settings: SettingsManager;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "pi-runtime-deps-"));
		agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		settings = SettingsManager.inMemory();
		settings.setPackages(["npm:runtime-probe"]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	it("resolves only the npm tree for the selected runtime", async () => {
		const runtimeA = "system-node:v24.14.0:win32:x64:137";
		const runtimeB = "system-node:v25.2.1:win32:x64:141";
		writeExtensionPackage(join(agentDir, "npm", "node_modules", "runtime-probe"), "legacy");
		const runtimeAPath = writeRuntimeExtensionPackage(agentDir, runtimeA, "runtime-a");

		const managerA = createManager(runtimeA);
		const result = await managerA.resolve(async () => "error");
		expect(result.extensions.map(({ path }) => path)).toContain(join(runtimeAPath, "index.ts"));
		expect(result.extensions.some(({ path }) => path.includes(`${join(agentDir, "npm")}`))).toBe(false);

		const managerB = createManager(runtimeB);
		await expect(managerB.resolve(async () => "error")).rejects.toThrow(
			`Missing source for runtime ${runtimeB}: npm:runtime-probe`,
		);
	});

	it("fails closed instead of installing implicitly when a runtime package is missing", async () => {
		const runtimeId = "system-node:v24.14.0:win32:x64:137";
		const manager = createManager(runtimeId);
		const install = vi.spyOn(manager as unknown as PackageManagerInternals, "runNpmCommand").mockResolvedValue();

		await expect(manager.resolve()).rejects.toMatchObject({
			name: "MissingRuntimeDependencyError",
			message: expect.stringContaining(`Missing source for runtime ${runtimeId}: npm:runtime-probe`),
			code: "PI_RUNTIME_DEPENDENCY_MISSING",
			details: { runtimeDependencyId: runtimeId, source: "npm:runtime-probe" },
		});
		expect(install).not.toHaveBeenCalled();
	});

	it("requires bundled host dependencies for detached extension processes", async () => {
		const runtimeId = "system-node:v24.14.0:win32:x64:137";
		writeRuntimeExtensionPackage(agentDir, runtimeId, "runtime-a", false);

		await expect(createManager(runtimeId).resolve()).rejects.toMatchObject({
			code: "PI_RUNTIME_DEPENDENCY_MISSING",
			details: { runtimeDependencyId: runtimeId, source: "npm:runtime-probe" },
		});
	});

	it("rejects a populated runtime tree without its identity manifest", async () => {
		const runtimeId = "system-node:v24.14.0:win32:x64:137";
		writeExtensionPackage(runtimePackagePath(agentDir, runtimeId), "unidentified");

		await expect(createManager(runtimeId).resolve(async () => "error")).rejects.toThrow(
			"Missing runtime dependency manifest",
		);
	});

	it("writes and validates the runtime manifest before installing", async () => {
		const runtimeId = "system-node:v24.14.0:win32:x64:137";
		const manager = createManager(runtimeId);
		const install = vi.spyOn(manager as unknown as PackageManagerInternals, "runNpmCommand").mockResolvedValue();

		await manager.install("npm:runtime-probe");

		expect(install.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(["runtime-probe", "typebox@1.1.38"]));

		const installRoot = dirname(dirname(runtimePackagePath(agentDir, runtimeId)));
		const manifestPath = join(dirname(installRoot), "runtime.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			schemaVersion: number;
			runtimeDependencyId: string;
			modulesAbi: string;
		};
		expect(manifest).toMatchObject({
			schemaVersion: 1,
			runtimeDependencyId: runtimeId,
			modulesAbi: process.versions.modules,
		});

		writeFileSync(manifestPath, JSON.stringify({ ...manifest, runtimeDependencyId: "other-runtime" }));
		await expect(manager.install("npm:runtime-probe")).rejects.toThrow("runtimeDependencyId");
	});

	it("serializes concurrent mutations of one runtime npm tree", async () => {
		const runtimeId = "system-node:v24.14.0:win32:x64:137";
		const first = createManager(runtimeId);
		const second = createManager(runtimeId);
		let active = 0;
		let maxActive = 0;
		const mockInstall = async (): Promise<void> => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 50));
			active -= 1;
		};
		vi.spyOn(first as unknown as PackageManagerInternals, "runNpmCommand").mockImplementation(mockInstall);
		vi.spyOn(second as unknown as PackageManagerInternals, "runNpmCommand").mockImplementation(mockInstall);

		await Promise.all([first.install("npm:runtime-probe"), second.install("npm:runtime-probe")]);

		expect(maxActive).toBe(1);
	});

	it("prepares missing pinned packages through an explicit update", async () => {
		const runtimeId = "system-node:v24.14.0:win32:x64:137";
		settings.setPackages(["npm:runtime-probe@1.0.0"]);
		const manager = createManager(runtimeId);
		const install = vi.spyOn(manager as unknown as PackageManagerInternals, "runNpmCommand").mockResolvedValue();

		await manager.update();

		expect(install).toHaveBeenCalledOnce();
		expect(install.mock.calls[0]?.[0]).toContain("runtime-probe@1.0.0");
	});

	it("repairs host dependencies even when a pinned extension is already installed", async () => {
		const runtimeId = "system-node:v24.14.0:win32:x64:137";
		settings.setPackages(["npm:runtime-probe@1.0.0"]);
		writeRuntimeExtensionPackage(agentDir, runtimeId, "runtime-a", false);
		const manager = createManager(runtimeId);
		const install = vi.spyOn(manager as unknown as PackageManagerInternals, "runNpmCommand").mockResolvedValue();

		await manager.update();

		expect(install).toHaveBeenCalledOnce();
		expect(install.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(["runtime-probe@1.0.0", "typebox@1.1.38"]));
	});

	it("keeps local extension sources shared across runtimes", async () => {
		const extensionPath = join(agentDir, "extensions", "shared.ts");
		mkdirSync(dirname(extensionPath), { recursive: true });
		writeFileSync(extensionPath, "export default function () {}\n");
		settings.setPackages([]);
		settings.setExtensionPaths(["extensions/shared.ts"]);

		const resultA = await createManager("runtime-a").resolve(async () => "error");
		const resultB = await createManager("runtime-b").resolve(async () => "error");
		expect(resultA.extensions.map(({ path }) => path)).toContain(extensionPath);
		expect(resultB.extensions.map(({ path }) => path)).toContain(extensionPath);
	});

	function createManager(runtimeDependencyId: string): DefaultPackageManager {
		return new DefaultPackageManager({
			cwd: root,
			agentDir,
			settingsManager: settings,
			runtimeDependencyId,
		});
	}
});

function runtimeDependencyPathSegment(runtimeDependencyId: string): string {
	return `v1-${createHash("sha256").update(runtimeDependencyId).digest("hex").slice(0, 24)}`;
}

function runtimePackagePath(agentDir: string, runtimeDependencyId: string): string {
	return join(
		agentDir,
		"runtime-deps",
		runtimeDependencyPathSegment(runtimeDependencyId),
		"npm",
		"node_modules",
		"runtime-probe",
	);
}

function writeRuntimeExtensionPackage(
	agentDir: string,
	runtimeDependencyId: string,
	marker: string,
	includeHostDependencies = true,
): string {
	const packagePath = runtimePackagePath(agentDir, runtimeDependencyId);
	const runtimeRoot = dirname(dirname(dirname(packagePath)));
	mkdirSync(runtimeRoot, { recursive: true });
	writeFileSync(
		join(runtimeRoot, "runtime.json"),
		JSON.stringify({
			schemaVersion: 1,
			runtimeDependencyId,
			nodeVersion: process.version,
			modulesAbi: process.versions.modules,
			platform: process.platform,
			arch: process.arch,
		}),
	);
	writeExtensionPackage(packagePath, marker);
	if (includeHostDependencies) {
		const typeboxRoot = join(dirname(packagePath), "typebox");
		mkdirSync(join(typeboxRoot, "build", "compile"), { recursive: true });
		writeFileSync(join(typeboxRoot, "package.json"), JSON.stringify({ name: "typebox", version: "1.1.38" }));
		writeFileSync(join(typeboxRoot, "build", "compile", "index.mjs"), "export const Compile = () => ({});\n");
	}
	return packagePath;
}

function writeExtensionPackage(path: string, marker: string): void {
	mkdirSync(path, { recursive: true });
	writeFileSync(
		join(path, "package.json"),
		JSON.stringify({ name: "runtime-probe", version: "1.0.0", pi: { extensions: ["./index.ts"] } }),
	);
	writeFileSync(join(path, "index.ts"), `export default function () { return ${JSON.stringify(marker)}; }\n`);
}
