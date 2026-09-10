// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notifyMarketplacePluginsChanged,
  PluginUpdateStatusProvider,
  usePluginUpdatesAvailable,
} from "../src/renderer/src/features/plugins/plugin-update-status.tsx";
import type {
  InstalledMarketplacePluginsSnapshot,
  MarketplacePluginSummary,
} from "../src/shared/plugin-marketplace-contracts.ts";

const installed: InstalledMarketplacePluginsSnapshot = {
  revision: "revision-1",
  plugins: [
    {
      id: "example.tools",
      displayName: "Example Tools",
      marketplaceId: "default",
      version: "1.0.0",
      artifactId: "artifact-1",
      enabled: true,
      capabilities: [],
      containsNativeCode: false,
      configurable: false,
      state: "installed",
      installedAt: 1,
      scope: "global",
    },
  ],
};

const marketplacePlugin: MarketplacePluginSummary = {
  id: "example.tools",
  name: "Example Tools",
  description: "Example",
  publisher: { id: "publisher", displayName: "Publisher", verified: true },
  categories: [],
  compatibleVersion: "1.1.0",
  containsNativeCode: false,
  status: "available",
  publishedAt: 1,
  updatedAt: 2,
};

let container: HTMLDivElement;
let root: Root;
let getInstalled: ReturnType<typeof vi.fn>;
let getPlugin: ReturnType<typeof vi.fn>;

function UpdateStatusProbe() {
  return <span data-updates-available={usePluginUpdatesAvailable()} />;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  getInstalled = vi.fn().mockResolvedValue(installed);
  getPlugin = vi.fn().mockResolvedValue(marketplacePlugin);
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: { marketplace: { getInstalled, getPlugin } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("PluginUpdateStatusProvider", () => {
  it("marks the sidebar when an installed plugin has a compatible update", async () => {
    await act(async () =>
      root.render(
        <PluginUpdateStatusProvider>
          <UpdateStatusProbe />
        </PluginUpdateStatusProvider>,
      ),
    );

    expect(container.querySelector("[data-updates-available=true]")).not.toBeNull();
    expect(getPlugin).toHaveBeenCalledWith("example.tools");
  });

  it("refreshes after marketplace plugin state changes", async () => {
    getPlugin.mockResolvedValue({ ...marketplacePlugin, compatibleVersion: "1.0.0" });
    await act(async () =>
      root.render(
        <PluginUpdateStatusProvider>
          <UpdateStatusProbe />
        </PluginUpdateStatusProvider>,
      ),
    );
    expect(container.querySelector("[data-updates-available=false]")).not.toBeNull();

    getPlugin.mockResolvedValue(marketplacePlugin);
    await act(async () => notifyMarketplacePluginsChanged());

    expect(container.querySelector("[data-updates-available=true]")).not.toBeNull();
  });
});
