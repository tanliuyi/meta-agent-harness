import { delimiter, dirname, join } from "node:path";

const SAFE_ENVIRONMENT_NAMES = new Set([
  "DISPLAY",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_CONFIG_HOME",
  "XDG_CURRENT_DESKTOP",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
]);

export function createDesktopSmokeEnvironment(baseEnvironment, nodePath, overrides = {}) {
  const environment = Object.fromEntries(
    Object.entries(baseEnvironment).filter(([name, value]) => {
      if (value === undefined) return false;
      return SAFE_ENVIRONMENT_NAMES.has(name) || name.startsWith("LC_");
    }),
  );
  const systemRoot = environment.SystemRoot ?? "C:\\Windows";
  const systemPath = process.platform === "win32"
    ? [join(systemRoot, "System32"), systemRoot]
    : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  environment.PATH = [dirname(nodePath), ...systemPath].join(delimiter);
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ELECTRON_RENDERER_URL;
  delete environment.PI_DESKTOP_NODE_EXEC_PATH;
  Object.assign(environment, overrides);
  return environment;
}
