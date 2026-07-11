/** Electron utilityProcess entry with Desktop's first-party extensions. */

import { RuntimeDesktopWorkerService } from '@coding-agent-desktop-src/worker/runtime-service'
import { runUtilityWorkerServer } from '@coding-agent-desktop-src/worker/utility-server'
import { createBuiltinRuntimeForThread } from './builtin-runtime'

runUtilityWorkerServer(new RuntimeDesktopWorkerService(createBuiltinRuntimeForThread))
