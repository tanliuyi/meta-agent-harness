import type { Message } from "@ag-ui/core";
import { type ExportedMessageRepository, fromThreadMessageLike, type ThreadMessage } from "@assistant-ui/react";
import { fromAgUiMessages } from "@assistant-ui/react-ag-ui";

/** 使用 react-ag-ui 官方转换器建立可直接 hydrate 的 assistant-ui 消息。 */
export function convertAgUiMessages(messages: Message[]): ThreadMessage[] {
  return fromAgUiMessages(messages).map((message) =>
    fromThreadMessageLike(message, message.id ?? crypto.randomUUID(), { type: "complete", reason: "unknown" }),
  );
}

/** assistant-ui thread.import() 使用的线性权威消息仓库。 */
export function messageRepository(messages: readonly ThreadMessage[]): ExportedMessageRepository {
  return {
    headId: messages.at(-1)?.id ?? null,
    messages: messages.map((message, index) => ({
      message,
      parentId: messages[index - 1]?.id ?? null,
    })),
  };
}
