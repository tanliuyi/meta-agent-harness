import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { entriesToCoreMessages } from "../src/messages.ts";
import { collectImageTokens, estimateTokens, modelSupportsImages } from "../src/tokens.ts";
import { normalizeRanges, tailRepair } from "../src/compress-tool.ts";
import { applyOutputHeadroom, inspectOverflowMessage, reserveOutputHeadroom } from "../src/overflow-selfheal.ts";
import { collapseDegenerateRuns, findDegenerateRuns } from "../src/degeneration.ts";
import { dropCompressReasoning } from "../src/reasoning-drop.ts";
import { RepetitionTracker } from "../src/tool-guardrails.ts";

function messageEntry(id: string, message: object): SessionMessageEntry {
  return { type: "message", id, parentId: null, timestamp: "", message: message as SessionMessageEntry["message"] };
}

test("message projection counts thinking and image payloads", () => {
  const entries: SessionEntry[] = [
    messageEntry("assistant-1", {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "reasoning that is replayed" },
        { type: "text", text: "answer" },
      ],
    }),
    messageEntry("user-1", {
      role: "user",
      content: [{ type: "image", source: { type: "base64", mediaType: "image/png", data: "AAAA" } }, { type: "text", text: "inspect this" }],
    }),
  ];
  const core = entriesToCoreMessages(entries);
  assert.ok((core[0]?.thinkingTokens ?? 0) > 0);
  const images = collectImageTokens(entries, modelSupportsImages({ input: ["text", "image"] }));
  assert.equal(images.get("user-1"), 1600);
  assert.ok(estimateTokens(core, undefined, images) > estimateTokens(core));
});

test("compress input accepts stringified ranges and repairs a missing tail brace", () => {
  const range = { startId: "m00001", endId: "m00002", summary: "summary" };
  const parsed = normalizeRanges({ content: JSON.stringify([range]) });
  assert.deepEqual(parsed, [{ ...range, topic: undefined }]);
  assert.equal(tailRepair('[{"startId":"m00001","endId":"m00001","summary":"summary"]'), '[{"startId":"m00001","endId":"m00001","summary":"summary"}]');
});

test("output headroom and overflow detection use the provider window", () => {
  assert.equal(reserveOutputHeadroom(100_000, 90_000, 0.25), 75_000);
  assert.equal(applyOutputHeadroom({ modelContextLimit: 100_000 }, { api: "anthropic-messages", maxTokens: 90_000 }, 0.25).modelContextLimit, 100_000);
  const overflow = inspectOverflowMessage("prompt is too long: 130000 tokens > 128000 maximum");
  assert.equal(overflow.isOverflow, true);
  assert.equal(overflow.window, 128_000);
});

test("reasoning drop removes only closed oversized compress turns", () => {
  const messages = [
    {
      role: "assistant",
      content: [{ type: "thinking", thinking: "x".repeat(20) }, { type: "toolCall", id: "call-1", name: "compress", arguments: {} }],
    },
    { role: "toolResult", toolCallId: "call-1", toolName: "compress", content: [{ type: "text", text: "done" }] },
    { role: "user", content: "next" },
  ] as unknown as SessionMessageEntry["message"][];
  const dropped = dropCompressReasoning(messages, { threshold: 5 });
  assert.equal((dropped[0] as { content: unknown[] }).content.some((part) => (part as { type?: string }).type === "thinking"), false);
});

test("degeneration collapse is bounded and idempotent", () => {
  const input = `ok ${"【".repeat(200)} done`;
  const runs = findDegenerateRuns(input, 8);
  assert.equal(runs.length, 1);
  const collapsed = collapseDegenerateRuns(input, 8);
  assert.ok(collapsed.length < input.length);
  assert.equal(collapseDegenerateRuns(collapsed, 8), collapsed);
});

test("repetition tracker escalates identical calls and resets on change", () => {
  const tracker = new RepetitionTracker({ warn: 2, abort: 3 });
  assert.equal(tracker.note("bash", { command: "pwd" }).action, "none");
  assert.equal(tracker.note("bash", { command: "pwd" }).action, "warn");
  assert.equal(tracker.note("bash", { command: "pwd" }).action, "abort");
  assert.equal(tracker.note("bash", { command: "ls" }).count, 1);
});
