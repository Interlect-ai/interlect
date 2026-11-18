import assert from "node:assert/strict";
import { test } from "node:test";
import { internalPagesEnabled } from "./internal-pages.ts";

test("customers run production, so the internal pages are closed there (T-639)", () => {
  assert.equal(internalPagesEnabled({ VERCEL_ENV: "production" }), false);
  // A customer installation never has the switch, whatever else it has.
  assert.equal(
    internalPagesEnabled({ VERCEL_ENV: "production", INTERLECT_INTERNAL_PAGES: "yes" }),
    false,
  );
});

test("staging previews, local development and an opened staging production keep them", () => {
  assert.equal(internalPagesEnabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(internalPagesEnabled({}), true);
  assert.equal(
    internalPagesEnabled({ VERCEL_ENV: "production", INTERLECT_INTERNAL_PAGES: "on" }),
    true,
  );
});
