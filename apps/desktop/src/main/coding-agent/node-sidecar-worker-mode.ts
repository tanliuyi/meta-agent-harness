/**
 * 本文件封装 node sidecar worker 的启动模式判定。
 */

/**
 * 判断当前 sidecar 是否由扩展通过 Desktop 托管的 `pi` launcher 拉起。
 *
 * 内部 IPC worker 与无参数 `pi` 都没有 argv，不能再用参数数量作为唯一依据。
 * launcher 会设置 desktopCliMarker；内部 worker 不设置。保留“有参数即 CLI”的判断，
 * 是为了兼容测试、诊断命令以及已有的直接 sidecar argv 调用。
 */
export function shouldRunCliCompatibilityMode(
  args: readonly string[],
  desktopCliMarker = process.env.META_AGENT_DESKTOP_PI_CLI
): boolean {
  return desktopCliMarker === '1' || args.length > 0
}
