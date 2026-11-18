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

test("a self-hosted installation closes them everywhere with INTERLECT_INTERNAL_PAGES=off", () => {
  assert.equal(internalPagesEnabled({ INTERLECT_INTERNAL_PAGES: "off" }), false);
  assert.equal(
    internalPagesEnabled({ VERCEL_ENV: "preview", INTERLECT_INTERNAL_PAGES: "off" }),
    false,
  );
  assert.equal(
    internalPagesEnabled({ VERCEL_ENV: "production", INTERLECT_INTERNAL_PAGES: "OFF" }),
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
