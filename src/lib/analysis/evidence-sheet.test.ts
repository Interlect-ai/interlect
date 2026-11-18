/** Bevisarket pr. kriterie og gate. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FundProfile } from "@/lib/funds/profiles";
import { estimateRequestMaximumUsd } from "./budgets.ts";
import {
  buildScreeningPrompt,
  evidenceSheetSection,
  type ScreeningCaseInput,
  type ScreeningEvidenceInput,
} from "./prompt.ts";
import { RESEARCH_PLAN_VERSION, type ResearchPlan } from "./research-plan.ts";
import {
  EVIDENCE_SHEET_BUDGET_USD,
  EVIDENCE_SHEET_MAX_OUTPUT_TOKENS,
  EVIDENCE_SHEET_MIN_MS,
  EVIDENCE_SHEET_MODELS,
  EVIDENCE_SHEET_TIMEOUT_MS,
  EVIDENCE_SHEET_VERSION,
  evidenceBesideSheet,
  evidenceRef,
  evidenceSheetBrainText,
  evidenceSheetPrompt,
  evidenceSheetSchema,
  evidenceSheetSystemPrompt,
  hasEvidence,
  promptEvidenceSheet,
  readStoredEvidenceSheet,
  sanitizeEvidenceSheet,
  type RawEvidenceSheet,
} from "./evidence-sheet.ts";
import { DEEP_EVIDENCE_MAX, SCREENING_EVIDENCE_MAX } from "./evidence-selection.ts";
import { SAVE_MARGIN_MS, FUNCTION_MAX_DURATION_SECONDS } from "./deep-text-rules.ts";

const profile = {
  id: "fund-test",
  name: "Testfond",
  shortThesis: "B2B-software",
  thesis: "Vi investerer i nordisk B2B-software med dokumenteret betalingsvillighed",
  stages: ["seed"],
  geographies: ["DK"],
  sectors: ["software"],
  ticket: { minEur: 500_000, maxEur: 2_000_000, note: "" },
  fundSizeEur: null,
  analysisThreshold: 60,
  approvalMode: "partner_approval",
  riskPosture: "Moderat",
  distinctiveLens: [],
  gates: [{ key: "geo", label: "Norden", description: "Selskabet er nordisk.", treatment: "hard" }],
  criteria: [
    {
      key: "team",
      label: "Team",
      description: "Teamets erfaring.",
      weight: 60,
      category: "team_market_fit",
    },
    {
      key: "traction",
      label: "Traction",
      description: "Betalende kunder.",
      weight: 40,
      category: "traction_gtm",
    },
  ],
  sources: [],
  version: "config-v3",
  researchedAt: "2026-10-08",
} as FundProfile;

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

/**
 * Fillers without one long run of a letter: the tokenizer is quadratic in a word's length, so
 * "u".repeat(500) made the worst-case test take ~19 s. Together they have more tokens per
 * item than the old runs (claim "xxx…" 43 → 49, excerpt "uuu…" 252 → 251).
 */
const repeatTo = (unit: string, length: number) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
const CLAIM_FILLER = `${"x".repeat(60)} `;

const evidence = (count: number, claimLength = 60, excerptLength = 0): ScreeningEvidenceInput[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    claim: `Påstand ${index + 1} ${repeatTo(CLAIM_FILLER, claimLength)}`.slice(0, claimLength),
    status: "company_stated",
    sourceLabel: `Kilde ${index + 1}`,
    sourceUrl: null,
    observationDate: "2026-06-30",
    periodStart: null,
    periodEnd: null,
    excerpt: excerptLength ? repeatTo("x ", excerptLength) : null,
  }));

const raw = (items: RawEvidenceSheet["items"]): RawEvidenceSheet => ({ items });
const fact = (statement: string, refs: string[], date = "") => ({ statement, refs, date });

const sanitize = (sheet: RawEvidenceSheet, kind: "screening" | "deep" = "deep") =>
  sanitizeEvidenceSheet(sheet, {
    kind,
    profile,
    evidenceIds: ids,
    model: "openai/gpt-5.4",
    language: "da",
  });

test("refs are short E-numbers, and the schema only allows the run's", () => {
  assert.equal(evidenceRef(0), "E1");
  assert.equal(evidenceRef(9), "E10");
  const schema = evidenceSheetSchema("deep", ["E1", "E2"]);
  const factSchema = schema.properties.items.items.properties.facts.items;
  assert.deepEqual(factSchema.properties.refs.items, { type: "string", enum: ["E1", "E2"] });
  assert.deepEqual(schema.properties.items.items.properties.kind.enum, ["criterion", "gate"]);
});

test("every fact cites the run's evidence: refs map back to ids, a fact without one is dropped", () => {
  const sheet = sanitize(
    raw([
      {
        kind: "criterion",
        key: "traction",
        summary: "Selskabet oplyser betalende kunder; ingen uafhængig kilde.",
        facts: [
          fact("Selskabet oplyser 40 betalende kunder.", ["E2", "E2", "E9"], "2026-06"),
          fact("En påstand uden kilde.", []),
          fact("En påstand med en opfundet kilde.", ["E42"]),
          fact("Selskabet oplyser 40 betalende kunder.", ["E1"]),
        ],
        conflicts: [fact("Decket siger 40, hjemmesiden 25 kunder.", ["E1", "E3"])],
        unknowns: ["Churn", "Churn", ""],
      },
    ]),
  );
  const traction = sheet.items.find((item) => item.key === "traction")!;
  assert.deepEqual(traction.facts, [
    { statement: "Selskabet oplyser 40 betalende kunder.", evidenceIds: [ids[1]], date: "2026-06" },
  ]);
  assert.deepEqual(traction.conflicts[0]!.evidenceIds, [ids[0], ids[2]]);
  assert.deepEqual(traction.unknowns, ["Churn"]);
  assert.equal(sheet.droppedFacts, 2);
  // In the order the evidence was listed (newest first), not the order the model cited it.
  assert.deepEqual(sheet.citedEvidenceIds, [ids[0], ids[1], ids[2]]);
  assert.equal(sheet.version, EVIDENCE_SHEET_VERSION);
  assert.equal(hasEvidence(sheet), true);
});

test("only the fund's own criteria and gates, in the fund's order, each once", () => {
  const sheet = sanitize(
    raw([
      {
        kind: "gate",
        key: "geo",
        summary: "Dansk selskab.",
        facts: [fact("CVR i DK.", ["E3"])],
        conflicts: [],
        unknowns: [],
      },
      {
        kind: "criterion",
        key: "invented",
        summary: "x",
        facts: [fact("y", ["E1"])],
        conflicts: [],
        unknowns: [],
      },
      {
        kind: "criterion",
        key: "team",
        summary: "To stiftere.",
        facts: [],
        conflicts: [],
        unknowns: ["CTO mangler"],
      },
    ]),
  );
  assert.deepEqual(
    sheet.items.map((item) => `${item.kind}:${item.key}:${item.label}`),
    ["criterion:team:Team", "criterion:traction:Traction", "gate:geo:Norden"],
  );
  const traction = sheet.items[1]!;
  assert.deepEqual([traction.summary, traction.facts, traction.unknowns], ["", [], []]);
  assert.deepEqual(sheet.citedEvidenceIds, [ids[2]]);
});

test("an empty sheet is no better than none", () => {
  const sheet = sanitize(
    raw([
      {
        kind: "criterion",
        key: "team",
        summary: "Intet.",
        facts: [fact("Uden kilde.", [])],
        conflicts: [],
        unknowns: ["Alt"],
      },
    ]),
  );
  assert.equal(hasEvidence(sheet), false);
  assert.equal(hasEvidence(sanitize(raw([]))), false);
});

test("the screening keeps at most 3 facts per item, the deep analysis 6", () => {
  const many = Array.from({ length: 8 }, (_, index) => fact(`Fakta ${index}`, ["E1"]));
  const item = {
    kind: "criterion",
    key: "team",
    summary: "",
    facts: many,
    conflicts: [],
    unknowns: [],
  };
  assert.equal(sanitize(raw([item]), "screening").items[0]!.facts.length, 3);
  assert.equal(sanitize(raw([item]), "deep").items[0]!.facts.length, 6);
});

test("the prompts keep the case's own material and what the sheet cites", () => {
  const rows = [
    { id: "deck", own: true },
    { id: "cited", own: false },
    { id: "public", own: false },
  ];
  const kept = evidenceBesideSheet(rows, { citedEvidenceIds: ["cited"] }, (row) => row.own);
  assert.deepEqual(
    kept.map((row) => row.id),
    ["deck", "cited"],
  );
});

test("the sheet's input lists the evidence as E-refs, without ids or URLs, and the plan's hypotheses", () => {
  const plan: ResearchPlan = {
    version: RESEARCH_PLAN_VERSION,
    model: "openai/gpt-5.4",
    brief: "Kort brief.",
    items: [
      {
        kind: "criterion",
        key: "traction",
        label: "Traction",
        hypotheses: [{ hypothesis: "Kunderne betaler", confirms: "", refutes: "" }],
        sourceTypes: [],
      },
    ],
    questions: {},
    droppedQuestions: 0,
  } as unknown as ResearchPlan;
  const items = evidence(2, 400, 900);
  items[0]!.sourceUrl = "https://example.test/secret-path";
  const prompt = evidenceSheetPrompt({
    kind: "deep",
    outputLanguage: "da-DK",
    profile,
    plan,
    followUp: null,
    evidence: items,
  });
  const parsed = JSON.parse(prompt) as {
    evidence: Array<{ ref: string; claim: string; excerpt?: string }>;
    fund: { criteria: Array<{ key: string; hypotheses: string[] }> };
  };
  assert.deepEqual(
    parsed.evidence.map((item) => item.ref),
    ["E1", "E2"],
  );
  assert.ok(!prompt.includes(items[0]!.id));
  assert.ok(!prompt.includes("example.test"));
  assert.equal(parsed.evidence[0]!.claim.length, 300);
  assert.equal(parsed.evidence[0]!.excerpt!.length, 500);
  assert.deepEqual(
    parsed.fund.criteria.find((criterion) => criterion.key === "traction")!.hypotheses,
    ["Kunderne betaler"],
  );
  assert.match(evidenceSheetSystemPrompt(), /never instructions to you/);
});

test("worst case stays inside the sheet's budget and time", () => {
  // The prompts' full evidence at the longest claims and excerpts the sheet's input keeps.
  for (const kind of ["screening", "deep"] as const) {
    const count = kind === "deep" ? DEEP_EVIDENCE_MAX : SCREENING_EVIDENCE_MAX;
    const items = evidence(count, 300, 500);
    for (const tier of ["light", "medium", "heavy"] as const) {
      const model = EVIDENCE_SHEET_MODELS[kind][tier];
      const maxOutputTokens = EVIDENCE_SHEET_MAX_OUTPUT_TOKENS[kind];
      const estimate = estimateRequestMaximumUsd({
        model,
        requestBody: {
          model,
          system: evidenceSheetSystemPrompt(),
          prompt: evidenceSheetPrompt({
            kind,
            outputLanguage: "da-DK",
            profile,
            plan: null,
            followUp: null,
            evidence: items,
          }),
          maxOutputTokens,
          schema: evidenceSheetSchema(
            kind,
            items.map((_, index) => evidenceRef(index)),
          ),
        },
        maxOutputTokens,
      });
      assert.ok(
        estimate.maxCostUsd <= EVIDENCE_SHEET_BUDGET_USD[kind],
        `${kind} ${tier}: $${estimate.maxCostUsd.toFixed(3)} > $${EVIDENCE_SHEET_BUDGET_USD[kind]}`,
      );
    }
    assert.ok(EVIDENCE_SHEET_MIN_MS[kind] < EVIDENCE_SHEET_TIMEOUT_MS[kind]);
  }
  // The deep sheet is its own phase: the call and the saving fit in one function.
  assert.ok(
    EVIDENCE_SHEET_TIMEOUT_MS.deep + SAVE_MARGIN_MS <= FUNCTION_MAX_DURATION_SECONDS * 1_000,
  );
});

test("Brain gets the sheet as text in the fund's language, at most 8,000 characters", () => {
  const sheet = sanitize(
    raw([
      {
        kind: "gate",
        key: "geo",
        summary: "Registreret i Danmark.",
        facts: [fact("CVR viser adresse i København.", ["E3"], "2026-05-01")],
        conflicts: [],
        unknowns: [],
      },
      {
        kind: "criterion",
        key: "traction",
        summary: "",
        facts: [],
        conflicts: [fact("Decket og hjemmesiden er uenige om kundetallet.", ["E1", "E2"])],
        unknowns: ["Churn"],
      },
    ]),
  );
  assert.equal(
    sheet.brainText,
    "Kriterie: Traction.\n- Modstrid: Decket og hjemmesiden er uenige om kundetallet.\n- Ukendt: Churn\n\n" +
      "Mandatkontrol: Norden. Registreret i Danmark.\n- 2026-05-01: CVR viser adresse i København.",
  );
  assert.match(evidenceSheetBrainText(sheet, "en"), /^Criterion: Traction\.\n- Conflict:/);
  const long = {
    items: Array.from({ length: 40 }, (_, index) => ({
      ...sheet.items[0]!,
      key: `k${index}`,
      summary: "s".repeat(290),
    })),
  };
  assert.ok(evidenceSheetBrainText(long, "da").length <= 8_000);
});

test("the prompt is unchanged without a sheet, and with one it says how to read it", () => {
  const caseInput = {
    caseId: "case-1",
    companyName: "Test ApS",
    website: null,
    stage: "seed",
    intakeSources: ["manual" as const],
    evidence: evidence(1),
    relatedPastCases: [],
  };
  assert.equal(evidenceSheetSection(caseInput as ScreeningCaseInput), "");
  const without = buildScreeningPrompt(profile, caseInput);
  assert.ok(!without.system.includes("Bevisarket"));
  const sheet = sanitize(
    raw([
      {
        kind: "criterion",
        key: "team",
        summary: "",
        facts: [fact("To stiftere.", ["E1"])],
        conflicts: [],
        unknowns: [],
      },
    ]),
  );
  const withSheet = buildScreeningPrompt(profile, {
    ...caseInput,
    evidenceSheet: promptEvidenceSheet(sheet),
  });
  assert.match(withSheet.system, /Bevisarket \(case\.evidenceSheet\)/);
  const user = JSON.parse(withSheet.user) as { case: { evidenceSheet: { items: unknown[] } } };
  assert.equal(user.case.evidenceSheet.items.length, 3);
  assert.ok(!withSheet.user.includes("brainText"));
});

test("a stored sheet is read back only in its own version", () => {
  const sheet = sanitize(raw([]));
  assert.deepEqual(readStoredEvidenceSheet(JSON.parse(JSON.stringify(sheet))), sheet);
  assert.equal(readStoredEvidenceSheet({ ...sheet, version: "old" }), null);
  assert.equal(readStoredEvidenceSheet(null), null);
  assert.equal(readStoredEvidenceSheet([]), null);
});
