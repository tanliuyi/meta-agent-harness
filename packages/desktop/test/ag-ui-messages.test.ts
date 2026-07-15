import type { Message } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { convertAgUiMessages, messageRepository } from "../src/renderer/src/runtime/ag-ui-messages.ts";

describe("AG-UI bootstrap messages", () => {
  it("使用官方转换器保留历史 ID、reasoning、tool result 和线性 head", () => {
    const messages: Message[] = [
      { id: "user", role: "user", content: "question" },
      { id: "reasoning", role: "reasoning", content: "thinking" },
      {
        id: "assistant",
        role: "assistant",
        content: "answer",
        toolCalls: [
          {
            id: "tool-call",
            type: "function",
            function: { name: "read", arguments: '{"path":"README.md"}' },
          },
        ],
      },
      { id: "tool-result", role: "tool", toolCallId: "tool-call", content: "failed", error: "failed" },
    ];

    const converted = convertAgUiMessages(messages);
    const repository = messageRepository(converted);
    const assistant = converted.find((message) => message.id === "assistant");
    const tool = assistant?.content.find((part) => part.type === "tool-call");

    expect(converted.map(({ id }) => id)).toEqual(["user", "reasoning", "assistant"]);
    expect(converted[1]?.content).toEqual([{ type: "reasoning", text: "thinking" }]);
    expect(tool).toMatchObject({ toolCallId: "tool-call", result: "failed", isError: true });
    expect(repository.headId).toBe("assistant");
    expect(repository.messages.map(({ parentId }) => parentId)).toEqual([null, "user", "reasoning"]);
  });
});
