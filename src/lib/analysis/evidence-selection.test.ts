import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCardFigureEvidence,
  selectPromptEvidence,
  withCardFigureEvidence,
} from "./evidence-selection.ts";

function row(id: string, type: string, collectedAt: string, match = "confirmed") {
  return {
    id,
    claim: id,
    collected_at: collectedAt,
    sources: { source_type: type, entity_match_status: match },
  };
}

test("only the newest founder-check batch reaches the prompt", () => {
  const rows = [
    row("new-a", "founder_check", "2026-09-20T10:00:00Z"),
    row("new-b", "founder_check", "2026-09-20T10:00:00Z"),
    row("old-a", "founder_check", "2026-09-01T10:00:00Z"),
  ];
  const ids = selectPromptEvidence(rows, 10).map((item) => item["id"]);
  assert.deepEqual(ids.sort(), ["new-a", "new-b"]);
});

test("a retired CVR batch does not hide the re-confirmed older batch", () => {
  const rows = [
    row("cvr-b", "cvr_stamdata", "2026-09-20T10:00:00Z", "unconfirmed"),
    row("cvr-a", "cvr_stamdata", "2026-09-01T10:00:00Z"),
  ];
  const ids = selectPromptEvidence(rows, 10).map((item) => item["id"]);
  assert.deepEqual(ids, ["cvr-a"]);
});

test("a foreign registry's statements count like CVR's: retired and duplicate years are dropped", () => {
  const fact = (id: string, claim: string, match = "confirmed") => ({
    ...row(id, "registry_regnskab", "2026-10-07T10:00:00Z", match),
    claim,
  });
  const rows = [
    fact("new", "Egenkapital: 37.301.607 NOK for perioden 2025-01-01 til 2025-12-31."),
    fact("dup", "Egenkapital: 37.301.000 NOK for perioden 2025-01-01 til 2025-12-31."),
    fact("wrong", "Årets resultat: 1 NOK for perioden 2025-01-01 til 2025-12-31.", "unconfirmed"),
    ...Array.from({ length: 30 }, (_, index) =>
      row(`news-${index}`, "public_research:news", "2026-10-08T10:00:00Z"),
    ),
  ];
  const ids = selectPromptEvidence(rows, 20).map((item) => item["id"]);
  // The registry's figure keeps its official slot ahead of newer news; the duplicate year and
  // the rejected company's figure never reach the prompt.
  assert.ok(ids.includes("new"));
  assert.ok(!ids.includes("dup"));
  assert.ok(!ids.includes("wrong"));
});

test("the research's card figures reach the specialists beside the sheet (T-761)", () => {
  const research = (id: string, claim: string) => ({
    id,
    claim,
    document_id: null,
    sources: { source_type: "public_research:industry_report" },
  });
  const market = research(
    "m",
    "One report estimates a USD 820 million automated sports-camera market in 2025, forecasting USD 2.37 billion by 2034.",
  );
  const onlyYear = research("y", "The market was described in 2021 as growing.");
  const noTopic = research("n", "The founder wrote 3 blog posts.");
  const website = {
    id: "w",
    claim: "12,000 clubs",
    document_id: null,
    sources: { source_type: "company_website" },
  };
  assert.equal(isCardFigureEvidence(market), true);
  assert.equal(isCardFigureEvidence(onlyYear), false);
  assert.equal(isCardFigureEvidence(noTopic), false);
  assert.equal(isCardFigureEvidence(website), false);
  const rows = withCardFigureEvidence([website], [website, market, onlyYear, noTopic]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["w", "m"],
  );
});

test("the case's other files never push the deck out of the prompt (T-789)", () => {
  const page = (id: string, kind: string, collectedAt: string) => ({
    id,
    claim: id,
    collected_at: collectedAt,
    document_id: `doc-${kind}`,
    documents: { file_name: `${kind}.pdf`, kind },
    sources: null,
  });
  // A 25-page deck, then a 60-page annual report uploaded later (newer rows).
  const rows = [
    ...Array.from({ length: 60 }, (_, index) =>
      page(`report-${index}`, "financials", `2026-10-10T10:${String(index).padStart(2, "0")}:00Z`),
    ).reverse(),
    ...Array.from({ length: 25 }, (_, index) =>
      page(`deck-${index}`, "pitch_deck", `2026-10-01T10:${String(index).padStart(2, "0")}:00Z`),
    ).reverse(),
  ];
  const ids = selectPromptEvidence(rows, 60).map((item) => String(item["id"]));
  assert.equal(ids.filter((id) => id.startsWith("deck-")).length, 25);
  assert.equal(ids.filter((id) => id.startsWith("report-")).length, 35);
});
