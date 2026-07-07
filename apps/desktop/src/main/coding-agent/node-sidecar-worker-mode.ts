/**
 * 本文件封装 node sidecar worker 的启动模式判定。
 */

/** 判断启动参数是否是 Pi print/json 协议。 */
export function shouldRunCliCompatibilityMode(args: readonly string[]): boolean {
  return args.length > 0
}
