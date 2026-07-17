import {
  type AssistantRuntime,
  type ExportedMessageRepository,
  type ExternalThreadQueueAdapter,
  type ThreadMessage,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

describe("assistant-ui 0.14.26 External Store characterization", () => {
  it("配置 queue 后 idle append 仍调用 enqueue，不调用 onNew", async () => {
    const enqueue = vi.fn();
    const onNew = vi.fn();
    const runtime = renderRuntime({ repository: emptyRepository(), isRunning: false, enqueue, onNew });

    await runtime.thread.append({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      attachments: [],
      createdAt: new Date(0),
      metadata: { custom: {} },
      parentId: null,
      sourceId: null,
      runConfig: undefined,
    });

    expect(enqueue).toHaveBeenCalledOnce();
    expect(onNew).not.toHaveBeenCalled();
  });

  it("running repository 尾部为 user 时只在 runtime 内生成 optimistic assistant", () => {
    const user = userMessage();
    const repository: ExportedMessageRepository = {
      headId: user.id,
      messages: [{ message: user, parentId: null }],
    };
    const runtime = renderRuntime({ repository, isRunning: true, enqueue: vi.fn(), onNew: vi.fn() });

    const messages = runtime.thread.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(user);
    expect(messages[1]).toMatchObject({ role: "assistant", metadata: { isOptimistic: true } });
    expect(repository.messages).toHaveLength(1);
  });
});

function renderRuntime(options: {
  repository: ExportedMessageRepository;
  isRunning: boolean;
  enqueue: ExternalThreadQueueAdapter["enqueue"];
  onNew: () => Promise<void> | void;
}): AssistantRuntime {
  let runtime: AssistantRuntime | undefined;
  const queue: ExternalThreadQueueAdapter = {
    items: [],
    enqueue: options.enqueue,
    steer: () => {
      throw new Error("unexpected steer");
    },
    remove: () => {
      throw new Error("unexpected remove");
    },
    clear: () => {},
  };
  function RuntimeProbe() {
    runtime = useExternalStoreRuntime({
      messageRepository: options.repository,
      isRunning: options.isRunning,
      onNew: options.onNew,
      queue,
    });
    return null;
  }
  renderToStaticMarkup(createElement(RuntimeProbe));
  if (!runtime) throw new Error("External Store runtime 未初始化");
  return runtime;
}

function emptyRepository(): ExportedMessageRepository {
  return { headId: null, messages: [] };
}

function userMessage(): ThreadMessage {
  return {
    id: "user",
    role: "user",
    content: [{ type: "text", text: "hello" }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: { pi: { kind: "user", sourceEntryId: "user" } } },
  };
}
