import { readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import { findPackageDirectories } from "./package-workspaces.mjs";

export function getPublicWorkspacePackages() {
	const { workspaces } = JSON.parse(readFileSync("package.json", "utf8"));
	return findPackageDirectories()
		.filter((directory) => workspaces.some((pattern) => matchesGlob(directory, pattern)))
		.map((directory) => ({
			directory,
			...JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
		}))
		.filter((pkg) => pkg.private !== true)
		.map(({ directory, name, version }) => ({ directory, name, version }));
}
