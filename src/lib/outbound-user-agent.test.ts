import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_USER_AGENT, outboundUserAgent } from "./outbound-user-agent.ts";

test("an operator's own User-Agent wins", () => {
  assert.equal(
    outboundUserAgent({
      INTERLECT_USER_AGENT: " Fund X (+https://x.example) ",
      VERCEL_PROJECT_PRODUCTION_URL: "a.vercel.app",
    }),
    "Fund X (+https://x.example)",
  );
});

test("otherwise the installation's own production address is named", () => {
  assert.equal(
    outboundUserAgent({ VERCEL_PROJECT_PRODUCTION_URL: "fund-x.vercel.app" }),
    `${BASE_USER_AGENT} (+https://fund-x.vercel.app)`,
  );
});

test("without either, no address at all (never a fixed one)", () => {
  assert.equal(outboundUserAgent({}), BASE_USER_AGENT);
  assert.equal(
    outboundUserAgent({ VERCEL_PROJECT_PRODUCTION_URL: "bad host/../" }),
    BASE_USER_AGENT,
  );
});
