/** Test af sidernes visning, diff og rettelse. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkEditBody,
  cleanSearch,
  diffLines,
  diffSections,
  pageSnippet,
  shapePageDetail,
  shapePageSummary,
  shapeSections,
} from "./page-view.ts";

const raw = [
  { key: "key_metrics", heading: "Nøgletal", body_md: "ARR 5 mio.", fact_ids: [], computed: true },
  {
    key: "overview",
    heading: "Overblik",
    body_md: "# Selskabet\nBygger **robotter** [f:a1].",
    fact_ids: ["a1"],
    locked_by_user: true,
    updated_at: "2026-10-07T10:00:00Z",
  },
  { heading: "Uden nøgle", body_md: "x" },
  "skrald",
];

test("sektioner: ugyldige poster droppes, felter får sikre standardværdier", () => {
  const sections = shapeSections(raw);
  assert.equal(sections.length, 2);
  assert.equal(sections[0]!.computed, true);
  assert.equal(sections[0]!.locked, false);
  assert.equal(sections[1]!.locked, true);
  assert.deepEqual(sections[1]!.factIds, ["a1"]);
  assert.deepEqual(shapeSections(null), []);
  assert.deepEqual(shapeSections({}), []);
});

test("uddrag: første skrevne sektion uden faktahenvisninger og markdown", () => {
  assert.equal(pageSnippet(shapeSections(raw)), "Selskabet Bygger robotter.");
  assert.equal(pageSnippet([]), "");
  const long = shapeSections([{ key: "a", heading: "A", body_md: "ord ".repeat(100) }]);
  assert.ok(pageSnippet(long, 50).endsWith("…"));
  assert.ok(pageSnippet(long, 50).length <= 50);
});

test("liste: tæller sektioner og låste, og kender brugerens ændring", () => {
  const row = shapePageSummary({
    id: "p1",
    kind: "company",
    title: "Robo A/S",
    version: 3,
    updated_at: "2026-10-07T10:00:00Z",
    updated_by: "user:b1000000-0000-4000-8000-00000000000b",
    sections: raw,
  });
  assert.ok(row);
  assert.equal(row.kindLabel, "Selskab");
  assert.equal(row.sectionCount, 2);
  assert.equal(row.lockedCount, 1);
  assert.equal(row.editedByUser, true);
  assert.equal(shapePageSummary({ title: "uden id" }), null);
});

test("én side: versionerne står med den nyeste først", () => {
  const page = shapePageDetail({ id: "p1", kind: "case", title: "T", version: 2, sections: [] }, [
    { version: 1, sections: [], changed_by: "L4", created_at: "a" },
    { version: 2, sections: [], changed_by: "user:x", change_note: "Rettet", created_at: "b" },
  ]);
  assert.ok(page);
  assert.deepEqual(
    page.versions.map((v) => v.version),
    [2, 1],
  );
  assert.equal(page.versions[0]!.editedByUser, true);
  assert.equal(page.versions[0]!.changeNote, "Rettet");
  assert.equal(page.versions[1]!.changeNote, null);
});

test("diff: samme, tilføjet og fjernet linje", () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nc\nd"), [
    { type: "same", text: "a" },
    { type: "del", text: "b" },
    { type: "same", text: "c" },
    { type: "add", text: "d" },
  ]);
  assert.deepEqual(diffLines("", "ny"), [{ type: "add", text: "ny" }]);
  assert.deepEqual(diffLines("a", "a"), [{ type: "same", text: "a" }]);
});

test("diff pr. sektion: ændret, uændret, tilføjet og fjernet", () => {
  const before = shapeSections([
    { key: "a", heading: "A", body_md: "gammel" },
    { key: "b", heading: "B", body_md: "samme" },
    { key: "c", heading: "C", body_md: "væk" },
  ]);
  const after = shapeSections([
    { key: "a", heading: "A", body_md: "ny" },
    { key: "b", heading: "B", body_md: "samme" },
    { key: "d", heading: "D", body_md: "frisk" },
  ]);
  const diff = diffSections(before, after);
  assert.deepEqual(
    diff.map((d) => `${d.key}:${d.status}`),
    ["a:changed", "b:same", "d:added", "c:removed"],
  );
});

test("søgning: tegn, der ændrer et filter, fjernes", () => {
  assert.equal(cleanSearch('robo, (a%) "x" *'), "robo a x");
  assert.equal(cleanSearch("  "), "");
  assert.equal(cleanSearch("x".repeat(200)).length, 80);
});

test("rettelse: tom og for lang tekst afvises, ellers trimmes den", () => {
  assert.equal(checkEditBody("   ").ok, false);
  assert.equal(checkEditBody("x".repeat(5001)).ok, false);
  const ok = checkEditBody("  Hej\r\nverden \n");
  assert.deepEqual(ok, { ok: true, body: "Hej\nverden" });
});

test("a page without a title gets the fund's word for it (T-619)", () => {
  assert.equal(shapePageSummary({ id: "p", kind: "company", sections: [] })?.title, "Uden titel");
  const english = shapePageSummary({ id: "p", kind: "company", sections: [] }, "en");
  assert.equal(english?.title, "Untitled");
  assert.notEqual(english?.kindLabel, "Selskab");
});
