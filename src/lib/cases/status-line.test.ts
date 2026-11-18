import { test } from "node:test";
import assert from "node:assert/strict";
import { historyText, whenText } from "./status-line.ts";
import type { CaseStatusLine } from "./transitions.functions.ts";

type Last = NonNullable<CaseStatusLine["last"]>;
const now = new Date();
const base: Last = {
  field: "phase",
  fromStatus: "active",
  fromPhase: "deep_analysis",
  toPhase: "committee",
  toStatus: "active",
  occurredAt: now.toISOString(),
  actorName: "Maja Holm",
  actorType: "user",
  reasons: ["Stærkt team"],
  note: null,
  undone: false,
};
const line = (last: Partial<Last> | null): CaseStatusLine => ({
  last: last ? { ...base, ...last } : null,
  createdAt: now.toISOString(),
  createdByName: "Jonas Berg",
});

test("a phase move is named by its phase, not as Genoptaget (harden A)", () => {
  assert.equal(historyText(line({})), "Sendt til komité i dag af Maja Holm: Stærkt team");
  assert.equal(
    historyText(line({ toPhase: "screening", reasons: [] })),
    "Flyttet til screening i dag af Maja Holm",
  );
});

test("komité from På hold is named by the phase, not Genoptaget (harden N4)", () => {
  assert.equal(
    historyText(
      line({ field: "status", fromStatus: "on_hold", fromPhase: "screening", reasons: [] }),
    ),
    "Sendt til komité i dag af Maja Holm",
  );
});

test("a status move is named by its status", () => {
  assert.equal(
    historyText(line({ field: "status", toStatus: "on_hold", reasons: ["Afventer milepæl"] })),
    "Sat på hold i dag af Maja Holm: Afventer milepæl",
  );
  assert.equal(
    historyText(
      line({
        field: "status",
        fromStatus: "on_hold",
        fromPhase: "committee",
        reasons: [],
      }),
    ),
    "Genoptaget i dag af Maja Holm",
  );
  assert.equal(historyText(line({ undone: true })), "Fortrudt i dag af Maja Holm");
  assert.equal(historyText(line(null)), "Oprettet i dag af Jonas Berg");
});

test("leaving Besluttet reads Genåbnet, whichever phase it returns to (harden F1)", () => {
  // The rows transition_case writes (0039): field status, from decided, to the phase before
  // the decision (Genåbn) or to Dyb analyse (Genåbn i dyb analyse).
  for (const [fromStatus, toPhase] of [
    ["closed", "committee"],
    ["invested", "committee"],
    ["closed", "deep_analysis"],
    ["invested", "screening"],
  ] as const) {
    assert.equal(
      historyText(
        line({ field: "status", fromStatus, fromPhase: "decided", toPhase, reasons: [] }),
      ),
      "Genåbnet i dag af Maja Holm",
    );
  }
});

test("dates read 18. sep, not 18. sep. or 18 sep.", () => {
  assert.equal(whenText("2026-09-18T10:00:00Z", new Date("2026-09-30T10:00:00Z")), "18. sep");
});
