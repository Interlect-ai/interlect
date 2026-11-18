import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reasonCodeFieldsSchema,
  slugifyReasonCode,
  uniqueReasonCode,
} from "./reason-code-rules.ts";

const DB_PATTERN = /^[a-z][a-z0-9_]{1,59}$/;

test("a label becomes a key the database accepts", () => {
  for (const label of [
    "For tidligt",
    "Mangler Sæt-ind på ørerne",
    "  Åbent!  ",
    "3D-print",
    "x",
    "!!!",
    "A".repeat(200),
  ]) {
    const code = slugifyReasonCode(label);
    assert.match(code, DB_PATTERN, `${label} -> ${code}`);
  }
  assert.equal(slugifyReasonCode("Uden for mandatet"), "uden_for_mandatet");
  assert.equal(slugifyReasonCode("Åbent for ændringer"), "aabent_for_aendringer");
});

test("a taken key gets a number instead of overwriting another reason", () => {
  const taken = new Set(["for_tidligt", "for_tidligt_2"]);
  assert.equal(uniqueReasonCode("For tidligt", taken), "for_tidligt_3");
  assert.equal(uniqueReasonCode("Ny årsag", taken), "ny_aarsag");
  const long = "a".repeat(60);
  const code = uniqueReasonCode(long, new Set([slugifyReasonCode(long)]));
  assert.match(code, DB_PATTERN);
  assert.ok(code.endsWith("_2"));
});

test("the fields are validated like the table's own checks", () => {
  const ok = {
    label: "For tidligt",
    groupKey: "timing",
    appliesTo: ["hold"],
    revisit: true,
    sortOrder: 3,
  };
  assert.equal(reasonCodeFieldsSchema.safeParse(ok).success, true);
  for (const bad of [
    { ...ok, label: "" },
    { ...ok, label: "x".repeat(121) },
    { ...ok, groupKey: "other_group" },
    { ...ok, appliesTo: [] },
    { ...ok, appliesTo: ["delete"] },
    { ...ok, sortOrder: -1 },
  ]) {
    assert.equal(reasonCodeFieldsSchema.safeParse(bad).success, false);
  }
});
