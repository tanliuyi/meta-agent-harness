import { describe, expect, it } from "vitest";
import { defaultSessionPath, normalizeApiRoot } from "../src/main/pi/skills/plugin-publish/scripts/session.mjs";

describe("plugin marketplace session identity", () => {
  it("removes trailing slashes from API roots", () => {
    expect(normalizeApiRoot("http://marketplace.example/v1///")).toBe("http://marketplace.example/v1");
  });

  it("uses one session path for equivalent API roots", () => {
    expect(defaultSessionPath("http://marketplace.example/v1/", "publisher")).toBe(
      defaultSessionPath("http://marketplace.example/v1", "publisher"),
    );
  });
});
