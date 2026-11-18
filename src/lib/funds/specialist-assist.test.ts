import assert from "node:assert/strict";
import { test } from "node:test";
import type { FundSpecialistRow } from "../analysis/specialist-set.ts";
import { specialistModules } from "../analysis/specialist-prompts.ts";
import {
  codeIssues,
  customSpecialistSchema,
  DRAFT_JSON_SCHEMA,
  fixedAreaOwners,
  mergeIssues,
  parseAiCheck,
  parseDraft,
  pointsOverlap,
  resolveWithCandidate,
  rowsWithCandidate,
  UNSAVED_SPECIALIST_KEY,
  type CustomSpecialistInput,
} from "./specialist-assist.ts";

const impact: CustomSpecialistInput = {
  name: "Impact og klima",
  purpose: "Fonden investerer kun i selskaber med en målbar klimaeffekt.",
  mandate: [
    "Vurder om selskabets klimaeffekt er målt med en anerkendt metode som GHG-protokollen.",
    "Undersøg om klimaeffekten følger af kerneproduktet og ikke af kompensation.",
  ],
  evidenceTests: [
    "Livscyklusanalyse, CO2-regnskab eller tredjepartsverifikation i casens materiale.",
  ],
  riskAreas: ["Greenwashing", "Rebound-effekt"],
  questions: ["Hvor stor er reduktionen pr. solgt enhed, og hvem har målt den?"],
  deliverables: [],
  categories: ["fund_thesis_fit"],
};

function standardOff(key: string): FundSpecialistRow {
  return {
    specialist_key: key,
    kind: "standard",
    enabled: false,
    sort_order: 0,
    name: null,
    purpose: null,
    mandate: null,
    evidence_tests: null,
    risk_areas: null,
    research_questions: [],
    output_focus: [],
    categories: [],
  };
}

test("a new candidate comes last and active; a saved one keeps its key and place", () => {
  const saved: FundSpecialistRow = {
    ...standardOff("custom_abcdefgh"),
    kind: "custom",
    enabled: false,
    sort_order: 7,
    name: "Gammel",
    mandate: ["x"],
  };
  const fresh = rowsWithCandidate([saved], undefined, impact);
  assert.equal(fresh.key, UNSAVED_SPECIALIST_KEY);
  assert.equal(fresh.rows.length, 2);
  assert.equal(fresh.rows.at(-1)?.sort_order, 8);
  assert.equal(fresh.rows.at(-1)?.enabled, true);

  const edited = rowsWithCandidate([saved], "custom_abcdefgh", impact);
  assert.equal(edited.key, "custom_abcdefgh");
  assert.equal(edited.rows.length, 1);
  assert.equal(edited.rows[0]?.sort_order, 7);
  assert.equal(edited.rows[0]?.enabled, true);
  assert.equal(edited.rows[0]?.name, "Impact og klima");
});

test("the candidate's areas are the ones a run would give it", () => {
  // fund_thesis_fit belongs to the active finance module: the candidate scores nothing.
  const all = resolveWithCandidate([], new Map(), undefined, impact);
  assert.deepEqual(all.candidate.categories, []);
  // With the finance module off, its areas (incl. fund_thesis_fit) move to the candidate.
  const off = resolveWithCandidate(
    [standardOff("fund_finance_deal")],
    new Map(),
    undefined,
    impact,
  );
  const finance = specialistModules.find((item) => item.id === "fund_finance_deal")!;
  assert.deepEqual([...off.candidate.categories].sort(), [...finance.categories].sort());
});

test("code finds a duplicate, a vague point and overlap with an active specialist", () => {
  const people = specialistModules.find((item) => item.id === "people_team")!;
  const specialist: CustomSpecialistInput = {
    ...impact,
    mandate: [
      impact.mandate[0]!,
      `${impact.mandate[0]!} `,
      "Klima osv.",
      // Nearly word for word the people module's first point.
      people.mandate[0]!.replace("Rekonstruér", "Beskriv"),
    ],
  };
  const { set, candidate } = resolveWithCandidate([], new Map(), undefined, specialist);
  const issues = codeIssues(specialist, set, candidate);
  const at = (index: number) =>
    issues.filter((issue) => issue.field === "mandate" && issue.index === index);
  assert.deepEqual(at(0), []);
  assert.equal(at(1)[0]?.kind, "duplicate");
  assert.equal(at(2)[0]?.kind, "vague");
  assert.equal(at(3)[0]?.kind, "overlap");
  assert.match(at(3)[0]!.message, /Founder, ledelse og team/);
  // The requested area is owned by an active standard module: a note, not a fix.
  const scope = issues.filter((issue) => issue.kind === "scope");
  assert.ok(scope.length >= 1);
  assert.ok(scope.every((issue) => issue.severity === "note"));
});

test("a clean specialist with areas of a switched-off module has only notes", () => {
  const { set, candidate } = resolveWithCandidate(
    [standardOff("fund_finance_deal")],
    new Map(),
    undefined,
    impact,
  );
  const issues = codeIssues(impact, set, candidate);
  assert.ok(
    issues.every((issue) => issue.severity === "note"),
    JSON.stringify(issues),
  );
  assert.ok(issues.some((issue) => /Overtager/.test(issue.message)));
});

test("overlap needs most content words shared, not one common word", () => {
  assert.equal(pointsOverlap("Vurder markedets størrelse", "Vurder teamets størrelse"), false);
  assert.equal(
    pointsOverlap(
      "Kortlæg direkte konkurrenter, indirekte alternativer og status quo",
      "Kortlæg konkurrenter, indirekte alternativer og status quo i markedet",
    ),
    true,
  );
});

test("the model's issues are merged without repeating code's and with indexes checked", () => {
  const code = codeIssues(
    { ...impact, mandate: [...impact.mandate, "Klima osv."] },
    ...(() => {
      const resolved = resolveWithCandidate([], new Map(), undefined, impact);
      return [resolved.set, resolved.candidate] as const;
    })(),
  );
  const ai = parseAiCheck(
    JSON.stringify({
      verdict: "needs_work",
      issues: [
        { field: "mandate", index: 2, kind: "vague", message: "Løst.", suggestion: null },
        {
          field: "questions",
          index: 9,
          kind: "untestable",
          message: "Kræver samtale.",
          suggestion: "Spørg teamet.",
        },
        { field: "purpose", index: 0, kind: "other", message: "Uklart.", suggestion: null },
        { field: "categories", index: null, kind: "other", message: "Tomt.", suggestion: null },
      ],
    }),
  );
  const merged = mergeIssues({ ...impact, mandate: [...impact.mandate, "Klima osv."] }, code, ai);
  assert.equal(merged.filter((issue) => issue.field === "mandate" && issue.index === 2).length, 1);
  const outside = merged.find((issue) => issue.field === "questions");
  assert.equal(outside?.index, null);
  assert.equal(outside?.source, "ai");
  assert.equal(merged.find((issue) => issue.field === "purpose")?.index, null);
  // The areas are code's: the model's word on them is dropped.
  assert.ok(!merged.some((issue) => issue.field === "categories" && issue.source === "ai"));
});

test("a draft from the model is a specialist that can be saved", () => {
  const draft = parseDraft(
    JSON.stringify({ ...impact, categories: ["fund_thesis_fit", "fund_thesis_fit"] }),
  );
  assert.deepEqual(draft.categories, ["fund_thesis_fit"]);
  assert.equal(customSpecialistSchema.safeParse(draft).success, true);
  assert.throws(() => parseDraft(JSON.stringify({ ...impact, mandate: [] })));
  // The schema sent to the model has the table's limits.
  assert.equal(DRAFT_JSON_SCHEMA.properties.mandate.maxItems, 12);
  assert.equal(DRAFT_JSON_SCHEMA.properties.riskAreas.items.maxLength, 120);
});

test("a short but precise question, deliverable or test is not called vague", () => {
  const specialist: CustomSpecialistInput = {
    ...impact,
    mandate: [
      ...impact.mandate,
      "Vurder om bruttomarginen generelt ligger over niveauet for sammenlignelige selskaber.",
      "Vurder om et diverse sammensat founderteam dækker kundens behov.",
    ],
    evidenceTests: ["CO2-regnskab fra tredjepart."],
    questions: ["Er CO2-tallet verificeret?"],
    deliverables: ["Risikomatrix", "Klimaeffekt pr. kunde"],
  };
  const { set, candidate } = resolveWithCandidate([], new Map(), undefined, specialist);
  const vague = codeIssues(specialist, set, candidate).filter((issue) => issue.kind === "vague");
  assert.deepEqual(vague, []);
});

test("free score areas: a switched-off module's areas are free, a revised one is not its own owner", () => {
  const deepTech: FundSpecialistRow = {
    ...standardOff("custom_deeptech1"),
    kind: "custom",
    enabled: true,
    sort_order: 2,
    name: "Deep tech",
    mandate: ["x"],
    categories: ["product_technology", "evidence_quality"],
  };
  const impactRow: FundSpecialistRow = {
    ...deepTech,
    specialist_key: "custom_impact001",
    sort_order: 1,
    name: "Impact",
    categories: [],
  };
  const rows = [standardOff("technology_risk"), impactRow, deepTech];
  // Revising Deep tech: its areas are free, not "assessed by Impact" (who would inherit them).
  const revising = fixedAreaOwners(rows, "custom_deeptech1");
  assert.equal(revising.get("product_technology"), undefined);
  assert.equal(revising.get("evidence_quality"), undefined);
  assert.equal(revising.get("founder_market_fit"), "Founder, ledelse og team");
  // A new specialist: Deep tech keeps the areas it names.
  assert.equal(fixedAreaOwners(rows, null).get("product_technology"), "Deep tech");
  // With no own specialists, a switched-off module's areas are free too.
  assert.equal(
    fixedAreaOwners([standardOff("technology_risk")], null).get("product_technology"),
    undefined,
  );
});

test("the model's check is mended issue by issue, and a ready verdict keeps remarks as notes", () => {
  const ai = parseAiCheck(
    JSON.stringify({
      verdict: "ready",
      issues: [
        { field: "mandate", index: 0, kind: "vague", message: "Kunne skærpes.", suggestion: "" },
        { field: "nonsense", index: 0, kind: "vague", message: "x", suggestion: null },
        { field: "purpose", index: null, kind: "other", message: "", suggestion: null },
      ],
    }),
  );
  assert.equal(ai?.issues.length, 1);
  assert.equal(ai?.issues[0]?.suggestion, null);
  const merged = mergeIssues(impact, [], ai);
  assert.equal(merged[0]?.severity, "note");
  assert.equal(parseAiCheck("not json"), null);
  assert.equal(parseAiCheck(JSON.stringify({ verdict: "maybe", issues: [] })), null);
});
