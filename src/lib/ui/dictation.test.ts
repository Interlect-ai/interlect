import assert from "node:assert/strict";
import { test } from "node:test";
import { appendDictated } from "./dictation.ts";

test("a dictated phrase joins the draft with one space (T-641)", () => {
  assert.equal(appendDictated("", " hvilke cases "), "hvilke cases");
  assert.equal(appendDictated("Vis", "mig seed"), "Vis mig seed");
  assert.equal(appendDictated("Vis ", "mig"), "Vis mig");
  assert.equal(appendDictated("Vis", "  "), "Vis");
});
