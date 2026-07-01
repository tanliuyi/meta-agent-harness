/**
 * 提供 desktop worker transport 使用的严格 JSONL 编解码能力。
 */

/**
 * 将单个记录序列化为 JSONL 行。
 * @param value - 要序列化的值。
 * @returns JSONL 行字符串。
 */
export function serializeJsonlRecord(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

/**
 * 逐行解码 JSONL 数据。
 */
export class JsonlDecoder {
	private buffer = "";

	/**
	 * 向解码器推入一段 chunk，并返回已完成的 JSONL 行。
	 * @param chunk - 输入字符串片段。
	 * @returns 已完成的 JSONL 行数组。
	 */
	push(chunk: string): string[] {
		this.buffer += chunk;
		const lines: string[] = [];
		while (true) {
			const index = this.buffer.indexOf("\n");
			if (index === -1) {
				return lines;
			}
			const line = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 1);
			lines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
		}
	}

	/**
	 * 结束解码，返回缓冲区中剩余的最后一行。
	 * @returns 剩余行数组，空时返回空数组。
	 */
	end(): string[] {
		if (this.buffer.length === 0) {
			return [];
		}
		const line = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
		this.buffer = "";
		return [line];
	}
}

/**
 * 解析单条 JSONL 记录。
 * @param line - JSONL 行字符串。
 * @returns 解析后的记录。
 */
export function parseJsonlRecord<T>(line: string): T {
	return JSON.parse(line) as T;
}

