import { describe, expect, it } from "vitest";
import { getSessionCommands } from "../src/main/pi/session-commands.ts";

describe("session commands", () => {
  it("只从 Pi public resources 合并 extension、prompt 和 skill 命令", () => {
    const commands = getSessionCommands({
      extensionRunner: {
        getRegisteredCommands: () => [{ invocationName: "review", description: "审查代码" }],
      },
      promptTemplates: [{ name: "fix", description: "修复问题" }],
      resourceLoader: {
        getSkills: () => ({ skills: [{ name: "frontend", description: "前端设计" }] }),
      },
    });

    expect(commands).toEqual([
      { name: "review", description: "审查代码", source: "extension" },
      { name: "fix", description: "修复问题", source: "prompt" },
      { name: "skill:frontend", description: "前端设计", source: "skill" },
    ]);
    expect(commands.some(({ source }) => source === "builtin")).toBe(false);
  });
});
