/**
 * 本文件定义 desktop worker transport 的最小双向消息接口。
 */

import type { WorkerEnvelope } from "../protocol/envelope.ts";

export interface WorkerTransport {
	send(envelope: WorkerEnvelope): void;
	onMessage(listener: (envelope: WorkerEnvelope) => void): () => void;
	onClose(listener: (reason: string) => void): () => void;
	close(): void;
}

