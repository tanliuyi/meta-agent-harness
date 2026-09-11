import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_DEPENDENCIES = 2048;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i;

interface PayloadPackageManifest {
  dependencies?: Record<string, string>;
  packages?: Record<string, unknown>;
}

/** Verifies that every declared runtime dependency was bundled inside the plugin payload. */
export async function validateMarketplacePayloadDependencies(payloadRoot: string, pluginId: string): Promise<void> {
  const dependencyPaths = new Map<string, string>();
  await collectPackageDependencies(join(payloadRoot, "package.json"), dependencyPaths, false, pluginId);
  await collectPackageDependencies(
    join(payloadRoot, "node_modules", ".package-lock.json"),
    dependencyPaths,
    true,
    pluginId,
  );
  if (dependencyPaths.size > MAX_DEPENDENCIES) {
    throw new Error(`Marketplace plugin declares too many dependencies: ${pluginId}`);
  }

  const canonicalPayloadRoot = await realpath(payloadRoot);
  for (const [dependencyPath, dependencyName] of dependencyPaths) {
    const packagePath = resolve(payloadRoot, dependencyPath, "package.json");
    const withinPayload = relative(resolve(payloadRoot), packagePath);
    if (!withinPayload || withinPayload.startsWith("..") || isAbsolute(withinPayload)) {
      throw new Error(`Marketplace plugin dependency path is invalid: ${pluginId}: ${dependencyName}`);
    }
    try {
      const info = await lstat(packagePath);
      const canonicalPackagePath = await realpath(packagePath);
      const withinCanonicalPayload = relative(canonicalPayloadRoot, canonicalPackagePath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        !withinCanonicalPayload ||
        withinCanonicalPayload.startsWith("..") ||
        isAbsolute(withinCanonicalPayload)
      ) {
        throw new Error("package manifest is not a regular payload file");
      }
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        throw new Error(`Marketplace plugin dependency is missing: ${pluginId}: ${dependencyName}`);
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Marketplace plugin dependency is invalid: ${pluginId}: ${dependencyName}: ${reason}`);
    }
  }
}

async function collectPackageDependencies(
  manifestPath: string,
  dependencyPaths: Map<string, string>,
  lockfile: boolean,
  pluginId: string,
): Promise<void> {
  let source: string;
  try {
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES) {
      throw new Error("manifest is not a bounded regular file");
    }
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Marketplace plugin payload package is invalid: ${pluginId}: ${reason}`);
  }

  let manifest: PayloadPackageManifest;
  try {
    const value: unknown = JSON.parse(source);
    if (!isObject(value)) throw new Error("manifest must be an object");
    manifest = value;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Marketplace plugin payload package is invalid: ${pluginId}: ${reason}`);
  }

  if (lockfile) {
    if (!isObject(manifest.packages)) {
      throw new Error(`Marketplace plugin payload package is invalid: ${pluginId}: packages must be an object`);
    }
    for (const dependencyPath of Object.keys(manifest.packages)) {
      if (!dependencyPath.startsWith("node_modules/")) continue;
      const dependencyName = dependencyPath.slice(dependencyPath.lastIndexOf("node_modules/") + 13);
      addDependency(dependencyPaths, dependencyName, dependencyPath, pluginId);
    }
    return;
  }

  if (!isStringRecord(manifest.dependencies)) {
    throw new Error(`Marketplace plugin payload package is invalid: ${pluginId}: dependencies must be an object`);
  }
  for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
    addDependency(dependencyPaths, dependencyName, join("node_modules", ...dependencyName.split("/")), pluginId);
  }
}

function addDependency(
  dependencies: Map<string, string>,
  dependencyName: string,
  dependencyPath: string,
  pluginId: string,
): void {
  if (!PACKAGE_NAME.test(dependencyName)) {
    throw new Error(`Marketplace plugin dependency name is invalid: ${pluginId}: ${dependencyName}`);
  }
  dependencies.set(dependencyPath, dependencyName);
}

function isStringRecord(value: unknown): value is Record<string, string> | undefined {
  return value === undefined || (isObject(value) && Object.values(value).every((item) => typeof item === "string"));
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
