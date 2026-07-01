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

/**
 * 启动基于 stdio 的 JSONL worker 服务。
 * 接管 stdout 后，从 stdin 读取 JSONL 命令并写出响应。
 * @param service - desktop worker service 实例。
 * @returns 停止服务并清理的函数。
 */
export function runStdioWorkerServer(service: DesktopWorkerService): () => void {
	takeOverStdout();
	return attachJsonlLineReader(stdin, (line) => {
		void handleLine(service, line);
	});
}

/**
 * 处理从 stdin 读取到的一行 JSONL。
 * 解析为命令信封，调用 service 处理，并将响应写出；若解析失败则写出协议错误。
 * @param service - desktop worker service 实例。
 * @param line - 从 stdin 读取到的 JSONL 字符串。
 */
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

/**
 * 将一行响应字符串写出到 stdout。
 * @param line - 已序列化的响应 JSONL 字符串。
 */
function writeWorkerEnvelope(line: string): void {
	writeRawStdout(line);
}
