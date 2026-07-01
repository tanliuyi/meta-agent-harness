/**
 * 本文件提供测试和进程内连接使用的内存 transport。
 */

import type { WorkerEnvelope } from "../protocol/envelope.ts";
import type { WorkerTransport } from "./transport.ts";

export class MemoryTransport implements WorkerTransport {
	private peer: MemoryTransport | undefined;
	private readonly messageListeners = new Set<(envelope: WorkerEnvelope) => void>();
	private readonly closeListeners = new Set<(reason: string) => void>();
	private closed = false;

	static pair(): [MemoryTransport, MemoryTransport] {
		const left = new MemoryTransport();
		const right = new MemoryTransport();
		left.peer = right;
		right.peer = left;
		return [left, right];
	}

	send(envelope: WorkerEnvelope): void {
		if (this.closed) {
			throw new Error("transport is closed");
		}
		if (!this.peer || this.peer.closed) {
			throw new Error("transport peer is closed");
		}
		this.peer.emitMessage(envelope);
	}

	onMessage(listener: (envelope: WorkerEnvelope) => void): () => void {
		this.messageListeners.add(listener);
		return () => this.messageListeners.delete(listener);
	}

	onClose(listener: (reason: string) => void): () => void {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.emitClose("transport closed");
		this.peer?.emitClose("transport peer closed");
	}

	private emitMessage(envelope: WorkerEnvelope): void {
		for (const listener of this.messageListeners) {
			listener(envelope);
		}
	}

	private emitClose(reason: string): void {
		for (const listener of this.closeListeners) {
			listener(reason);
		}
	}
}

