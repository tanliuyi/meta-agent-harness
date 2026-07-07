#!/usr/bin/env node

import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstreamPackagesDir = path.join(repoRoot, "vendor", "pi", "packages");
const localPackagesDir = path.join(repoRoot, "packages");
const syncedPiPackages = ["agent", "ai"];
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

const ignoredNames = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".turbo",
	".next",
	".nuxt",
	".vite",
]);

async function directoryExists(dir) {
	try {
		return (await stat(dir)).isDirectory();
	} catch {
		return false;
	}
}

async function readPackageName(packageDir) {
	const raw = await readFile(path.join(packageDir, "package.json"), "utf8");
	const pkg = JSON.parse(raw);
	if (!pkg.name || typeof pkg.name !== "string") {
		throw new Error(`package.json missing name: ${packageDir}`);
	}
	return pkg.name;
}

async function getPackageDirs(parentDir) {
	const entries = await readdir(parentDir, { withFileTypes: true });
	const packages = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const packageDir = path.join(parentDir, entry.name);
		try {
			await readPackageName(packageDir);
			packages.push(entry.name);
		} catch (error) {
			if (error.code !== "ENOENT") {
				throw error;
			}
		}
	}
	return packages.sort();
}

function shouldCopy(src) {
	const baseName = path.basename(src);
	if (ignoredNames.has(baseName)) {
		return false;
	}
	return !baseName.endsWith(".tsbuildinfo");
}

async function main() {
	if (!(await directoryExists(upstreamPackagesDir))) {
		throw new Error(
			`Missing upstream packages directory: ${path.relative(repoRoot, upstreamPackagesDir)}. Run git submodule update --init vendor/pi first.`,
		);
	}

	await mkdir(localPackagesDir, { recursive: true });

	const upstreamPackageNames = await getPackageDirs(upstreamPackagesDir);
	const missingPackages = syncedPiPackages.filter((name) => !upstreamPackageNames.includes(name));
	if (missingPackages.length > 0) {
		throw new Error(`Missing upstream pi packages: ${missingPackages.join(", ")}`);
	}

	const localPackages = (await directoryExists(localPackagesDir)) ? await getPackageDirs(localPackagesDir) : [];
	const localOnlyPackages = localPackages.filter((name) => !syncedPiPackages.includes(name));

	console.log(`${dryRun ? "Dry run" : "Syncing"} pi packages from vendor/pi:`);
	for (const packageName of syncedPiPackages) {
		const source = path.join(upstreamPackagesDir, packageName);
		const target = path.join(localPackagesDir, packageName);
		console.log(`- ${packageName}`);
		if (!apply) {
			continue;
		}
		await rm(target, { recursive: true, force: true });
		await cp(source, target, {
			recursive: true,
			filter: shouldCopy,
			force: true,
			errorOnExist: false,
			preserveTimestamps: true,
		});
	}

	if (localOnlyPackages.length > 0) {
		console.log("\nPreserved local-only packages:");
		for (const packageName of localOnlyPackages) {
			console.log(`- ${packageName}`);
		}
	}

	if (dryRun) {
		console.log("\nPass --apply to update local packages.");
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
