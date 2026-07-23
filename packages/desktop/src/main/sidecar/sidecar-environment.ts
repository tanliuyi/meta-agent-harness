import { delimiter, dirname } from "node:path";
import { windowsSystemDirectory } from "../../shared/process-tree.ts";

export function createSidecarEnvironment(
  runtimeCompatibilityId: string,
  agentDir: string,
  nodePath: string,
  npmCliPath: string,
  piExecutable: string,
  piEntry: string,
): NodeJS.ProcessEnv {
  const allowed = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => isAllowedSidecarEnvironmentVariable(name)),
  );
  const pathKeys = Object.keys(allowed).filter((name) => name.toLowerCase() === "path");
  const currentPath = pathKeys.map((name) => allowed[name]).find((value) => value !== undefined);
  for (const name of pathKeys) delete allowed[name];
  const systemDirectory = process.platform === "win32" ? windowsSystemDirectory(allowed) : undefined;
  return {
    ...allowed,
    PATH: [dirname(piExecutable), dirname(nodePath), systemDirectory, currentPath].filter(Boolean).join(delimiter),
    PI_CODING_AGENT_DIR: agentDir,
    PI_DESKTOP_NODE_EXEC_PATH: nodePath,
    PI_DESKTOP_NPM_CLI_PATH: npmCliPath,
    PI_DESKTOP_PI_ENTRY: piEntry,
    PI_DESKTOP_RUNTIME_COMPATIBILITY_ID: runtimeCompatibilityId,
  };
}

function isAllowedSidecarEnvironmentVariable(name: string): boolean {
  const comparedName = process.platform === "win32" ? name.toUpperCase() : name;
  if (comparedName === "PI_SUBAGENT_PI_BINARY" || comparedName.startsWith("PI_DESKTOP_")) return false;
  if (
    [
      "HOME",
      "USERPROFILE",
      "PATH",
      "PATHEXT",
      "COMSPEC",
      "SYSTEMROOT",
      "WINDIR",
      "TMPDIR",
      "TMP",
      "TEMP",
      "LANG",
      "TZ",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
    ].includes(comparedName)
  ) {
    return true;
  }
  if (comparedName.startsWith("LC_") || comparedName.startsWith("PI_")) return true;
  return (
    comparedName.endsWith("_API_KEY") ||
    comparedName.endsWith("_ACCESS_TOKEN") ||
    comparedName.startsWith("AWS_") ||
    comparedName.startsWith("AZURE_") ||
    comparedName.startsWith("GOOGLE_") ||
    comparedName.startsWith("ANTHROPIC_") ||
    comparedName.startsWith("OPENAI_")
  );
}
