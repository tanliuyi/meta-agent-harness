/**
 * Desktop embedded-browser host bridge (Desktop Host Profile v1).
 *
 * When the pi-mcp-adapter runs inside Meta Agent Desktop, a local RPC host
 * exposes the session's embedded browser. This module talks to that host with
 * plain `fetch` so the vendored extension keeps working on non-Desktop hosts
 * (the host is simply absent there and every call reports `ok: false`).
 *
 * Environment contract (injected by Desktop before extension code runs):
 *   PI_BROWSER_HOST_PORT             - local RPC port
 *   PI_BROWSER_TOKEN                 - host token
 *   PI_BROWSER_SESSION_TOKEN         - session token
 *   PI_BROWSER_SESSION_PROJECT_ID    - session project id
 *   PI_BROWSER_SESSION_THREAD_ID     - session thread id
 */

const OPEN_BROWSER_TIMEOUT_MS = 15_000;

export interface DesktopBrowserOpenResult {
  ok: boolean;
  reason?: string;
}

function failure(reason: string): DesktopBrowserOpenResult {
  return { ok: false, reason };
}

export function isDesktopBrowserHostAvailable(): boolean {
  return parsePort(process.env.PI_BROWSER_HOST_PORT) !== undefined
    && Boolean(process.env.PI_BROWSER_TOKEN)
    && Boolean(process.env.PI_BROWSER_SESSION_TOKEN)
    && Boolean(process.env.PI_BROWSER_SESSION_PROJECT_ID)
    && Boolean(process.env.PI_BROWSER_SESSION_THREAD_ID);
}

/** Opens a URL in the current Desktop session's embedded browser. Never throws. */
export async function openDesktopBrowser(url: string): Promise<DesktopBrowserOpenResult> {
  const validationError = validateUrl(url);
  if (validationError) return failure(validationError);

  const port = parsePort(process.env.PI_BROWSER_HOST_PORT);
  const token = process.env.PI_BROWSER_TOKEN;
  const sessionToken = process.env.PI_BROWSER_SESSION_TOKEN;
  const projectId = process.env.PI_BROWSER_SESSION_PROJECT_ID;
  const threadId = process.env.PI_BROWSER_SESSION_THREAD_ID;
  if (port === undefined || !token || !sessionToken || !projectId || !threadId) {
    return failure("Desktop embedded-browser host is not ready");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPEN_BROWSER_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-desktop-browser-token": token,
        "x-desktop-browser-session-token": sessionToken,
        "x-desktop-browser-session-project-id": projectId,
        "x-desktop-browser-session-thread-id": threadId,
      },
      body: JSON.stringify({ method: "openTab", params: { url } }),
      signal: controller.signal,
    });
    const body = (await response.json()) as unknown;
    const error = browserRpcError(body);
    if (!response.ok || error) return failure(error ?? `Browser host error (HTTP ${response.status})`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`Failed to open Desktop embedded browser: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

function validateUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? undefined : "Only http/https URLs are supported";
  } catch {
    return "Invalid browser URL";
  }
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

function browserRpcError(value: unknown): string | undefined {
  if (!isRecord(value)) return "Browser host returned an invalid response";
  if (value.ok === false && typeof value.error === "string") return value.error;
  if (value.ok !== true) return "Browser host returned a failure response";
  const data = value.data;
  if (isRecord(data) && data.ok === false && typeof data.error === "string") return data.error;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}