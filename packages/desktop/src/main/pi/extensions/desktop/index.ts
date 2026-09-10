import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { JsonValue } from "../../../../shared/contracts.ts";
import type { PluginApiCatalogV1 } from "../../../../shared/desktop-extension-contracts.ts";
import { desktopMethods } from "../../../../shared/desktop-runtime-contracts.ts";
import { normalizePluginSchema } from "../../run-code/plugin-schema.ts";
import { BrowserClient } from "../pi-browser/lib/browser-client.ts";

export default function desktop(pi: ExtensionAPI): void {
  for (const [name, definition] of Object.entries(desktopMethods)) {
    pi.registerTool({
      name,
      label: `Desktop ${name}`,
      description: definition.description,
      parameters: definition.parameters as TSchema,
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const data = await new BrowserClient().desktopRuntime(name, params, signal);
        if (name === "screenshot") {
          const image = data as { dataUrl: string };
          return {
            content: [
              { type: "text", text: "Desktop renderer screenshot" },
              { type: "image", mimeType: "image/png", data: image.dataUrl.replace(/^data:image\/png;base64,/, "") },
            ],
            details: {},
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(data) }], details: {} };
      },
    });
  }
}

function createCatalog(): PluginApiCatalogV1 {
  const tools: ToolDefinition<TSchema, unknown, unknown>[] = [];
  desktop({
    registerTool: (tool: ToolDefinition<TSchema, unknown, unknown>) => tools.push(tool),
  } as unknown as ExtensionAPI);
  return {
    schemaVersion: 1,
    pluginId: "desktop",
    methods: tools
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: normalizePluginSchema(tool.parameters) as Record<string, JsonValue>,
        result: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        concurrency: "serial",
      })),
  };
}
export const runCodeCatalog = createCatalog();
