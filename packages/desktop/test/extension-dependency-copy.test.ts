import { describe, expect, it } from "vitest";
import { EXTENSION_DEPENDENCY_CUSTOMER_COPY } from "../src/renderer/src/features/extension-dependencies/extension-dependency-gate.tsx";

describe("extension dependency customer copy", () => {
  it("explains the required action without exposing runtime implementation details", () => {
    const copy = Object.values(EXTENSION_DEPENDENCY_CUSTOMER_COPY).join(" ");

    expect(copy).toContain("需要更新扩展");
    expect(copy).toContain("安装脚本");
    expect(copy).not.toMatch(/Node|ABI|fingerprint|runtime|entry|命令行/i);
  });
});
