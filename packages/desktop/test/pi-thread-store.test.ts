import { describe, expect, it } from "vitest";
import { PiMessageRepositoryConverter } from "../src/renderer/src/runtime/pi-message-repository.ts";
import { PiThreadStore, PiThreadStoreError } from "../src/renderer/src/runtime/pi-thread-store.ts";
import {
  type PiAssistantMessage,
  type PiThreadEventBatch,
  type PiThreadSnapshot,
  type PiUserMessage,
  PROTOCOL_VERSION,
} from "../src/shared/contracts.ts";

describe("PiThreadStore", () => {
  it("delta 只替换目标 node/part，并保持其他 identity", () => {
    const user = userNode("u", null);
    const assistant = assistantNode("a", "u");
    const store = new PiThreadStore(snapshot([user, assistant], "a"));

    store.apply(batch(1, { type: "text-delta", messageId: "a", partId: "a:text:0", delta: "!" }));

    const nodes = store.getSnapshot().nodes;
    expect(nodes[0]).toBe(user);
    expect(nodes[1]).not.toBe(assistant);
    expect(nodes[1]).toMatchObject({ content: [{ type: "text", text: "hello!" }] });
  });

  it("rekey 原子更新 node、children parent 与 head", () => {
    const live = userNode("live:u", null);
    const assistant = assistantNode("live:a", "live:u");
    const store = new PiThreadStore(snapshot([live, assistant], "live:a"));
    const canonical = { ...assistant, id: "a", sourceEntryId: "a" };

    store.apply(batch(1, { type: "node-rekeyed", previousId: "live:a", node: canonical }));

    expect(store.getSnapshot()).toMatchObject({ headId: "a", nodes: [{ id: "live:u" }, { id: "a" }] });
  });

  it("gap 与 unknown reference fail fast", () => {
    const store = new PiThreadStore(snapshot([], null));
    expect(() => store.apply(batch(2, { type: "queue-replaced", items: [] }))).toThrow(PiThreadStoreError);
    expect(() => store.apply(batch(1, { type: "text-delta", messageId: "missing", partId: "x", delta: "x" }))).toThrow(
      "assistant node 不存在",
    );
  });

  it("丢弃部分重复 envelope，并继续应用连续的新 sequence", () => {
    const store = new PiThreadStore(snapshot([], null));
    const first = batch(1, { type: "queue-replaced", items: [] });
    store.apply(first);
    store.apply({
      ...first,
      fromSequence: 1,
      toSequence: 2,
      events: [
        first.events[0]!,
        {
          protocolVersion: PROTOCOL_VERSION,
          projectId: "project",
          threadId: "thread",
          sequence: 2,
          event: { type: "phase-changed", phase: "running" },
        },
      ],
    });

    expect(store.getSnapshot()).toMatchObject({ cursor: 2, phase: "running" });
  });

  it("逐 envelope 校验协议/session，并拒绝跨 session branch snapshot", () => {
    const store = new PiThreadStore(snapshot([], null));
    const wrongEnvelope = batch(1, { type: "queue-replaced", items: [] });
    expect(() =>
      store.apply({ ...wrongEnvelope, events: [{ ...wrongEnvelope.events[0]!, threadId: "other" }] }),
    ).toThrow("envelope session 不匹配");

    const branchSnapshot = { ...snapshot([], null, 1), threadId: "other" };
    expect(() => store.apply(batch(1, { type: "branch-replaced", snapshot: branchSnapshot }))).toThrow(
      "branch snapshot session 不匹配",
    );
  });
});

describe("PiMessageRepositoryConverter", () => {
  it("保留 parent/head，图片只生成 complete attachment", () => {
    const user = userNode("u", null, true);
    const assistant = assistantNode("a", "u");
    const converter = new PiMessageRepositoryConverter();
    const repository = converter.build(snapshot([user, assistant], "a"));

    expect(repository.headId).toBe("a");
    expect(repository.messages.map(({ parentId }) => parentId)).toEqual([null, "u"]);
    const converted = repository.messages[0]?.message;
    expect(converted?.role).toBe("user");
    if (converted?.role !== "user") throw new Error("user message missing");
    expect(converted.content).toEqual([{ type: "text", text: "question" }]);
    expect(converted.attachments).toEqual([
      expect.objectContaining({
        id: "u:image:1",
        status: { type: "complete" },
        content: [{ type: "image", image: "data:image/png;base64,aW1hZ2U=", filename: "image-2.png" }],
      }),
    ]);
  });

  it("将同一轮连续 assistant 节点合并，使两个 text 之间的 reasoning/tool 保持相邻", () => {
    const user = userNode("u", null);
    const first = {
      ...assistantNode("a-1", "u"),
      content: [
        { id: "a-1:text:0", type: "text", text: "before" },
        { id: "a-1:reasoning:1", type: "reasoning", text: "first reasoning" },
        toolPart("a-1:tool:2", "read-1", "read"),
      ],
    } satisfies PiAssistantMessage;
    const second = {
      ...assistantNode("a-2", "a-1"),
      content: [
        { id: "a-2:reasoning:0", type: "reasoning", text: "second reasoning" },
        toolPart("a-2:tool:1", "bash-1", "bash"),
      ],
    } satisfies PiAssistantMessage;
    const third = {
      ...assistantNode("a-3", "a-2"),
      content: [{ id: "a-3:text:0", type: "text", text: "after" }],
    } satisfies PiAssistantMessage;
    const nextUser = userNode("u-2", "a-3");
    const converter = new PiMessageRepositoryConverter();

    const repository = converter.build(snapshot([user, first, second, third, nextUser], "u-2"));

    expect(repository.messages.map(({ message, parentId }) => [message.id, parentId])).toEqual([
      ["u", null],
      ["a-1", "u"],
      ["u-2", "a-1"],
    ]);
    const merged = repository.messages[1]?.message;
    expect(merged?.role).toBe("assistant");
    if (merged?.role !== "assistant") throw new Error("assistant message missing");
    expect(merged.content.map((part) => part.type)).toEqual([
      "text",
      "reasoning",
      "tool-call",
      "reasoning",
      "tool-call",
      "text",
    ]);
  });

  it("连续 assistant group 未变化时复用 ThreadMessage，成员变化时重建", () => {
    const user = userNode("u", null);
    const firstAssistant = assistantNode("a-1", "u");
    const secondAssistant = assistantNode("a-2", "a-1");
    const converter = new PiMessageRepositoryConverter();
    const first = converter.build(snapshot([user, firstAssistant, secondAssistant], "a-2"));
    const unchanged = converter.build(snapshot([user, firstAssistant, secondAssistant], "a-2", 1));
    const updatedAssistant = {
      ...secondAssistant,
      content: [{ ...secondAssistant.content[0]!, text: "updated" }],
    };
    const updated = converter.build(snapshot([user, firstAssistant, updatedAssistant], "a-2", 2));

    expect(first.headId).toBe("a-1");
    expect(unchanged.messages[1]?.message).toBe(first.messages[1]?.message);
    expect(updated.messages[1]?.message).not.toBe(first.messages[1]?.message);
  });

  it("snapshot wrapper 更新时复用未变化 ThreadMessage", () => {
    const user = userNode("u", null);
    const assistant = assistantNode("a", "u");
    const converter = new PiMessageRepositoryConverter();
    const first = converter.build(snapshot([user, assistant], "a"));
    const updated = { ...assistant, content: [{ ...assistant.content[0]!, text: "updated" }] };
    const second = converter.build(snapshot([user, updated], "a", 1));

    expect(second).not.toBe(first);
    expect(second.messages[0]?.message).toBe(first.messages[0]?.message);
    expect(second.messages[1]?.message).not.toBe(first.messages[1]?.message);
  });

  it("1,000 nodes + 1,000 deltas 不重复转换未变化历史 message", () => {
    const users = Array.from({ length: 999 }, (_, index) =>
      userNode(`u-${index}`, index === 0 ? null : `u-${index - 1}`),
    );
    const assistant = assistantNode("a", "u-998");
    const store = new PiThreadStore(snapshot([...users, assistant], "a"));
    const converter = new PiMessageRepositoryConverter();
    const first = converter.build(store.getSnapshot());
    let latest = first;

    for (let sequence = 1; sequence <= 1_000; sequence += 1) {
      store.apply(batch(sequence, { type: "text-delta", messageId: "a", partId: "a:text:0", delta: "x" }));
      latest = converter.build(store.getSnapshot());
    }

    expect(latest.messages[0]?.message).toBe(first.messages[0]?.message);
    expect(latest.messages[998]?.message).toBe(first.messages[998]?.message);
    const converted = latest.messages[999]?.message;
    expect(converted?.role).toBe("assistant");
    if (converted?.role !== "assistant") throw new Error("assistant message missing");
    expect(converted.content[0]).toMatchObject({ text: `hello${"x".repeat(1_000)}` });
  });
});

function snapshot(nodes: PiThreadSnapshot["nodes"], headId: string | null, cursor = 0): PiThreadSnapshot {
  return {
    protocolVersion: PROTOCOL_VERSION,
    projectId: "project",
    threadId: "thread",
    cursor,
    headId,
    nodes,
    queue: [],
    phase: "idle",
  };
}

function batch(sequence: number, event: PiThreadEventBatch["events"][number]["event"]): PiThreadEventBatch {
  return {
    protocolVersion: PROTOCOL_VERSION,
    projectId: "project",
    threadId: "thread",
    fromSequence: sequence,
    toSequence: sequence,
    events: [{ protocolVersion: PROTOCOL_VERSION, projectId: "project", threadId: "thread", sequence, event }],
  };
}

function userNode(id: string, parentId: string | null, image = false): PiUserMessage {
  return {
    id,
    parentId,
    createdAt: 1,
    kind: "user",
    content: [
      { type: "text", text: "question" },
      ...(image ? ([{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }] as const) : []),
    ],
    delivery: { state: "persisted" },
  };
}

function toolPart(id: string, toolCallId: string, toolName: string): PiAssistantMessage["content"][number] {
  return {
    id,
    type: "tool-call",
    toolCallId,
    toolName,
    args: {},
    argsText: "{}",
    execution: "complete",
  };
}

function assistantNode(id: string, parentId: string | null): PiAssistantMessage {
  return {
    id,
    parentId,
    createdAt: 2,
    kind: "assistant",
    content: [{ id: `${id}:text:0`, type: "text", text: "hello" }],
    status: { type: "complete", reason: "stop" },
    provenance: { api: "test", provider: "test", model: "faux" },
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
