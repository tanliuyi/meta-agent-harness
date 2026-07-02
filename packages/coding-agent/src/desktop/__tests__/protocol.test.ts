/**
 * 本文件测试 desktop 协议命令分类。
 */

import { describe, expect, it } from "vitest";
import { isCanonicalAgentCommand } from "../protocol/commands/canonical.ts";
import { isDesktopControlCommand } from "../protocol/commands/control.ts";

/** desktop 协议命令 guard 测试套件。 */
describe("desktop protocol command guards", () => {
	/** 验证 Pi 同构 canonical 命令的识别。 */
	it("识别 Pi 同构 canonical 命令", () => {
		expect(isCanonicalAgentCommand({ type: "prompt" })).toBe(true);
		expect(isCanonicalAgentCommand({ type: "get_messages" })).toBe(true);
		expect(isCanonicalAgentCommand({ type: "worker.snapshot" })).toBe(false);
	});

	/** 验证 desktop control 命令的识别。 */
	it("识别 desktop control 命令", () => {
		expect(isDesktopControlCommand({ type: "worker.snapshot" })).toBe(true);
		expect(isDesktopControlCommand({ type: "approval.respond" })).toBe(true);
		expect(isDesktopControlCommand({ type: "prompt" })).toBe(false);
	});
});
