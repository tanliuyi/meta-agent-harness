/**
 * 本文件是 desktop coding agent worker 的 stdio 入口。
 */

import { takeOverStdout } from "../../core/output-guard.ts";
import { runStdioWorkerServer } from "./stdio-server.ts";
import { RuntimeDesktopWorkerService } from "./runtime-service.ts";

takeOverStdout();
runStdioWorkerServer(new RuntimeDesktopWorkerService());
