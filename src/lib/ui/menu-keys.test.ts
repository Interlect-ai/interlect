import { test } from "node:test";
import assert from "node:assert/strict";
import { MENU_KEY_GRACE_MS, ignoreMenuKey } from "./menu-keys.ts";

test("a double or held Enter right after opening never chooses an item (harden E9)", () => {
  // Two Enters 60 ms apart: the second lands on the first item, "Kør screening".
  assert.equal(ignoreMenuKey("Enter", false, 60), true);
  assert.equal(ignoreMenuKey(" ", false, 120), true);
  // A held key repeats, whenever it happens.
  assert.equal(ignoreMenuKey("Enter", true, 2_000), true);
});

test("a deliberate choice and the arrow keys still work", () => {
  assert.equal(ignoreMenuKey("Enter", false, MENU_KEY_GRACE_MS), false);
  assert.equal(ignoreMenuKey("Enter", false, 900), false);
  assert.equal(ignoreMenuKey("ArrowDown", false, 10), false);
  assert.equal(ignoreMenuKey("Escape", true, 10), false);
});
