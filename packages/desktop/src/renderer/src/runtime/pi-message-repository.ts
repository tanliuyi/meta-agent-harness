import {
  type ExportedMessageRepository,
  fromThreadMessageLike,
  type ThreadMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { PiAssistantMessage, PiThreadSnapshot, PiTimelineNode } from "../../../shared/contracts.ts";

/** 增量复用 ThreadMessage，同时每个 snapshot 生成新的 repository wrapper。 */
export class PiMessageRepositoryConverter {
  private readonly messages = new WeakMap<PiTimelineNode, ThreadMessage>();
  private readonly assistantGroups = new WeakMap<
    PiAssistantMessage,
    { members: readonly PiAssistantMessage[]; message: ThreadMessage }
  >();

  build(snapshot: PiThreadSnapshot): ExportedMessageRepository {
    const entries: Array<{ nodes: readonly PiTimelineNode[]; parentId: string | null }> = [];
    const displayIds = new Map<string, string>();

    for (let index = 0; index < snapshot.nodes.length; ) {
      const node = snapshot.nodes[index];
      if (!node) break;
      if (node.kind !== "assistant") {
        entries.push({ nodes: [node], parentId: node.parentId });
        displayIds.set(node.id, node.id);
        index += 1;
        continue;
      }

      const group: PiAssistantMessage[] = [node];
      index += 1;
      while (true) {
        const next = snapshot.nodes[index];
        if (!next || next.kind !== "assistant") break;
        group.push(next);
        index += 1;
      }
      entries.push({ nodes: group, parentId: node.parentId });
      for (const member of group) displayIds.set(member.id, node.id);
    }

    const displayId = (id: string | null) => (id ? (displayIds.get(id) ?? id) : null);
    return {
      headId: displayId(snapshot.headId),
      messages: entries.map(({ nodes, parentId }) => ({
        message: this.convertGroup(nodes),
        parentId: displayId(parentId),
      })),
    };
  }

  private convertGroup(nodes: readonly PiTimelineNode[]): ThreadMessage {
    const first = nodes[0];
    if (!first) throw new Error("assistant-ui message group 不能为空");
    if (nodes.length === 1) return this.convert(first);
    if (first.kind !== "assistant" || !nodes.every((node) => node.kind === "assistant"))
      throw new Error("assistant-ui message group 类型不一致");

    const members = nodes as readonly PiAssistantMessage[];
    const cached = this.assistantGroups.get(first);
    if (cached && sameMembers(cached.members, members)) return cached.message;
    const last = members.at(-1) ?? first;
    const merged: PiAssistantMessage = {
      id: first.id,
      parentId: first.parentId,
      createdAt: first.createdAt,
      kind: "assistant",
      ...(last.sourceEntryId ? { sourceEntryId: last.sourceEntryId } : {}),
      ...(last.label ? { label: last.label } : {}),
      content: members.flatMap((node) => node.content),
      status: last.status,
      provenance: last.provenance,
      usage: last.usage,
      ...(last.diagnostics !== undefined ? { diagnostics: last.diagnostics } : {}),
    };
    const message = fromThreadMessageLike(messageLike(merged), merged.id, { type: "complete", reason: "unknown" });
    this.assistantGroups.set(first, { members: [...members], message });
    return message;
  }

  private convert(node: PiTimelineNode): ThreadMessage {
    const cached = this.messages.get(node);
    if (cached) return cached;
    const message = fromThreadMessageLike(messageLike(node), node.id, { type: "complete", reason: "unknown" });
    this.messages.set(node, message);
    return message;
  }
}

function sameMembers(left: readonly PiAssistantMessage[], right: readonly PiAssistantMessage[]): boolean {
  return left.length === right.length && left.every((node, index) => node === right[index]);
}

function messageLike(node: PiTimelineNode): ThreadMessageLike {
  const metadata = {
    custom: {
      pi: {
        kind: node.kind,
        ...(node.sourceEntryId ? { sourceEntryId: node.sourceEntryId } : {}),
        ...(node.label ? { label: node.label } : {}),
      },
    },
  };
  if (node.kind === "user") {
    const images = node.content.flatMap((part, index) => (part.type === "image" ? [{ part, index }] : []));
    return {
      id: node.id,
      role: "user",
      createdAt: new Date(node.createdAt),
      content: node.content.flatMap((part) =>
        part.type === "text" ? [{ type: "text" as const, text: part.text }] : [],
      ),
      attachments: images.map(({ part, index }) => ({
        id: `${node.id}:image:${index}`,
        type: "image",
        name: imageName(part.mimeType, index),
        contentType: part.mimeType,
        status: { type: "complete" },
        content: [
          {
            type: "image",
            image: `data:${part.mimeType};base64,${part.data}`,
            filename: imageName(part.mimeType, index),
          },
        ],
      })),
      metadata: {
        custom: {
          ...metadata.custom,
          pi: { ...metadata.custom.pi, delivery: node.delivery },
        },
      },
    };
  }
  if (node.kind === "assistant") {
    return {
      id: node.id,
      role: "assistant",
      createdAt: new Date(node.createdAt),
      content: node.content.map((part) => {
        if (part.type === "text") return { type: "text" as const, text: part.text };
        if (part.type === "reasoning") return { type: "reasoning" as const, text: part.text };
        return {
          type: "tool-call" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args,
          argsText: part.argsText,
          artifact: { execution: part.execution, partialResult: part.partialResult },
          ...(part.result !== undefined ? { result: part.result } : {}),
          ...(part.isError !== undefined ? { isError: part.isError } : {}),
        };
      }),
      status: node.status,
      metadata: {
        custom: {
          ...metadata.custom,
          pi: {
            ...metadata.custom.pi,
            provenance: node.provenance,
            usage: node.usage,
            ...(node.diagnostics !== undefined ? { diagnostics: node.diagnostics } : {}),
          },
        },
      },
    };
  }
  return {
    id: node.id,
    role: "assistant",
    createdAt: new Date(node.createdAt),
    content: [{ type: "data", name: "pi-notice", data: node }],
    status: { type: "complete", reason: "unknown" },
    metadata,
  };
}

function imageName(mimeType: string, index: number): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1]?.replace("+xml", "") || "img";
  return `image-${index + 1}.${extension}`;
}
