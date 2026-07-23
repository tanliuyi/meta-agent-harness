import { describe, expect, it } from "vitest";
import { DesktopBuiltinProviderRegistry } from "../src/main/pi/desktop-builtin-provider.ts";

describe("DesktopBuiltinProviderRegistry", () => {
  it("keeps core providers authoritative when IDs collide", () => {
    const factoriesBefore = DesktopBuiltinProviderRegistry.getExtensionFactories();
    const providersBefore = DesktopBuiltinProviderRegistry.getKnownProviderInfos();

    DesktopBuiltinProviderRegistry.register("anthropic", {
      displayName: "Desktop Anthropic Override",
      envKeys: ["DESKTOP_ANTHROPIC_API_KEY"],
      extensionFactory: {
        name: "desktop:anthropic",
        factory: () => undefined,
      },
    });

    expect(DesktopBuiltinProviderRegistry.getExtensionFactories()).toEqual(factoriesBefore);
    expect(DesktopBuiltinProviderRegistry.getKnownProviderInfos()).toEqual(providersBefore);
  });
});
