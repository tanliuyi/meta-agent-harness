/**
 * 本文件导出 extension 在运行时可导入的 coding-agent 公共 API。
 */

export type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  ToolDefinition
} from './core/extensions/index.ts'
export {
  defineTool,
  isBashToolResult,
  isEditToolResult,
  isFindToolResult,
  isGrepToolResult,
  isLsToolResult,
  isReadToolResult,
  isWriteToolResult
} from './core/extensions/index.ts'
export {
  type BashToolInput,
  type EditToolInput,
  type FindToolInput,
  type GrepToolInput,
  type LsToolInput,
  type ReadToolInput,
  type WriteToolInput,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition
} from './core/tools/index.ts'
