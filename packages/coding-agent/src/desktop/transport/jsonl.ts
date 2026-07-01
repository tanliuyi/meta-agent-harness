/**
 * 本文件提供 desktop worker transport 使用的严格 JSONL 编解码能力。
 */

export function serializeJsonlRecord(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

export class JsonlDecoder {
	private buffer = "";

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

	end(): string[] {
		if (this.buffer.length === 0) {
			return [];
		}
		const line = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
		this.buffer = "";
		return [line];
	}
}

export function parseJsonlRecord<T>(line: string): T {
	return JSON.parse(line) as T;
}

