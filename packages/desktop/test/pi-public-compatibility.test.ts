import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  type AgentSession,
  type AgentSessionEvent,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Pi coding-agent 0.80.7 public compatibility", () => {
  let harness: Awaited<ReturnType<typeof createPublicHarness>>;

  beforeEach(async () => {
    harness = await createPublicHarness();
  });

  afterEach(async () => {
    harness.session.dispose();
    harness.faux.unregister();
    await rm(harness.tempDir, { recursive: true, force: true });
  });

  it("idle prompt 先通过 preflight，并由 public branch 持久化普通 user/assistant message", async () => {
    harness.faux.setResponses([fauxAssistantMessage("answer")]);
    let accepted: boolean | undefined;

    await harness.session.prompt("question", {
      preflightResult: (success) => {
        accepted = success;
      },
    });

    expect(accepted).toBe(true);
    expect(harness.events.filter(({ type }) => type === "entry_appended")).toEqual([]);
    const messages = harness.session.sessionManager
      .getBranch()
      .flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
    expect(messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
    expect(messages.map(messageText)).toEqual(["question", "answer"]);
    expect(harness.events.filter(({ type }) => type === "message_start").map(({ message }) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("running prompt 的 queue_update removal 先于 consumed user message_start", async () => {
    let releaseFirst: ((message: ReturnType<typeof fauxAssistantMessage>) => void) | undefined;
    const firstResponse = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
      releaseFirst = resolve;
    });
    harness.faux.setResponses([() => firstResponse, fauxAssistantMessage("after steer")]);
    const running = harness.session.prompt("first");
    await vi.waitFor(() => expect(harness.session.isStreaming).toBe(true));

    await harness.session.prompt("queued", { streamingBehavior: "steer" });
    expect(harness.session.getSteeringMessages()).toEqual(["queued"]);
    releaseFirst?.(fauxAssistantMessage("first answer"));
    await running;

    const added = harness.events.findIndex(
      (event) => event.type === "queue_update" && event.steering.includes("queued"),
    );
    const removed = harness.events.findIndex(
      (event, index) => index > added && event.type === "queue_update" && event.steering.length === 0,
    );
    const consumed = harness.events.findIndex(
      (event, index) => index > removed && event.type === "message_start" && messageText(event.message) === "queued",
    );
    expect(added).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(added);
    expect(consumed).toBeGreaterThan(removed);
  });
});

async function createPublicHarness() {
  const tempDir = join(tmpdir(), `desktop-pi-public-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const faux = registerFauxProvider({ tokensPerSecond: 100_000 });
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(faux.getModel().provider, {
    baseUrl: faux.getModel().baseUrl,
    apiKey: "faux-key",
    api: faux.api,
    models: faux.models.map((model) => ({
      id: model.id,
      name: model.name,
      api: model.api,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  });
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: tempDir,
    agentDir: tempDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: tempDir,
    agentDir: tempDir,
    authStorage,
    modelRegistry,
    model: faux.getModel(),
    noTools: "all",
    resourceLoader,
    sessionManager: SessionManager.inMemory(tempDir),
    settingsManager,
  });
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  return { tempDir, faux, session, events };
}

function messageText(message: AgentSession["messages"][number]): string {
  if (!("content" in message)) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}
