import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PluginCatalog {
	schemaVersion: number;
	pluginId: string;
	methods: Array<{
		name: string;
		parameters: {
			properties: {
				questions?: {
					minItems?: number;
					maxItems?: number;
					items?: {
						properties?: {
							header?: { maxLength?: number };
							options?: {
								minItems?: number;
								maxItems?: number;
								items?: { properties?: { label?: { maxLength?: number } } };
							};
						};
					};
				};
			};
			required?: string[];
			additionalProperties?: boolean;
		};
		result: { required?: string[]; additionalProperties?: boolean };
		concurrency: string;
	}>;
}

interface MarketManifest {
	plugin: { id: string };
	pi: {
		skills: string[];
		runCode: { skill: string; catalog: string };
	};
	capabilities: string[];
	files: Record<string, { mode: string }>;
}

const packageRoot = new URL("./", import.meta.url);

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(new URL(path, packageRoot), "utf8")) as T;
}

describe("run_code catalog", () => {
	it("declares ask_user_question as a generation-scoped plugin method", async () => {
		const manifest = await readJson<MarketManifest>("market-manifest.json");
		const catalog = await readJson<PluginCatalog>("plugin-api.json");

		expect(manifest.plugin.id).toBe("rpiv.ask-user-question");
		expect(manifest.pi.runCode).toEqual({
			skill: "rpiv-ask-user-question",
			catalog: "plugin-api.json",
		});
		expect(manifest.pi.skills).toEqual(["skills/rpiv-ask-user-question/SKILL.md"]);
		expect(manifest.capabilities).toContain("plugin-methods.provide");
		expect(manifest.capabilities).not.toContain("tools.register");

		expect(catalog.schemaVersion).toBe(1);
		expect(catalog.pluginId).toBe(manifest.plugin.id);
		expect(catalog.methods).toHaveLength(1);
		const method = catalog.methods[0];
		expect(method?.name).toBe("ask_user_question");
		expect(method?.parameters.required).toEqual(["questions"]);
		expect(method?.parameters.additionalProperties).toBe(false);
		expect(method?.parameters.properties.questions?.minItems).toBe(1);
		expect(method?.parameters.properties.questions?.maxItems).toBe(4);
		expect(method?.parameters.properties.questions?.items?.properties?.header?.maxLength).toBe(16);
		expect(method?.parameters.properties.questions?.items?.properties?.options?.minItems).toBe(2);
		expect(method?.parameters.properties.questions?.items?.properties?.options?.maxItems).toBe(4);
		expect(
			method?.parameters.properties.questions?.items?.properties?.options?.items?.properties?.label?.maxLength,
		).toBe(60);
		expect(method?.result.required).toEqual(["text"]);
		expect(method?.result.additionalProperties).toBe(false);
		expect(method?.concurrency).toBe("serial");
	});

	it("ships every manifest-declared run_code resource", async () => {
		const manifest = await readJson<MarketManifest>("market-manifest.json");
		const paths = [
			manifest.pi.runCode.catalog,
			...manifest.pi.skills,
			"skills/rpiv-ask-user-question/references/api.md",
		];
		for (const path of paths) {
			expect(manifest.files[path]?.mode).toBe("0644");
			await expect(access(new URL(path, packageRoot))).resolves.toBeUndefined();
		}
	});
});
