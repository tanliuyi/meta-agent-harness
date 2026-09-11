import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import {
  createRunCodeExtension,
  RunCodeParameters,
  RunCodeRegistryHolder,
} from "../src/main/pi/run-code/run-code-tool.ts";

type EventHandler = (event: unknown) => unknown;

describe("run_code tool", () => {
  test("exposes one model contract and preserves failed results through tool_result", async () => {
    const holder = new RunCodeRegistryHolder("tool-contract");
    holder.bind(new Map(), process.cwd());
    const extension = createRunCodeExtension(holder, process.cwd());
    const handlers = new Map<string, EventHandler>();
    let tool: ToolDefinition<typeof RunCodeParameters, unknown> | undefined;

    await extension.factory({
      registerTool(definition: ToolDefinition) {
        tool = definition as ToolDefinition<typeof RunCodeParameters, unknown>;
      },
      on(event: string, handler: unknown) {
        handlers.set(event, handler as EventHandler);
      },
    } as unknown as ExtensionAPI);

    expect(tool).toBeDefined();
    expect(tool?.description).toContain("Use run_code for every Desktop plugin method call");
    expect(tool?.promptGuidelines).toBeUndefined();
    expect(RunCodeParameters.properties.code.description).toContain("erasable TypeScript syntax");
    expect(RunCodeParameters.properties.description.description).toContain("5-10 words");

    const beforeAgentStart = handlers.get("before_agent_start");
    expect(beforeAgentStart).toBeDefined();
    const promptResult = (await beforeAgentStart?.({ systemPrompt: "custom base prompt" })) as {
      systemPrompt?: string;
    };
    expect(promptResult.systemPrompt).toContain("custom base prompt");
    expect(promptResult.systemPrompt).toContain("<desktop_run_code>");
    expect(promptResult.systemPrompt).toContain("Only the explicit return value enters model-visible text");

    const updates: AgentToolResult<unknown>[] = [];
    let thrown: unknown;
    try {
      await tool?.execute(
        "failed-run",
        {
          code: 'return await plugin["missing.plugin"].run({});',
          description: "Call missing plugin method",
        },
        undefined,
        (update) => updates.push(update),
        {} as ExtensionContext,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("code: PLUGIN_NOT_FOUND");
    expect(updates.at(-1)?.details).toMatchObject({
      active: false,
      attachments: [],
      error: {
        code: "PLUGIN_NOT_FOUND",
        pluginId: "missing.plugin",
        method: "run",
      },
    });

    const toolResult = handlers.get("tool_result");
    expect(toolResult).toBeDefined();
    const failureEvent = {
      type: "tool_result",
      toolName: "run_code",
      toolCallId: "failed-run",
      input: {},
      content: [{ type: "text", text: (thrown as Error).message }],
      details: undefined,
      isError: true,
    };
    const patched = (await toolResult?.(failureEvent)) as AgentToolResult<unknown> & { isError?: boolean };
    expect(patched.isError).toBe(true);
    expect(patched.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("run_code failed") });
    expect(patched.details).toMatchObject({
      active: false,
      attachments: [],
      error: { code: "PLUGIN_NOT_FOUND" },
    });
    expect(await toolResult?.(failureEvent)).toBeUndefined();

    await holder.dispose();
  });
});
