import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditPayloadWithoutAmounts } from "./audit-payload.ts";

test("D61 d (T-1070): the audit log's answer carries no amounts in kroner", () => {
  const payload = {
    before: { aiTier: "light", screeningCapDkk: 5, deepCapDkk: 40, monthlyCapDkk: null },
    after: { aiTier: "standard", screeningCapDkk: 8, deepCapDkk: 60, monthlyCapDkk: 500 },
    changes: [{ field: "monthly", amount_dkk: 500, label: "Month" }],
    reason: "Mere plads",
  };
  assert.deepEqual(auditPayloadWithoutAmounts(payload), {
    before: { aiTier: "light" },
    after: { aiTier: "standard" },
    changes: [{ field: "monthly", label: "Month" }],
    reason: "Mere plads",
  });
  assert.deepEqual(auditPayloadWithoutAmounts(null), {});
  assert.deepEqual(auditPayloadWithoutAmounts([1, 2]), {});
});

test("D61 d (T-1070): listAuditEvents sends the payload through the filter", () => {
  const source = readFileSync(new URL("./access.functions.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("export const listAuditEvents"));
  const body = handler.slice(0, handler.indexOf("\nexport const "));
  assert.match(body, /payload: auditPayloadWithoutAmounts\(row\.payload\)/);
  assert.doesNotMatch(body, /payload: row\.payload \?\? \{\}/);
});
