import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeTheses,
  pickDefaultThesis,
  thesisAllowsNewAnalysis,
  thesisRefusal,
  thesisRowFrom,
  type ThesisRow,
} from "./theses.ts";

const row = (
  id: string,
  status: ThesisRow["status"],
  isDefault = false,
  createdAt = id,
): ThesisRow => ({
  id,
  name: id,
  status,
  isDefault,
  createdAt,
  archivedAt: status === "archived" ? createdAt : null,
});

test("the default thesis wins, also when it is not the oldest", () => {
  const rows = [row("a", "active"), row("b", "active", true), row("c", "draft")];
  assert.equal(pickDefaultThesis(rows)?.id, "b");
});

test("without a default: the oldest active, never an archived one", () => {
  const rows = [row("a", "archived"), row("c", "active"), row("b", "draft"), row("d", "active")];
  assert.equal(pickDefaultThesis(rows)?.id, "c");
});

test("a new team whose first thesis is a draft uses that draft", () => {
  assert.equal(pickDefaultThesis([row("x", "draft")])?.id, "x");
  assert.equal(pickDefaultThesis([row("x", "archived")]), null);
  assert.equal(pickDefaultThesis([]), null);
});

test("active theses: default first, then by age; drafts and archived left out", () => {
  const rows = [
    row("c", "active"),
    row("a", "active"),
    row("b", "active", true),
    row("d", "draft"),
  ];
  assert.deepEqual(
    activeTheses(rows).map((entry) => entry.id),
    ["b", "a", "c"],
  );
});

test("only an archived thesis blocks a new analysis", () => {
  assert.equal(thesisAllowsNewAnalysis("active"), true);
  assert.equal(thesisAllowsNewAnalysis("draft"), true);
  assert.equal(thesisAllowsNewAnalysis("archived"), false);
});

test("a database row is read safely", () => {
  assert.deepEqual(
    thesisRowFrom({ id: "t", name: null, status: "weird", is_default: null, created_at: null }),
    { id: "t", name: "", status: "draft", isDefault: false, createdAt: "", archivedAt: null },
  );
});

test("refusals from the database map to the person's message", () => {
  assert.equal(thesisRefusal("Et team skal have mindst én aktiv tese."), "lastActive");
  assert.equal(thesisRefusal("Der findes allerede en tese med det navn."), "nameTaken");
  assert.equal(thesisRefusal("Kun en Admin eller Lead kan ændre teser."), "configureOnly");
  assert.equal(thesisRefusal("Tesen har ingen udgivet version at kopiere."), "copyNeedsPublished");
  assert.equal(thesisRefusal("Tesen er ikke arkiveret."), "notArchived");
  assert.equal(thesisRefusal("Tesen er allerede arkiveret."), "alreadyArchived");
  assert.equal(thesisRefusal("connection reset"), null);
  assert.equal(thesisRefusal(undefined), null);
});
