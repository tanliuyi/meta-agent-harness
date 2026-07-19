import { VERSION } from "@earendil-works/pi-coding-agent";
import { currentRuntimeCompatibility } from "../shared/sidecar-wire.ts";
import { MetadataWorkerService } from "./metadata-worker-service.ts";
import { runSidecarHost } from "./sidecar-host.ts";

const compatibilityId = process.env.PI_DESKTOP_RUNTIME_COMPATIBILITY_ID;
if (!compatibilityId) throw new Error("PI_DESKTOP_RUNTIME_COMPATIBILITY_ID is required");

runSidecarHost(currentRuntimeCompatibility(VERSION, compatibilityId), (binding) =>
  MetadataWorkerService.create(binding),
);
