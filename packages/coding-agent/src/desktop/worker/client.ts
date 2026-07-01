/**
 * 本文件定义 worker pool 依赖的 worker client 契约。
 */

import type { WorkerCommand, WorkerResponseEnvelope } from "../protocol/envelope.ts";
import type { ThreadId, WorkerId } from "../protocol/identity.ts";
import type { StartThreadInput } from "../protocol/thread.ts";
import type { WorkerSnapshot } from "../protocol/snapshot.ts";

export interface WorkerClient {
	readonly workerId: WorkerId;
	readonly threadId?: ThreadId;
	startThread(input: StartThreadInput): Promise<void>;
	send(command: WorkerCommand): Promise<WorkerResponseEnvelope>;
	snapshot(): WorkerSnapshot;
	stop(reason: string): Promise<void>;
}

export type WorkerClientFactory = () => Promise<WorkerClient>;

