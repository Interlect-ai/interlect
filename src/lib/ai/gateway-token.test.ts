import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { gatewayToken } from "./gateway-token.ts";

// How Vercel hands a function its request context (@vercel/oidc's getContext reads this).
const CONTEXT = Symbol.for("@vercel/request-context");
const globals = globalThis as unknown as Record<symbol, unknown>;
const saved = {
  key: process.env["AI_GATEWAY_API_KEY"],
  oidc: process.env["VERCEL_OIDC_TOKEN"],
};

function withRequestHeaders(headers: Record<string, string>) {
  globals[CONTEXT] = { get: () => ({ headers }) };
}

afterEach(() => {
  delete globals[CONTEXT];
  for (const [name, value] of [
    ["AI_GATEWAY_API_KEY", saved.key],
    ["VERCEL_OIDC_TOKEN", saved.oidc],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("an AI Gateway key wins (staging)", () => {
  process.env["AI_GATEWAY_API_KEY"] = "vck_key";
  withRequestHeaders({ "x-vercel-oidc-token": "oidc_from_request" });
  assert.equal(gatewayToken(), "vck_key");
});

test("without a key, the OIDC token comes from the request on Vercel (T-220)", () => {
  delete process.env["AI_GATEWAY_API_KEY"];
  delete process.env["VERCEL_OIDC_TOKEN"];
  withRequestHeaders({ "x-vercel-oidc-token": "oidc_from_request" });
  assert.equal(gatewayToken(), "oidc_from_request");
});

test("locally the OIDC token from vercel env pull is used", () => {
  delete process.env["AI_GATEWAY_API_KEY"];
  process.env["VERCEL_OIDC_TOKEN"] = "oidc_from_env";
  assert.equal(gatewayToken(), "oidc_from_env");
});

test("neither: undefined, so the caller's own 'no gateway access' error is shown", () => {
  delete process.env["AI_GATEWAY_API_KEY"];
  delete process.env["VERCEL_OIDC_TOKEN"];
  assert.equal(gatewayToken(), undefined);
});
