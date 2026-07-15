import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@renderer", replacement: resolve("src/renderer/src") },
      { find: "@earendil-works/pi-ai/compat", replacement: resolve("../ai/src/compat.ts") },
      { find: "@earendil-works/pi-ai/oauth", replacement: resolve("../ai/src/oauth.ts") },
      { find: "@earendil-works/pi-ai", replacement: resolve("../ai/src/index.ts") },
      { find: "@earendil-works/pi-agent-core", replacement: resolve("../agent/src/index.ts") },
      { find: "@earendil-works/pi-coding-agent", replacement: resolve("../coding-agent/src/index.ts") },
      { find: "@earendil-works/pi-tui", replacement: resolve("../tui/src/index.ts") },
    ],
  },
});
