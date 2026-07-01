/**
 * 本文件把 worker service 绑定到抽象 transport。
 */

import { createDesktopError } from "../protocol/error.ts";
import { createWorkerErrorResponse, type WorkerCommandEnvelope } from "../protocol/envelope.ts";
import type { WorkerTransport } from "../transport/transport.ts";
import type { DesktopWorkerService } from "./service.ts";

export function bindWorkerServiceTransport(service: DesktopWorkerService, transport: WorkerTransport): () => void {
	service.setEventSink?.((event) => transport.send(event));
	return transport.onMessage((envelope) => {
		if (envelope.kind !== "command") {
			transport.send(
				createWorkerErrorResponse(
					"protocol",
					"protocol",
					createDesktopError("protocol_error", "worker service only accepts command envelopes", true),
				),
			);
			return;
		}
		void handleCommand(service, transport, envelope);
	});
}

async function handleCommand(
	service: DesktopWorkerService,
	transport: WorkerTransport,
	envelope: WorkerCommandEnvelope,
): Promise<void> {
	try {
		transport.send(await service.handle(envelope));
	} catch (error) {
		transport.send(
			createWorkerErrorResponse(
				envelope.id,
				envelope.command.type,
				createDesktopError("runtime_error", error instanceof Error ? error.message : String(error), false),
			),
		);
	}
}
