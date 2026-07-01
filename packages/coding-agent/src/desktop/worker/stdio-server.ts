/**
 * 本文件提供 desktop worker 的 stdio JSONL 服务入口工具。
 */

import { stdin } from "node:process";
import { attachJsonlLineReader } from "../../modes/rpc/jsonl.ts";
import { takeOverStdout, writeRawStdout } from "../../core/output-guard.ts";
import type { WorkerCommandEnvelope } from "../protocol/envelope.ts";
import { createDesktopError } from "../protocol/error.ts";
import { createWorkerErrorResponse } from "../protocol/envelope.ts";
import { parseJsonlRecord, serializeJsonlRecord } from "../transport/jsonl.ts";
import type { DesktopWorkerService } from "./service.ts";

export function runStdioWorkerServer(service: DesktopWorkerService): () => void {
	takeOverStdout();
	return attachJsonlLineReader(stdin, (line) => {
		void handleLine(service, line);
	});
}

async function handleLine(service: DesktopWorkerService, line: string): Promise<void> {
	let envelope: WorkerCommandEnvelope;
	try {
		envelope = parseJsonlRecord<WorkerCommandEnvelope>(line);
	} catch (error) {
		writeWorkerEnvelope(
			serializeJsonlRecord(
				createWorkerErrorResponse(
					"parse",
					"parse",
					createDesktopError("protocol_error", error instanceof Error ? error.message : String(error), true),
				),
			),
		);
		return;
	}
	const response = await service.handle(envelope);
	writeWorkerEnvelope(serializeJsonlRecord(response));
}

function writeWorkerEnvelope(line: string): void {
	writeRawStdout(line);
}
