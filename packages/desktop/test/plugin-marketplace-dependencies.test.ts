import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateMarketplacePayloadDependencies } from "../src/main/plugins/marketplace-plugin-dependencies.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("validateMarketplacePayloadDependencies", () => {
  it("rejects a dependency that exists only above the payload", async () => {
    const root = await createRoot();
    const payloadRoot = join(root, "payload");
    await mkdir(join(root, "node_modules", "zod"), { recursive: true });
    await writeFile(join(root, "node_modules", "zod", "package.json"), JSON.stringify({ name: "zod" }));
    await mkdir(payloadRoot, { recursive: true });
    await writeFile(join(payloadRoot, "package.json"), JSON.stringify({ dependencies: { zod: "4.3.6" } }));

    await expect(validateMarketplacePayloadDependencies(payloadRoot, "test.plugin")).rejects.toThrow(
      "Marketplace plugin dependency is missing: test.plugin: zod",
    );
  });

  it("accepts a payload-local ESM-only dependency", async () => {
    const root = await createRoot();
    const payloadRoot = join(root, "payload");
    await mkdir(join(payloadRoot, "node_modules", "acp-kernel"), { recursive: true });
    await writeFile(join(payloadRoot, "package.json"), JSON.stringify({ dependencies: { "acp-kernel": "0.0.62" } }));
    await writeFile(
      join(payloadRoot, "node_modules", "acp-kernel", "package.json"),
      JSON.stringify({ name: "acp-kernel", type: "module", exports: { import: "./index.js" } }),
    );

    await expect(validateMarketplacePayloadDependencies(payloadRoot, "test.plugin")).resolves.toBeUndefined();
  });

  it("uses the bundled npm lockfile when the payload has no package manifest", async () => {
    const root = await createRoot();
    const payloadRoot = join(root, "payload");
    await mkdir(join(payloadRoot, "node_modules"), { recursive: true });
    await writeFile(
      join(payloadRoot, "node_modules", ".package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/zod": { version: "4.3.6" } } }),
    );

    await expect(validateMarketplacePayloadDependencies(payloadRoot, "test.plugin")).rejects.toThrow(
      "Marketplace plugin dependency is missing: test.plugin: zod",
    );
  });
});

async function createRoot(): Promise<string> {
  const root = join(tmpdir(), `marketplace-plugin-dependencies-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
