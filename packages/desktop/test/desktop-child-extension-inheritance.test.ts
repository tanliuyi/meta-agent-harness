import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BuildInProcessChildLaunchInput,
  buildInProcessChildLaunch,
} from "../src/main/pi/extensions/pi-subagents/src/runs/shared/child-launch.ts";
import { createDesktopChildSessionFactory } from "../src/main/pi/subagents/desktop-child-session-factory.ts";
import type { SubagentRuntime, SubagentRuntimeRunRequest } from "../src/main/pi/subagents/subagent-runtime.ts";

const acp = {
  path: join(process.cwd(), "approved-acp.mjs"),
  tools: ["compress", "decompress", "search_context", "acp_status"],
};
async function capture(overrides: Partial<BuildInProcessChildLaunchInput> = {}, registered = [acp, acp]) {
  let request: SubagentRuntimeRunRequest | undefined;
  const runtime: SubagentRuntime = {
    getChildExtensions: () => registered,
    async *run(input) {
      request = input;
      yield { type: "completed", runId: input.runId };
    },
    resume(input) {
      return this.run(input);
    },
    async cancel() {},
    async steer() {},
    async dispose() {},
  };
  const launch = buildInProcessChildLaunch({
    cwd: process.cwd(),
    runId: "acp-test",
    childIndex: 0,
    childAgentName: "worker",
    sessionEnabled: false,
    inheritProjectContext: false,
    inheritGlobalContext: false,
    inheritSkills: false,
    host: "parent",
    ...overrides,
  });
  const factory = createDesktopChildSessionFactory(runtime);
  const child = await factory.create(launch.session);
  await child.prompt("task");
  await factory.dispose();
  if (!request) throw new Error("Missing request");
  return request;
}

describe("Desktop approved child extension inheritance", () => {
  it.each(["parent", "runner"] as const)(
    "inherits registered ACP in default %s launches without ambient discovery",
    async (host) => {
      const request = await capture({ host });
      expect(request.childExtensions).toEqual([acp]);
    },
  );
  it.each(["parent", "runner"] as const)("does not require ACP when no plugin is registered (%s)", async (host) => {
    const request = await capture({ host, tools: ["read"] }, []);
    expect(request.childExtensions).toEqual([]);
    expect(request.tools).toEqual(["read"]);
  });
  it("adds every ACP tool to an explicit read-only list without duplicates", async () => {
    const request = await capture({ tools: ["read", "compress"] });
    expect(request.childExtensions).toEqual([acp]);
    for (const tool of acp.tools) expect(request.tools?.filter((name) => name === tool)).toHaveLength(1);
    expect(request.tools).toContain("read");
  });
  it("retains exclusions with explicit tools and suppresses the entire extension", async () => {
    const request = await capture({ tools: ["read", ...acp.tools], excludeTools: ["compress"] });
    expect(request.excludeTools).toContain("compress");
    expect(request.childExtensions).toEqual([]);
    expect(request.tools).not.toContain("decompress");
  });
  it.each([
    { denyExtensions: true },
    { denyExtensions: false, allowedTools: ["read", "compress"] },
    { denyExtensions: false, allowedTools: [] },
  ])("does not partially load ACP across capability ceilings: %j", async (ceiling) => {
    const request = await capture({ capabilityCeiling: { version: 1, sources: ["test"], ...ceiling } });
    expect(request.childExtensions).toEqual([]);
  });
  it("permits ACP when the ceiling authorizes every declared tool", async () => {
    const request = await capture({
      tools: ["read"],
      capabilityCeiling: { version: 1, sources: ["test"], denyExtensions: false, allowedTools: ["read", ...acp.tools] },
    });
    expect(request.childExtensions).toEqual([acp]);
  });
  it("honors extensions: [] as an explicit inheritance opt-out", async () => {
    expect((await capture({ extensions: [] })).childExtensions).toEqual([]);
  });
  it("loads explicitly listed approved paths once even with inheritance disabled", async () => {
    expect((await capture({ extensions: [acp.path, acp.path] })).childExtensions).toEqual([acp]);
  });
  it("does not approve arbitrary configured extension paths", async () => {
    expect((await capture({ extensions: [join(process.cwd(), "unapproved.mjs")] })).childExtensions).toEqual([]);
  });
});
