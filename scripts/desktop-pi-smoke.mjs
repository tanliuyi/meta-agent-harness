import { execFileSync, fork, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { createDesktopSmokeEnvironment } from "./desktop-smoke-environment.mjs";

export async function smokeDesktopPiExecutable(options) {
  const environment = createPiSmokeEnvironment(options);
  const output = execFileSync(options.nodePath, [options.threadEntry, "--version"], {
    encoding: "utf8",
    env: environment,
  }).trim();
  if (output !== options.compatibility.piVersion) {
    throw new Error(`Desktop Pi entry version mismatch: ${output} != ${options.compatibility.piVersion}`);
  }

  const ipcOutput = (await runForkedCli(options, environment)).trim();
  if (ipcOutput !== options.compatibility.piVersion) {
    throw new Error(`Desktop Pi IPC entry version mismatch: ${ipcOutput} != ${options.compatibility.piVersion}`);
  }
}

export function smokeDesktopPiExtensionExecution(options) {
  const runtimeRoot = join(
    options.agentDir,
    "runtime-deps",
    runtimeDependencyPathSegment(options.compatibility.runtimeCompatibilityId),
  );
  const packageRoot = join(runtimeRoot, "npm", "node_modules", "desktop-runtime-smoke");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(runtimeRoot, "runtime.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runtimeDependencyId: options.compatibility.runtimeCompatibilityId,
        nodeVersion: options.compatibility.nodeVersion,
        modulesAbi: options.compatibility.modulesAbi,
        platform: options.compatibility.platform,
        arch: options.compatibility.arch,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify({ name: "desktop-runtime-smoke", version: "1.0.0", pi: { extensions: ["./index.ts"] } }, null, 2)}\n`,
  );
  writeFileSync(
    join(options.agentDir, "models.json"),
    `${JSON.stringify({ providers: { smoke: { baseUrl: "http://127.0.0.1:1", apiKey: "smoke", api: "openai-responses", models: [{ id: "smoke", contextWindow: 4096, maxTokens: 1024 }] } } }, null, 2)}\n`,
  );
  writeFileSync(
    join(options.agentDir, "settings.json"),
    `${JSON.stringify({ defaultProvider: "smoke", defaultModel: "smoke", defaultProjectTrust: "always", packages: ["npm:desktop-runtime-smoke"] }, null, 2)}\n`,
  );
  writeFileSync(
    join(packageRoot, "index.ts"),
    `import { resolve } from "node:path";\n\nexport default async function (pi) {\n  const entry = process.argv[1];\n  if (!entry) throw new Error("Desktop Pi entry is missing from process.argv[1]");\n  if (resolve(process.execPath) !== resolve(${JSON.stringify(options.nodePath)})) {\n    throw new Error(\`Desktop Pi used the wrong Node: \${process.execPath}\`);\n  }\n  if (resolve(entry) !== resolve(${JSON.stringify(options.threadEntry)})) {\n    throw new Error(\`Desktop Pi used the wrong entry: \${entry}\`);\n  }\n  const checks = [\n    ["PATH", "pi", ["--version"]],\n    ["argv", process.execPath, [entry, "--version"]],\n  ];\n  for (const [label, command, args] of checks) {\n    const result = await pi.exec(command, args);\n    if (result.code !== 0 || result.stdout.trim() !== ${JSON.stringify(options.compatibility.piVersion)}) {\n      throw new Error(\`Desktop Pi \${label} child failed: code=\${result.code} stdout=\${JSON.stringify(result.stdout)} stderr=\${JSON.stringify(result.stderr)}\`);\n    }\n  }\n  process.stderr.write("DESKTOP_PI_EXTENSION_OK\\n");\n}\n`,
  );
  const result = spawnSync(options.nodePath, [options.threadEntry, "--mode", "rpc", "--no-session"], {
    encoding: "utf8",
    input: `${JSON.stringify({ id: "smoke", type: "get_state" })}\n`,
    env: createPiSmokeEnvironment(options),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Desktop Pi extension smoke failed (${result.status ?? result.signal}): ${result.stderr}`);
  }
  if (!result.stdout.includes('"command":"get_state"')) {
    throw new Error(`Desktop Pi entry did not answer RPC state: ${result.stdout}`);
  }
  if (!result.stderr.includes("DESKTOP_PI_EXTENSION_OK")) {
    throw new Error(`Desktop Pi extension did not execute its Pi children: ${result.stderr}`);
  }
}

function runtimeDependencyPathSegment(runtimeDependencyId) {
  return `v1-${createHash("sha256").update(runtimeDependencyId).digest("hex").slice(0, 24)}`;
}

function createPiSmokeEnvironment(options) {
  const environment = createDesktopSmokeEnvironment(process.env, options.nodePath, {
    PI_CODING_AGENT_DIR: options.agentDir,
    PI_DESKTOP_NODE_EXEC_PATH: options.nodePath,
    PI_DESKTOP_PI_ENTRY: options.threadEntry,
    PI_DESKTOP_RUNTIME_COMPATIBILITY_ID: options.compatibility.runtimeCompatibilityId,
  });
  environment.PATH = `${dirname(options.piExecutable)}${delimiter}${environment.PATH}`;
  if (process.platform === "win32") {
    environment.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    environment.ComSpec = environment.ComSpec ?? join(environment.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
  }
  return environment;
}

function runForkedCli(options, environment) {
  return new Promise((resolvePromise, reject) => {
    const child = fork(options.threadEntry, ["--version"], {
      execPath: options.nodePath,
      env: environment,
      silent: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Desktop Pi IPC entry timed out${stderr ? `\n${stderr}` : ""}`));
    }, 10_000);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`Desktop Pi IPC entry failed (${code ?? signal ?? "unknown"}): ${stderr}`));
    });
  });
}
