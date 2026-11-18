/** The case brief's ordering. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import { briefSeverity, severityLabel, sortBrief, type BriefRow } from "./case-brief.ts";

const row = (kind: string, content: string, at: string | null = null): BriefRow => ({
  kind,
  title: null,
  content,
  at,
});

test("risk level, finding type and evidence status set the severity", () => {
  assert.equal(briefSeverity(row("risk", "[marked · kritisk] Kunden er væk.")), 100);
  assert.equal(briefSeverity(row("risk", "[team · høj] Founder går.")), 90);
  assert.equal(briefSeverity(row("risk", "[team · lav] Lille.")), 30);
  assert.equal(briefSeverity(row("finding", "[marked · svaghed] Lille marked.")), 70);
  assert.equal(briefSeverity(row("finding", "[team · styrke] Stærkt team.")), 20);
  assert.equal(briefSeverity(row("evidence", "ARR: 2,4 mio. kr. Status: modstridende.")), 85);
  assert.equal(briefSeverity(row("evidence", "ARR: 2,4 mio. kr. Status: verificeret.")), 30);
});

test("a row without a label gets the weight of its kind", () => {
  assert.equal(briefSeverity(row("risk", "Ingen mærkat.")), 60);
  assert.equal(briefSeverity(row("case_note", "En note.")), 28);
  assert.equal(briefSeverity(row("something_else", "?")), 0);
});

test("the brief is sorted by seriousness, then newest, and is stable", () => {
  const rows = [
    row("finding", "[a · styrke] x", "2026-01-01"),
    row("risk", "[a · kritisk] y", "2026-01-01"),
    row("evidence", "c Status: modstridende.", "2026-02-01"),
    row("risk", "[a · kritisk] z", "2026-03-01"),
    row("case_note", "note", "2026-03-01"),
  ];
  assert.deepEqual(
    sortBrief(rows).map((r) => r.content),
    ["[a · kritisk] z", "[a · kritisk] y", "c Status: modstridende.", "note", "[a · styrke] x"],
  );
});

test("severity labels", () => {
  assert.equal(severityLabel(100), "kritisk");
  assert.equal(severityLabel(85), "høj");
  assert.equal(severityLabel(60), "middel");
  assert.equal(severityLabel(20), "lav");
});
