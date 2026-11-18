/** Tests of the change history's wording. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeHistoryEvent,
  HISTORY_ACTIONS,
  isHistoryAction,
  withoutUndone,
  type AuditRow,
} from "./change-history.ts";

test("every action in the whitelist has a plain Danish line", () => {
  for (const action of HISTORY_ACTIONS) {
    const line = describeHistoryEvent(action, {});
    assert.ok(line && line.length > 5, action);
  }
});

test("autosaves and unknown events are not part of the history", () => {
  assert.equal(isHistoryAction("fund_config_draft_saved"), false);
  assert.equal(describeHistoryEvent("fund_config_draft_saved", { weight_total: 100 }), null);
  assert.equal(describeHistoryEvent("member_invited", {}), null);
});

test("draft and publish lines carry the version when the event has it", () => {
  assert.equal(
    describeHistoryEvent("fund_config_draft_created", { version: 4 }),
    "Kladde v4 er oprettet.",
  );
  assert.equal(
    describeHistoryEvent("fund_config_activated", { version: 4 }),
    "Version 4 er udgivet.",
  );
  assert.equal(describeHistoryEvent("fund_config_activated", null), "En ny version er udgivet.");
});

test("an AI level change names the level, never a cap in kroner or the raw payload (T-678)", () => {
  const line = describeHistoryEvent("fund_ai_settings_changed", {
    before: {
      screeningTier: "medium",
      deepTier: "medium",
      screeningCapDkk: null,
      deepCapDkk: null,
    },
    after: { screeningTier: "heavy", deepTier: "medium", screeningCapDkk: 12, deepCapDkk: null },
  });
  assert.ok(line);
  assert.match(line, /Screening: Middel → Tung/);
  assert.doesNotMatch(line, /kr\.|loft/);
  assert.doesNotMatch(line, /deepTier|screeningTier|\{/);
  assert.equal(
    describeHistoryEvent("fund_ai_settings_changed", { before: {}, after: {} }),
    "AI-niveauet er gemt.",
  );
});

test("a proposal line says nothing was changed until it is laid in", () => {
  assert.match(
    describeHistoryEvent("fund_config_proposal_created", { costUsd: 0.01 })!,
    /Intet er ændret/,
  );
});

const row = (
  id: string,
  action: string,
  occurredAt: string,
  extra: Partial<AuditRow> = {},
): AuditRow => ({
  id,
  action,
  actorId: "u1",
  entityId: "e1",
  payload: null,
  occurredAt,
  ...extra,
});

test("a change logged first and then refused is left out, with its 'not saved' row", () => {
  const rows = [
    row("4", "fund_config_proposal_not_applied", "2026-10-04T10:00:03Z"),
    row("3", "fund_config_proposal_applied", "2026-10-04T10:00:02Z"),
    row("2", "fund_config_proposal_applied", "2026-10-04T09:00:00Z"),
    row("1", "fund_config_activated", "2026-10-04T08:00:00Z"),
  ];
  assert.deepEqual(
    withoutUndone(rows).map((r) => r.id),
    ["2", "1"],
  );
});

test("the AI level and reason codes are cancelled only for the same person and item", () => {
  const rows = [
    row("6", "reason_code_not_saved", "2026-10-04T10:00:06Z", {
      entityId: "r1",
      payload: { action: "reason_code_changed" },
    }),
    row("5", "reason_code_changed", "2026-10-04T10:00:05Z", { entityId: "r2" }),
    row("4", "reason_code_changed", "2026-10-04T10:00:04Z", { entityId: "r1" }),
    row("3", "fund_ai_settings_not_saved", "2026-10-04T10:00:03Z", { actorId: "u2" }),
    row("2", "fund_ai_settings_changed", "2026-10-04T10:00:02Z", { actorId: "u1" }),
    row("1", "fund_ai_settings_changed", "2026-10-04T10:00:01Z", { actorId: "u2" }),
  ];
  assert.deepEqual(
    withoutUndone(rows).map((r) => r.id),
    ["5", "2"],
  );
});

test("the document import is not called saved in the draft", () => {
  assert.match(describeHistoryEvent("fund_document_interpreted", {})!, /gemmes først med kladden/);
});

test("a 'not saved' row with the id of its change cancels exactly that row", () => {
  // Two tabs: A and B logged, A failed. Without the id the nearest (B) would be cancelled.
  const rows = [
    row("3", "fund_ai_settings_not_saved", "2026-10-04T10:00:03Z", { payload: { undoes: "1" } }),
    row("2", "fund_ai_settings_changed", "2026-10-04T10:00:02Z"),
    row("1", "fund_ai_settings_changed", "2026-10-04T10:00:01Z"),
  ];
  assert.deepEqual(
    withoutUndone(rows).map((r) => r.id),
    ["2"],
  );
});
