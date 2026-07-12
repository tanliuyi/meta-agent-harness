/**
 * 定义 desktop metadata 文件的 schema 版本。
 */

/** Desktop metadata schema 版本号。 */
export const DESKTOP_METADATA_SCHEMA_VERSION = 1

/** Desktop metadata 文件名列表。 */
export const desktopMetadataFiles = ['projects.json', 'threads.json'] as const

/** Desktop metadata 文件类型。 */
export type DesktopMetadataFile = (typeof desktopMetadataFiles)[number]
