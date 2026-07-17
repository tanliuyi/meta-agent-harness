import {
  type PiAssistantMessage,
  type PiThreadEvent,
  type PiThreadEventBatch,
  type PiThreadSnapshot,
  type PiTimelineNode,
  PROTOCOL_VERSION,
} from "../../../shared/contracts.ts";

type Listener = () => void;

/** 保持 Pi timeline identity 的最小 external store。 */
export class PiThreadStore {
  private state: PiThreadSnapshot;
  private readonly listeners = new Set<Listener>();

  constructor(initial: PiThreadSnapshot = detachedSnapshot()) {
    this.state = initial;
  }

  getSnapshot = (): PiThreadSnapshot => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  replace(snapshot: PiThreadSnapshot): void {
    validateSnapshot(snapshot);
    this.state = snapshot;
    this.notify();
  }

  apply(batch: PiThreadEventBatch): void {
    validateBatch(batch, this.state);
    if (batch.toSequence <= this.state.cursor) return;
    const events = batch.events.filter((envelope) => envelope.sequence > this.state.cursor);
    const firstSequence = events[0]?.sequence;
    if (firstSequence !== this.state.cursor + 1)
      throw new PiThreadStoreError(`timeline sequence gap: ${this.state.cursor} -> ${String(firstSequence)}`);

    let state = this.state;
    for (const envelope of events) {
      state = applyEvent(state, envelope.event, envelope.sequence);
    }
    this.state = state;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export class PiThreadStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiThreadStoreError";
  }
}

function applyEvent(state: PiThreadSnapshot, event: PiThreadEvent, sequence: number): PiThreadSnapshot {
  switch (event.type) {
    case "phase-changed":
      return {
        ...state,
        cursor: sequence,
        phase: event.phase,
        ...(event.activeTurnId ? { activeTurnId: event.activeTurnId } : { activeTurnId: undefined }),
      };
    case "node-added":
      if (state.nodes.some((node) => node.id === event.node.id))
        throw new PiThreadStoreError(`重复 timeline node: ${event.node.id}`);
      assertParent(state.nodes, event.node.parentId);
      return { ...state, cursor: sequence, headId: event.node.id, nodes: [...state.nodes, event.node] };
    case "node-rekeyed":
      return rekeyNode(state, event.previousId, event.node, sequence);
    case "node-replaced":
      return replaceNode(state, event.node, sequence);
    case "part-added":
      return updateAssistant(state, event.messageId, sequence, (message) => {
        if (message.content.some((part) => part.id === event.part.id))
          throw new PiThreadStoreError(`重复 assistant part: ${event.part.id}`);
        return { ...message, content: [...message.content, event.part] };
      });
    case "text-delta":
    case "reasoning-delta":
      return updateAssistant(state, event.messageId, sequence, (message) => {
        let found = false;
        const content = message.content.map((part) => {
          if (part.id !== event.partId) return part;
          if (event.type === "text-delta") {
            if (part.type !== "text") throw new PiThreadStoreError(`text delta part 类型错误: ${event.partId}`);
          } else if (part.type !== "reasoning") {
            throw new PiThreadStoreError(`reasoning delta part 类型错误: ${event.partId}`);
          }
          found = true;
          return { ...part, text: part.text + event.delta };
        });
        if (!found) throw new PiThreadStoreError(`delta part 不存在: ${event.partId}`);
        return { ...message, content };
      });
    case "tool-call-replaced":
      return updateAssistant(state, event.messageId, sequence, (message) => {
        let found = false;
        const content = message.content.map((part) => {
          if (part.id !== event.part.id) return part;
          if (part.type !== "tool-call") throw new PiThreadStoreError(`tool part 类型错误: ${event.part.id}`);
          found = true;
          return event.part;
        });
        if (!found) throw new PiThreadStoreError(`tool part 不存在: ${event.part.id}`);
        return { ...message, content };
      });
    case "message-finished":
      return replaceNode(state, event.message, sequence);
    case "queue-replaced":
      return { ...state, cursor: sequence, queue: event.items };
    case "branch-replaced":
      validateSnapshot(event.snapshot);
      if (event.snapshot.projectId !== state.projectId || event.snapshot.threadId !== state.threadId)
        throw new PiThreadStoreError("branch snapshot session 不匹配");
      if (event.snapshot.cursor !== sequence) throw new PiThreadStoreError("branch snapshot cursor 不匹配");
      return event.snapshot;
    default:
      return assertNever(event);
  }
}

function updateAssistant(
  state: PiThreadSnapshot,
  id: string,
  sequence: number,
  update: (message: PiAssistantMessage) => PiAssistantMessage,
): PiThreadSnapshot {
  const current = state.nodes.find((node) => node.id === id);
  if (!current || current.kind !== "assistant") throw new PiThreadStoreError(`assistant node 不存在: ${id}`);
  return replaceNode(state, update(current), sequence);
}

function replaceNode(state: PiThreadSnapshot, node: PiTimelineNode, sequence: number): PiThreadSnapshot {
  let found = false;
  const nodes = state.nodes.map((current) => {
    if (current.id !== node.id) return current;
    found = true;
    return node;
  });
  if (!found) throw new PiThreadStoreError(`timeline node 不存在: ${node.id}`);
  assertParent(nodes, node.parentId);
  return { ...state, cursor: sequence, nodes };
}

function rekeyNode(
  state: PiThreadSnapshot,
  previousId: string,
  node: PiTimelineNode,
  sequence: number,
): PiThreadSnapshot {
  if (previousId !== node.id && state.nodes.some((current) => current.id === node.id))
    throw new PiThreadStoreError(`rekey 目标已存在: ${node.id}`);
  let found = false;
  const nodes = state.nodes.map((current) => {
    if (current.id === previousId) {
      found = true;
      return node;
    }
    return current.parentId === previousId ? ({ ...current, parentId: node.id } as PiTimelineNode) : current;
  });
  if (!found) throw new PiThreadStoreError(`rekey 源不存在: ${previousId}`);
  assertParent(nodes, node.parentId);
  return {
    ...state,
    cursor: sequence,
    headId: state.headId === previousId ? node.id : state.headId,
    nodes,
  };
}

function assertParent(nodes: readonly PiTimelineNode[], parentId: string | null): void {
  if (parentId !== null && !nodes.some((node) => node.id === parentId))
    throw new PiThreadStoreError(`timeline parent 不存在: ${parentId}`);
}

function validateSnapshot(snapshot: PiThreadSnapshot): void {
  if (snapshot.protocolVersion !== PROTOCOL_VERSION)
    throw new PiThreadStoreError(`不支持的 timeline protocol: ${snapshot.protocolVersion}`);
  const ids = new Set<string>();
  for (const node of snapshot.nodes) {
    if (ids.has(node.id)) throw new PiThreadStoreError(`重复 snapshot node: ${node.id}`);
    if (node.parentId !== null && !ids.has(node.parentId))
      throw new PiThreadStoreError(`snapshot parent 顺序无效: ${node.parentId}`);
    ids.add(node.id);
  }
  if (snapshot.headId !== null && !ids.has(snapshot.headId))
    throw new PiThreadStoreError(`snapshot head 不存在: ${snapshot.headId}`);
}

function validateBatch(batch: PiThreadEventBatch, state: PiThreadSnapshot): void {
  if (batch.protocolVersion !== PROTOCOL_VERSION) throw new PiThreadStoreError("timeline batch protocol 不匹配");
  if (batch.projectId !== state.projectId || batch.threadId !== state.threadId)
    throw new PiThreadStoreError("timeline batch session 不匹配");
  let expected = batch.fromSequence;
  for (const envelope of batch.events) {
    if (envelope.protocolVersion !== PROTOCOL_VERSION)
      throw new PiThreadStoreError("timeline envelope protocol 不匹配");
    if (envelope.projectId !== batch.projectId || envelope.threadId !== batch.threadId)
      throw new PiThreadStoreError("timeline envelope session 不匹配");
    if (envelope.sequence !== expected) throw new PiThreadStoreError(`batch sequence 不连续: ${expected}`);
    expected += 1;
  }
  if (expected - 1 !== batch.toSequence) throw new PiThreadStoreError("batch toSequence 与 events 不匹配");
}

export function detachedSnapshot(): PiThreadSnapshot {
  return {
    protocolVersion: PROTOCOL_VERSION,
    projectId: "",
    threadId: "",
    cursor: 0,
    headId: null,
    nodes: [],
    queue: [],
    phase: "idle",
  };
}

function assertNever(value: never): never {
  throw new PiThreadStoreError(`未知 timeline event: ${String(value)}`);
}
