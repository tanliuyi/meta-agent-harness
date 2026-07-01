/**
 * 本文件测试 desktop JSONL transport 编解码。
 */

import { describe, expect, it } from "vitest";
import { JsonlDecoder, parseJsonlRecord, serializeJsonlRecord } from "../transport/jsonl.ts";

/** desktop JSONL transport 编解码测试套件。 */
describe("desktop JSONL transport", () => {
	/** 验证单条记录序列化后以 LF 结尾。 */
	it("序列化单条 LF 结尾记录", () => {
		expect(serializeJsonlRecord({ type: "ping" })).toBe('{"type":"ping"}\n');
	});

	/** 验证按 LF 切分，并保留 JSON 字符串中的 Unicode 行分隔符。 */
	it("只按 LF 切分，保留 JSON 字符串里的 Unicode 行分隔符", () => {
		const decoder = new JsonlDecoder();
		const lines = decoder.push('{"text":"a b"}\n{"text":"c"}\n');

		expect(lines).toEqual(['{"text":"a b"}', '{"text":"c"}']);
		expect(parseJsonlRecord<{ text: string }>(lines[0]).text).toBe("a b");
	});

	/** 验证支持 CRLF 输入并在 end 时吐出剩余记录。 */
	it("支持 CRLF 输入并在 end 时吐出剩余记录", () => {
		const decoder = new JsonlDecoder();

		expect(decoder.push('{"a":1}\r\n{"b":')).toEqual(['{"a":1}']);
		expect(decoder.push("2}")).toEqual([]);
		expect(decoder.end()).toEqual(['{"b":2}']);
	});
});
