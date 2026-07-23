import { VERSION } from "@earendil-works/pi-coding-agent";
import { runCli } from "@earendil-works/pi-coding-agent/cli-runtime";
import { DesktopBuiltinProviderRegistry } from "../main/pi/desktop-builtin-provider.ts";
import { SIDECAR_MODE_ARGUMENT } from "../shared/sidecar-contracts.ts";
import { currentRuntimeCompatibility } from "../shared/sidecar-wire.ts";
import { runSidecarHost } from "./sidecar-host.ts";
import { ThreadWorkerService } from "./thread-worker-service.ts";

const compatibilityId = process.env.PI_DESKTOP_RUNTIME_COMPATIBILITY_ID;
if (!compatibilityId) throw new Error("PI_DESKTOP_RUNTIME_COMPATIBILITY_ID is required");

if (process.argv[2] === SIDECAR_MODE_ARGUMENT) {
  runSidecarHost(currentRuntimeCompatibility(VERSION, compatibilityId), (binding, context) =>
    ThreadWorkerService.create(binding, context),
  );
} else {
  const nodePath = process.env.PI_DESKTOP_NODE_EXEC_PATH;
  const npmCliPath = process.env.PI_DESKTOP_NPM_CLI_PATH;
  if (!nodePath) throw new Error("Desktop package runtime is incomplete");
  void runCli(process.argv.slice(2), {
    extensionFactories: DesktopBuiltinProviderRegistry.getExtensionFactories(),
    runtimeDependencyId: compatibilityId,
    packageManagerNpmCommand: npmCliPath ? [nodePath, npmCliPath] : [],
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
}
