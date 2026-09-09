#!/usr/bin/env node
// Fetch marketplace discovery and print the endpoint identity.
//
// Usage:
//   node discover.mjs <publicBaseUrl>
//
// `apiRoot` already ends in /v1 - never append another /v1. The configured
// public base URL is the trust boundary; discovery is not cryptographically
// authenticated.

const BASE = process.argv[2];
if (!BASE) {
  console.error("usage: node discover.mjs <publicBaseUrl>");
  process.exit(2);
}
const res = await fetch(`${BASE.replace(/\/$/, "")}/.well-known/meta-agent-marketplace.json`);
if (!res.ok) {
  console.error(`discovery failed: ${res.status}`, await res.text());
  process.exit(1);
}
const env = await res.json();
const data = env && typeof env === "object" && "data" in env
  ? typeof env.data === "string"
    ? JSON.parse(env.data)
    : env.data
  : env;
if (!data || typeof data !== "object") {
  console.error("discovery response is missing an object");
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      baseUrl: BASE,
      apiRoot: data.apiRoot,
      marketplaceId: data.marketplaceId,
      protocolVersion: data.protocolVersion,
    },
    null,
    2,
  ),
);
