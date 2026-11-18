/**
 * Brain's server texts follow the language in scope (the fund's, for the worker; the
 * page's, for a request), and Danish is unchanged outside a scope. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLanguage } from "../i18n/language-scope.server.ts";
import { answerNoteBody } from "./answer-note.ts";
import { incompleteNote, stoppedNote } from "./chat/engine.server.ts";
import { toolStepText, webQueryStepText, writingStepText } from "./chat/prompt.ts";
import { detectFileKind } from "./ingest/file-kind.ts";
import { MAPPING_FIELDS, validMapping, type HistoryMapping } from "./ingest/history.ts";
import { duplicateInsight, type DuplicatePair } from "./nightly.ts";
import { computedSections, pageDate, periodLabel } from "./pages.ts";

const en = <T>(work: () => T) => withLanguage("en", async () => work());

test("a refused file says why in the scope's language; Danish outside a scope", async () => {
  const empty = new Uint8Array();
  assert.deepEqual(detectFileKind(empty, "a.pdf"), { ok: false, reason: "Filen er tom." });
  assert.deepEqual(await en(() => detectFileKind(empty, "a.pdf")), {
    ok: false,
    reason: "The file is empty.",
  });
  const program = new Uint8Array([0x4d, 0x5a, 0, 0]);
  const refused = await en(() => detectFileKind(program, "a.pdf"));
  assert.equal(
    refused.ok ? null : refused.reason,
    "The file is a program (Windows), not a document.",
  );
  const danish = detectFileKind(program, "a.pdf");
  assert.equal(
    danish.ok ? null : danish.reason,
    "Filen er et program (Windows), ikke et dokument.",
  );
});

test("the history guide's column check follows the language", async () => {
  const mapping = Object.fromEntries(MAPPING_FIELDS.map((field) => [field, null])) as Record<
    (typeof MAPPING_FIELDS)[number],
    null
  > satisfies HistoryMapping;
  assert.equal(validMapping(mapping, 3), "Vælg kolonnen med selskabets navn.");
  assert.equal(
    await en(() => validMapping(mapping, 3)),
    "Choose the column with the company's name.",
  );
});

test("a page's dates, headings and computed lines are written in the fund's language", async () => {
  assert.equal(pageDate("2026-03-12T10:00:00Z"), "12. mar 2026");
  assert.equal(await en(() => pageDate("2026-03-12T10:00:00Z")), "12 Mar 2026");
  assert.equal(await en(() => periodLabel("2025-03-12", null)), "from 12 Mar 2025");
  const data = {
    cases: [
      {
        caseId: "c1",
        createdAt: "2025-02-01T09:00:00+00:00",
        phase: "decided",
        decision: "reject",
        decidedAt: "2025-03-12T10:00:00+00:00",
        reasons: ["Too early"],
      },
      { caseId: "c2", createdAt: "2026-09-01T09:00:00+00:00", phase: "screening" },
    ],
    historical: [{ decidedOn: null, kind: "invest", reasons: [] }],
  };
  const danish = computedSections("company", data);
  assert.equal(danish[0]?.heading, "Vores historik");
  assert.match(danish[0]?.body_md ?? "", /Kasseret 12\. mar 2025 · Too early/);
  assert.match(danish[0]?.body_md ?? "", /Åben \(screening\)/);
  assert.match(danish[0]?.body_md ?? "", /Ukendt år · Investeret \(før Interlect\)/);
  const english = await en(() => computedSections("company", data));
  assert.equal(english[0]?.heading, "Our history");
  assert.match(english[0]?.body_md ?? "", /Discarded 12 Mar 2025 · Too early/);
  assert.match(english[0]?.body_md ?? "", /Open \(screening\)/);
  assert.match(english[0]?.body_md ?? "", /Unknown year · Invested \(before Interlect\)/);
  const stats = await en(() => computedSections("fund_overview", { stats: { facts: 1234 } }));
  assert.equal(stats[0]?.heading, "Brain in numbers");
  assert.equal(stats[0]?.body_md, "- Active facts: 1,234");
});

test("the merge question in the feed follows the worker's language", async () => {
  const entity = (id: string, name: string) => ({ id, name, type: "company" as const, key: name });
  const pair: DuplicatePair = {
    a: entity("e0000000-0000-4000-8000-000000000001", "Nordlys"),
    b: entity("e0000000-0000-4000-8000-000000000002", "Nordlys ApS"),
    trigram: 0.9,
    cosine: null,
  };
  const danish = duplicateInsight("f", pair, { kind: "same", confidence: 0.92 });
  assert.equal(danish.title, 'Er "Nordlys" og "Nordlys ApS" det samme?');
  assert.match(String(danish.body_md), /det samme\. Læg dem sammen/);
  const english = await en(() => duplicateInsight("f", pair, { kind: "same", confidence: 0.92 }));
  assert.equal(english.title, 'Are "Nordlys" and "Nordlys ApS" the same?');
  assert.match(String(english.body_md), /the same\. Merge them/);
});

test("a saved answer and the chat's steps and notes follow the language", async () => {
  const input = { question: "Hvorfor?", answer: "Svar.", citations: [] };
  assert.equal(answerNoteBody(input), "Fra Brain\nSpørgsmål: Hvorfor?\n\nSvar.");
  assert.equal(await en(() => answerNoteBody(input)), "From Brain\nQuestion: Hvorfor?\n\nSvar.");
  assert.equal(toolStepText("get_case", "da"), "Læser casen");
  assert.equal(toolStepText("get_case", "en"), "Reading the case");
  assert.equal(toolStepText("unknown_tool", undefined), "Leder i jeres data");
  assert.equal(webQueryStepText("en", "Acme funding"), "Searching the web: Acme funding");
  assert.equal(webQueryStepText("da", "Acme funding"), "Søger på nettet: Acme funding");
  assert.equal(writingStepText(undefined), "Skriver svaret");
  assert.equal(stoppedNote("en"), "(Stopped before the answer was finished.)");
  assert.equal(incompleteNote(undefined), incompleteNote("da"));
});
