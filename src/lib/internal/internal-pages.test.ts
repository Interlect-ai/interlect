import assert from "node:assert/strict";
import { test } from "node:test";
import { internalPagesEnabled } from "./internal-pages.ts";

test("every Vercel deployment closes the internal pages: customers, staging and previews (T-1023)", () => {
  assert.equal(internalPagesEnabled({ VERCEL: "1", VERCEL_ENV: "production" }), false);
  assert.equal(internalPagesEnabled({ VERCEL: "1", VERCEL_ENV: "preview" }), false);
  assert.equal(internalPagesEnabled({ VERCEL_ENV: "preview" }), false);
  assert.equal(internalPagesEnabled({ VERCEL: "1", NODE_ENV: "development" }), false);
});

test("the old switch no longer opens them (T-639's INTERLECT_INTERNAL_PAGES is gone)", () => {
  assert.equal(
    internalPagesEnabled({ VERCEL: "1", VERCEL_ENV: "production", INTERLECT_INTERNAL_PAGES: "on" }),
    false,
  );
  assert.equal(
    internalPagesEnabled({ NODE_ENV: "production", INTERLECT_INTERNAL_PAGES: "on" }),
    false,
  );
});

test("only local development keeps them", () => {
  assert.equal(internalPagesEnabled({ NODE_ENV: "development" }), true);
  assert.equal(internalPagesEnabled({ NODE_ENV: "production" }), false);
  assert.equal(internalPagesEnabled({ NODE_ENV: "test" }), false);
  assert.equal(internalPagesEnabled({}), false);
});
