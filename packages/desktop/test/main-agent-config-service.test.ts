import { lstat, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MainAgentConfigService, MISSING_MAIN_AGENT_REVISION } from "../src/main/settings/main-agent-config-service.ts";
import { BUILTIN_MAIN_AGENT_ID } from "../src/shared/main-agent-contracts.ts";

describe("MainAgentConfigService", () => {
  let directory: string;
  let service: MainAgentConfigService;

  beforeEach(() => {
    directory = join(tmpdir(), `desktop-main-agents-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    service = new MainAgentConfigService(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("provides an editable built-in independently from the new-session default", async () => {
    const initial = await service.getSnapshot();
    expect(initial).toMatchObject({
      revision: MISSING_MAIN_AGENT_REVISION,
      defaultAgentId: BUILTIN_MAIN_AGENT_ID,
      profiles: [
        {
          id: BUILTIN_MAIN_AGENT_ID,
          name: "默认智能体",
          description: "保持 Desktop 的默认提示词、工具和内置功能行为",
          builtin: true,
          revision: 1,
        },
      ],
    });
    const catalog = service.getCatalog();
    expect(catalog.tools.find(({ id }) => id === "read")).toMatchObject({
      id: "read",
      source: "builtin",
      available: true,
    });
    expect(catalog.builtinPlugins.find(({ id }) => id === "pi-hermes-memory")).toMatchObject({
      name: "记忆",
      available: true,
    });
    expect(catalog.builtinPlugins.find(({ id }) => id === "pi-subagents")).toMatchObject({
      name: "子智能体",
      available: true,
    });
    await expect(lstat(service.path)).rejects.toMatchObject({ code: "ENOENT" });

    const created = await service.mutate({
      action: "create",
      expectedRevision: initial.revision,
      profile: {
        name: "Reader",
        description: "Read only",
        configuration: {
          prompt: {
            mode: "replace",
            text: "Read carefully",
            includeGlobalRules: false,
            includeProjectRules: true,
            includeSkills: false,
          },
          tools: ["read"],
          builtinPluginIds: [],
        },
      },
    });
    expect(created.status).toBe("saved");
    if (created.status !== "saved") throw new Error("expected save");
    const custom = created.snapshot.profiles.find((profile) => !profile.builtin)!;
    const selected = await service.mutate({
      action: "set-default",
      expectedRevision: created.snapshot.revision,
      id: custom.id,
    });
    expect(selected).toMatchObject({ status: "saved", snapshot: { defaultAgentId: custom.id } });
  });

  it("uses CAS, protects the built-in, resets it, and falls back after deleting the chosen default", async () => {
    const initial = await service.getSnapshot();
    const created = await service.mutate({
      action: "create",
      expectedRevision: initial.revision,
      profile: {
        name: "Empty",
        description: "",
        configuration: {
          prompt: {
            mode: "default",
            text: "",
            includeGlobalRules: true,
            includeProjectRules: true,
            includeSkills: true,
          },
          tools: [],
          builtinPluginIds: [],
        },
      },
    });
    if (created.status !== "saved") throw new Error("expected save");
    await expect(
      service.mutate({ action: "delete", expectedRevision: created.snapshot.revision, id: BUILTIN_MAIN_AGENT_ID }),
    ).rejects.toThrow("cannot be deleted");
    const stale = await service.mutate({
      action: "set-default",
      expectedRevision: initial.revision,
      id: BUILTIN_MAIN_AGENT_ID,
    });
    expect(stale).toMatchObject({ status: "conflict", current: { revision: created.snapshot.revision } });

    const custom = created.snapshot.profiles.find((profile) => !profile.builtin)!;
    const selected = await service.mutate({
      action: "set-default",
      expectedRevision: created.snapshot.revision,
      id: custom.id,
    });
    if (selected.status !== "saved") throw new Error("expected save");
    const removed = await service.mutate({
      action: "delete",
      expectedRevision: selected.snapshot.revision,
      id: custom.id,
    });
    expect(removed).toMatchObject({ status: "saved", snapshot: { defaultAgentId: BUILTIN_MAIN_AGENT_ID } });
    if (removed.status !== "saved") throw new Error("expected save");
    const reset = await service.mutate({ action: "reset-builtin", expectedRevision: removed.snapshot.revision });
    expect(reset).toMatchObject({
      status: "saved",
      snapshot: {
        profiles: [{ id: BUILTIN_MAIN_AGENT_ID, revision: 2, configuration: { tools: null, builtinPluginIds: null } }],
      },
    });
    expect(JSON.parse(await readFile(service.path, "utf8"))).toMatchObject({
      version: 1,
      defaultAgentId: BUILTIN_MAIN_AGENT_ID,
    });
  });

  it("rejects blank replacement prompts", async () => {
    const initial = await service.getSnapshot();
    await expect(
      service.mutate({
        action: "create",
        expectedRevision: initial.revision,
        profile: {
          name: "Invalid",
          description: "",
          configuration: {
            prompt: {
              mode: "replace",
              text: "  ",
              includeGlobalRules: false,
              includeProjectRules: false,
              includeSkills: false,
            },
            tools: null,
            builtinPluginIds: null,
          },
        },
      }),
    ).rejects.toThrow("must not be blank");
  });
});
