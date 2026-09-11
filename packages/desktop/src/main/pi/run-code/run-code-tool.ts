import type { AgentToolResult, ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PluginMethodDispatcher, type RunCodeExecution } from "./plugin-method-dispatcher.ts";
import type { PluginMethodRegistry } from "./plugin-method-registry.ts";
import { buildGeneratedApiInstructions, RUN_CODE_SYSTEM_INSTRUCTIONS } from "./plugin-sdk.ts";
import { normalizePluginError, type RunCodeError } from "./run-code-errors.ts";
import { executePluginProgram, RunCodeRunManager } from "./run-code-runtime.ts";

export const RunCodeParameters = Type.Object(
  {
    code: Type.String({
      description:
        "Body of an async TypeScript function. Top-level await and return are available. Use erasable TypeScript syntax, call the injected plugin API, and return lossless JSON or undefined.",
      maxLength: 262144,
    }),
    description: Type.String({
      description: "Short active-voice UI label, typically 5-10 words.",
      minLength: 1,
      maxLength: 160,
    }),
  },
  { additionalProperties: false },
);

interface RunCodeToolDetails extends RunCodeExecution {
  kind: "run-code-details-v1";
  description: string;
  runId: string;
  generation: string;
  error?: {
    code: string;
    message: string;
    pluginId?: string;
    method?: string;
  };
}

type PersistedRunCodeAttachment =
  | { type: "image"; contentIndex: number; name?: string }
  | Exclude<NonNullable<RunCodeExecution["attachments"]>[number], { type: "image" }>;

interface RunCodePersistedDetails extends Omit<RunCodeToolDetails, "attachments" | "toolContext"> {
  attachments: PersistedRunCodeAttachment[];
}

/** 保存当前 worker generation 的 run_code 方法表和运行中的 worker。 */
export class RunCodeRegistryHolder {
  readonly generation: string;
  private registry?: PluginMethodRegistry;
  private dispatcher?: PluginMethodDispatcher;
  private apiInstructions?: string;
  private stale = false;
  private readonly manager = new RunCodeRunManager();

  constructor(generation: string) {
    this.generation = generation;
  }

  bind(registry: PluginMethodRegistry, cwd: string): void {
    if (this.stale) throw new Error("PLUGIN_GENERATION_STALE");
    this.registry = registry;
    this.dispatcher = new PluginMethodDispatcher(registry, cwd);
    this.apiInstructions = buildGeneratedApiInstructions(registry);
  }

  async dispose(): Promise<void> {
    this.stale = true;
    this.registry = undefined;
    this.dispatcher = undefined;
    this.apiInstructions = undefined;
    await this.manager.dispose();
  }

  snapshot(pluginId?: string) {
    if (this.stale) throw new Error("PLUGIN_GENERATION_STALE");
    return [...(this.registry ?? [])]
      .filter(([id]) => pluginId === undefined || id === pluginId)
      .map(([id, methods]) => ({
        pluginId: id,
        methods: [...methods.values()].map((method) => ({
          name: method.name,
          description: method.description,
          parameters: method.parameters,
          result: method.result,
          concurrency: method.concurrency,
          entryId: method.entryId,
          primarySkill: method.primarySkill,
        })),
      }));
  }

  getDispatcher(): PluginMethodDispatcher {
    if (!this.registry || !this.dispatcher || this.stale) throw new Error("PLUGIN_GENERATION_STALE");
    return this.dispatcher;
  }

  getRunManager(): RunCodeRunManager {
    if (this.stale) throw new Error("PLUGIN_GENERATION_STALE");
    return this.manager;
  }

  generatedApiInstructions(): string | undefined {
    if (this.stale) return undefined;
    return this.apiInstructions;
  }
}

/** 注册唯一的 run_code 外层工具；插件方法仍由 direct/native 工具独立注册。 */
export function createRunCodeExtension(holder: RunCodeRegistryHolder, cwd: string): InlineExtension {
  return {
    name: "<inline:desktop-run-code>",
    factory: async (pi) => {
      const pendingFailures = new Map<string, AgentToolResult<RunCodePersistedDetails>>();
      pi.registerTool({
        name: "run_code",
        label: "Run code",
        description:
          'Execute an async TypeScript function body over enabled Desktop plugin APIs. Call methods as `await plugin["canonical-plugin-id"].method(args)`. Use run_code for every Desktop plugin method call and for workflows requiring branching, loops, batching, or intermediate result reduction. Native Pi tools remain directly callable and are not members of `plugin`. Only the explicit return value becomes model-visible text; image attachments are forwarded.',
        promptSnippet:
          'run_code({ code, description }): execute an async TypeScript body with `plugin["plugin.id"].method(args)` and return its explicit JSON result.',
        parameters: RunCodeParameters,
        executionMode: "parallel",
        async execute(toolCallId, params, signal, onUpdate, _ctx: ExtensionContext): Promise<AgentToolResult<unknown>> {
          pendingFailures.delete(toolCallId);
          const details: RunCodeToolDetails = {
            kind: "run-code-details-v1",
            description: params.description,
            runId: toolCallId,
            generation: holder.generation,
            calls: [],
            logs: [],
            attachments: [],
            active: true,
          };
          Object.defineProperty(details, "toolContext", { value: _ctx });
          let updateTimer: ReturnType<typeof setTimeout> | undefined;
          let acceptingUpdates = true;
          const publishUpdate = () => {
            if (!acceptingUpdates || details.active === false || !onUpdate || updateTimer) return;
            updateTimer = setTimeout(() => {
              updateTimer = undefined;
              if (acceptingUpdates && details.active !== false) onUpdate({ content: [], details });
            }, 100);
          };
          try {
            const value = await executePluginProgram(
              params.code,
              holder.getDispatcher(),
              toolCallId,
              signal,
              cwd,
              undefined,
              details,
              holder.getRunManager(),
              publishUpdate,
            );
            acceptingUpdates = false;
            if (updateTimer) clearTimeout(updateTimer);
            const content: AgentToolResult<unknown>["content"] = [
              {
                type: "text",
                text:
                  value === undefined
                    ? "(run_code completed with no output)"
                    : typeof value === "string"
                      ? value
                      : JSON.stringify(value, null, 2),
              },
            ];
            for (const attachment of details.attachments ?? []) {
              if (attachment.type === "image") {
                content.push({ type: "image", data: attachment.data, mimeType: attachment.mimeType });
              }
            }
            const result: AgentToolResult<RunCodePersistedDetails> = {
              content,
              details: snapshotRunCodeDetails(details, content, true),
            };
            onUpdate?.(result);
            return result;
          } catch (error) {
            acceptingUpdates = false;
            if (updateTimer) clearTimeout(updateTimer);
            const normalized = normalizePluginError(error, "PLUGIN_METHOD_EXECUTION_FAILED");
            const failureDetails = snapshotRunCodeDetails(details, [], false);
            failureDetails.error = {
              code: normalized.code,
              message: normalized.message,
              ...(normalized.pluginId ? { pluginId: normalized.pluginId } : {}),
              ...(normalized.method ? { method: normalized.method } : {}),
            };
            const result: AgentToolResult<RunCodePersistedDetails> = {
              content: [{ type: "text", text: formatRunCodeError(normalized) }],
              details: failureDetails,
            };
            pendingFailures.set(toolCallId, result);
            onUpdate?.(result);
            throw new Error(formatRunCodeError(normalized));
          } finally {
            acceptingUpdates = false;
            if (updateTimer) clearTimeout(updateTimer);
          }
        },
      });
      pi.on("tool_result", (event) => {
        if (event.toolName !== "run_code") return;
        const result = pendingFailures.get(event.toolCallId);
        if (!result) return;
        pendingFailures.delete(event.toolCallId);
        return { ...result, isError: true };
      });
      pi.on("session_shutdown", () => {
        pendingFailures.clear();
      });
      pi.on("before_agent_start", (event) => {
        const generated = holder.generatedApiInstructions();
        return {
          systemPrompt: [event.systemPrompt, RUN_CODE_SYSTEM_INSTRUCTIONS, generated].filter(Boolean).join("\n\n"),
        };
      });
    },
  };
}

function snapshotRunCodeDetails(
  details: RunCodeToolDetails,
  content: AgentToolResult<unknown>["content"],
  includeAttachments: boolean,
): RunCodePersistedDetails {
  return {
    ...details,
    calls: details.calls.map((call) => ({ ...call })),
    logs: details.logs.map((log) => ({ ...log })),
    attachments: includeAttachments
      ? (details.attachments ?? []).map((attachment) =>
          attachment.type === "image"
            ? {
                type: "image" as const,
                contentIndex: content.findIndex(
                  (part) =>
                    part.type === "image" && part.data === attachment.data && part.mimeType === attachment.mimeType,
                ),
                ...(attachment.name ? { name: attachment.name } : {}),
              }
            : { ...attachment },
        )
      : [],
    active: false,
  };
}

function formatRunCodeError(error: RunCodeError): string {
  const location = [error.pluginId, error.method].filter(Boolean).join(".");
  return [
    "run_code failed.",
    `code: ${error.code}`,
    ...(location ? [`method: ${location}`] : []),
    `message: ${error.message}`,
    "Use this error as tool context and correct the next run_code call.",
  ].join("\n");
}
