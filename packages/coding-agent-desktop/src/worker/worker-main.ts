/**
 * desktop coding agent worker 的 Electron utilityProcess 入口。
 */

import { runUtilityWorkerServer } from './utility-server.ts'
import { RuntimeDesktopWorkerService } from './runtime-service.ts'

/** 启动 utilityProcess worker 服务。 */
runUtilityWorkerServer(new RuntimeDesktopWorkerService())
