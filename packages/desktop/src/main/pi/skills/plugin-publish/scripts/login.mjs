#!/usr/bin/env node
// Marketplace login: authenticate and write an expiring session record to a
// 0600 file.
//
// Usage:
//   node login.mjs <apiRoot> <username> <passwordFile> <tokenOut> [publisherId]
//
// Secrets never appear on the command line: the password is read from
// passwordFile (create it with owner-only permissions, delete it afterwards).
// The session record contains only the bearer token and server-provided
// expiresAt; login-web.mjs can reuse it until it expires.
import { readFileSync } from "node:fs";
import { normalizeApiRoot, writeSession } from "./session.mjs";

async function main() {
  const [apiRootArg, user, passFile, tokenOut, publisherId] = process.argv.slice(2);
  if (!apiRootArg || !user || !passFile || !tokenOut) {
    console.error("usage: node login.mjs <apiRoot> <username> <passwordFile> <tokenOut> [publisherId]");
    process.exitCode = 2;
    return;
  }
  const apiRoot = normalizeApiRoot(apiRootArg);
  if (!apiRoot) {
    console.error("usage: node login.mjs <apiRoot> <username> <passwordFile> <tokenOut> [publisherId]");
    process.exitCode = 2;
    return;
  }

  const password = readFileSync(passFile, "utf8").trim();
  if (!password) throw new Error("empty password file");

  const loginRes = await fetch(`${apiRoot}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password }),
  });
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  const authData = await loginRes.json();
  const { token, expiresAt } = authData;
  if (!token || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("login response missing a valid token expiry");
  }

  try {
    writeSession(tokenOut, { token, expiresAt });
  } catch (err) {
    throw new Error(`cannot write token file: ${err.message}`);
  }

  console.log("authenticated:", JSON.stringify({ username: user }));
  if (publisherId) {
    console.log(`publish.mjs will create publisher ${publisherId} if it is not claimed yet`);
  }
  console.log(`LOGIN_OK session written to ${tokenOut} (expires: ${new Date(expiresAt).toISOString()})`);
}

main().catch((err) => {
  console.error("LOGIN FAILED:", err.message);
  process.exitCode = 1;
});
