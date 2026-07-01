/**
 * desktop coding agent worker 的 stdio 入口。
 */

import { takeOverStdout } from "../../core/output-guard.ts";
import { runStdioWorkerServer } from "./stdio-server.ts";
import { RuntimeDesktopWorkerService } from "./runtime-service.ts";

/** 接管标准输出并启动 stdio worker 服务。 */
takeOverStdout();
runStdioWorkerServer(new RuntimeDesktopWorkerService());
