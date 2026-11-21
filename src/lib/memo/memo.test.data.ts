/**
 * Fixtures for the committee memo's data model: five cases built from the three finished
 * deep analyses on the English team "Interlect Demo" (read on staging 9 Nov 2026, runs e73e0506 Veo
 * Technologies, c6a70dd3 STRISE AS and be7126f4 TWO AS). Scores, weights, mandate
 * results, risk levels and coordinates, card data (people, market points, rounds, owners,
 * highlights), the code's finance calculations, evidence counts and the annual reports' line items
 * are the runs' own; the prose is shortened. Two cases are variants of a real run, because the
 * demo team has no thin run and no deep run without annual reports:
 *
 * - rich: Veo Technologies as it is (DKK, 2022–2025 reports, team, market, rounds, highlights).
 * - thin: TWO AS's run as a thin run would look: the specialists found no card data, three
 *   criteria are stage priors, no condition or counter-argument, and no proposal yet.
 * - no_reports: STRISE AS as it is, but without its annual reports.
 * - long_text: TWO AS as it is (NOK, Norwegian register), with the longest texts the memo allows.
 * - danish: Veo Technologies as a Danish team sees it (memo language "da", Danish proposal).
 *
 * Every fixture also carries the analysis's confidence, recommendation and the team's threshold,
 * so the test proves the memo model never passes them on.
 */
import type { CardSlot, DeepCardData } from "../analysis/card-data.ts";
import type { MetricsStatementInput } from "../analysis/financial-metrics.ts";
import type {
  AnalysisView,
  CaseViewModel,
  CriterionView,
  EvidenceView,
  GateView,
  RiskView,
} from "../cases/view-model.ts";
import type { SpecialistSetEntry, SpecialistView } from "../cases/specialist-view.ts";
import type { Language } from "../i18n/language.ts";
import type { MemoGapAnswer, MemoInput } from "./memo.ts";
import type { MemoGateTask } from "./memo-model.ts";

export const AS_OF = "2026-11-09";

export interface MemoFixture {
  name: "rich" | "thin" | "no_reports" | "long_text" | "danish";
  language: Language;
  caseView: CaseViewModel;
  proposer: MemoInput | null;
  gateTasks: MemoGateTask[];
  statements: MetricsStatementInput[];
  currency?: string;
  registryCountry?: string;
  gapAnswers: MemoGapAnswer[];
  /** What the model must say for this case. */
  expect: {
    gaps: string[];
    openGaps: number;
    metGates: number;
    openGates: string[];
    years: string[];
    /** The latest revenue and cash as the annual report states them (null = no report). */
    revenue: number | null;
    cash: number | null;
    operatingResult: number | null;
  };
}

// ---------------------------------------------------------------------------
// The team's thesis (Interlect Demo, setup v2): seven criteria and four mandate requirements.
// ---------------------------------------------------------------------------

const CRITERIA = [
  { key: "team", label: "Team", category: "founder_market_fit", weight: 25 },
  { key: "marked", label: "Market", category: "market_timing", weight: 13 },
  { key: "produkt", label: "Product", category: "product_market_fit", weight: 13 },
  { key: "traction", label: "Traction", category: "traction_gtm", weight: 15 },
  { key: "timing", label: "Timing", category: "market_timing", weight: 10 },
  { key: "teknologi", label: "Technology", category: "product_technology", weight: 12 },
  { key: "deal", label: "Deal and terms", category: "fund_thesis_fit", weight: 12 },
] as const;

type CriterionKey = (typeof CRITERIA)[number]["key"];

const THESIS =
  "We back European B2B software and fintech companies from Seed to Series B, where technical founders turn a sharp insight into a product customers pay for early.";

const GATES = [
  { key: "geography_fit", label: "Based in Norden, Europa", treatment: "hard" },
  { key: "stage_fit", label: "Stage: Seed, Serie A, Serie B", treatment: "hard" },
  { key: "ticket_fit", label: "Ticket 3,000,000–20,000,000 DKK", treatment: "hard" },
  {
    key: "custom_no_consumer_hardware_as_the_core_busines",
    label: "No consumer hardware as the core business",
    treatment: "review",
  },
] as const;

type GateKey = (typeof GATES)[number]["key"];

const SPECIALIST_SET: SpecialistSetEntry[] = [
  {
    id: "people_team",
    kind: "standard",
    title: "Founder, ledelse og team",
    categories: ["founder_market_fit", "team_market_fit"],
  },
  {
    id: "product_market_gtm",
    kind: "standard",
    title: "Problem, produkt, PMF, marked og go-to-market",
    categories: ["product_market_fit", "market_timing", "traction_gtm"],
  },
  {
    id: "technology_risk",
    kind: "standard",
    title: "Produktteknologi, data, IP og tværgående risici",
    categories: ["product_technology", "evidence_quality"],
  },
  {
    id: "fund_finance_deal",
    kind: "standard",
    title: "Tesematch, økonomi, kapitalbehov og deal",
    categories: ["fund_thesis_fit", "financial_strength"],
  },
  {
    id: "custom_8an32liol8i6",
    kind: "custom",
    title: "Regulatory and compliance specialist",
    categories: [],
  },
];

/** The code's finance calculations: none could be made on any of the three runs. */
const CALCULATIONS: Array<[string, string[]]> = [
  ["arr", ["mrr"]],
  ["cac", ["sales_marketing_spend", "new_customers"]],
  ["cac_payback", ["sales_marketing_spend", "new_customers", "customers", "cogs"]],
  ["gross_margin", ["cogs"]],
  ["ltv", ["customers", "cogs", "monthly_churn_rate"]],
  [
    "ltv_cac",
    ["sales_marketing_spend", "new_customers", "customers", "cogs", "monthly_churn_rate"],
  ],
  ["mrr", ["arr"]],
  ["net_burn", ["monthly_operating_expenses"]],
  ["revenue_per_customer", ["customers"]],
  ["runway", ["monthly_operating_expenses"]],
];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function criteria(
  scores: Record<CriterionKey, number>,
  notes: Partial<Record<CriterionKey, string>> = {},
  priors: readonly CriterionKey[] = [],
): CriterionView[] {
  return CRITERIA.map((criterion) => ({
    criterionKey: criterion.key,
    category: criterion.category,
    label: criterion.label,
    description: "",
    score: scores[criterion.key],
    weight: criterion.weight,
    confidence: priors.includes(criterion.key) ? 0 : 0.73,
    verdict: notes[criterion.key] ?? null,
    rationale: notes[criterion.key] ?? "",
    positiveDrivers: [],
    negativeDrivers: [],
    unknowns: [],
    evidenceIds: [],
    isStagePrior: priors.includes(criterion.key),
  }));
}

/**
 * The run's mandate results; a team answer replaces the AI's result and reason, as
 * `getCaseDetail` does (cases.functions.ts: `passed`, `rationale` and `teamAnswered`).
 */
function gates(
  results: Record<GateKey, boolean | null>,
  notes: Record<GateKey, string>,
  teamAnswers: Partial<Record<GateKey, string>> = {},
): GateView[] {
  return GATES.map((gate) => {
    const team = teamAnswers[gate.key];
    return {
      key: gate.key,
      label: gate.label,
      description: `${gate.label}. If evidence is missing, the rule is unknown, not breached.`,
      treatment: gate.treatment,
      passed: team === undefined ? results[gate.key] : true,
      rationale: team ?? notes[gate.key],
      confidence: team === undefined ? 0.8 : 1,
      teamAnswered: team !== undefined,
    };
  });
}

function found<T>(data: T): CardSlot<T> {
  return { status: "found", data, reason: null };
}

function notFound<T>(reason: string): CardSlot<T> {
  return { status: "not_found", data: null, reason };
}

/** Evidence items per status (the run's own counts) plus a few the run did not use. */
function evidence(
  prefix: string,
  counts: Record<string, number>,
  unused = 4,
): { items: EvidenceView[]; usedIds: string[] } {
  const items: EvidenceView[] = [];
  const usedIds: string[] = [];
  for (const [status, count] of Object.entries(counts)) {
    for (let index = 0; index < count; index += 1) {
      const id = `${prefix}-${status}-${index}`;
      usedIds.push(id);
      items.push(evidenceItem(id, status));
    }
  }
  for (let index = 0; index < unused; index += 1)
    items.push(evidenceItem(`${prefix}-later-${index}`, "verified"));
  return { items, usedIds };
}

function evidenceItem(id: string, status: string): EvidenceView {
  return {
    id,
    claim: "A sourced statement about the company.",
    valueText: null,
    status,
    confidence: 0.9,
    excerpt: null,
    date: "2026-10-15",
    sourceId: null,
    documentId: null,
    entityMatchStatus: "matched",
    sourceTitle: null,
    sourceUrl: null,
    sourceType: "company_website",
  };
}

function specialists(summaries: Record<string, string>): SpecialistView[] {
  return Object.entries(summaries).map(([moduleId, summary]) => ({
    moduleId,
    summary,
    headline: summary.split(". ")[0] ?? null,
    strengths: [],
    weaknesses: [],
    questions: [],
    unknowns: [],
  }));
}

function deepRun(input: {
  id: string;
  score: number;
  criteria: CriterionView[];
  gates: GateView[];
  risks: RiskView[];
  cardData: DeepCardData;
  specialists: SpecialistView[];
  evidenceIds: string[];
  condition: string | null;
  contrary: string | null;
  assessment: string;
  completedAt: string;
}): AnalysisView {
  return {
    id: input.id,
    kind: "deep",
    status: "complete",
    basisScreeningId: null,
    setupVersion: 2,
    setupThreshold: 70,
    setupCurrent: true,
    title: "Deep analysis",
    score: input.score,
    runScore: input.score,
    counterThesis: input.contrary,
    confidence: 0.73,
    recommendation: "follow",
    rationale: `${input.assessment}\n\nStrongest counter-interpretation: ${input.contrary ?? ""}`,
    overallAssessment: input.assessment,
    contraryCase: input.contrary,
    investmentCondition: input.condition,
    specialists: input.specialists,
    specialistSet: SPECIALIST_SET,
    cardData: input.cardData,
    companyProfile: null,
    companyLabel: null,
    keyFindings: [],
    recalculatedAt: null,
    hasFailedGate: input.gates.some((gate) => gate.passed === false),
    hasCriticalRisk: input.risks.some((risk) => risk.level === "critical"),
    gates: input.gates,
    criteria: input.criteria,
    strengths: [],
    weaknesses: [],
    questions: [],
    findings: [],
    risks: input.risks,
    calculations: CALCULATIONS.map(([metric, missingInputs]) => ({
      metric,
      status: "kan_ikke_beregnes",
      value: null,
      unit: null,
      missingInputs,
      warnings: [],
    })),
    inputEvidenceIds: input.evidenceIds,
    startedAt: "2026-10-15T20:00:00Z",
    completedAt: input.completedAt,
    steps: [],
  };
}

function caseView(input: {
  id: string;
  companyName: string;
  description: string;
  stageText: string;
  sector: string;
  geography: string;
  website: string;
  deep: AnalysisView;
  evidence: EvidenceView[];
  thesis?: string;
}): CaseViewModel {
  return {
    id: input.id,
    isSimulation: false,
    companyName: input.companyName,
    identity: null,
    website: input.website,
    description: input.description,
    stageText: input.stageText,
    sector: input.sector,
    geography: input.geography,
    originText: "Deal flow",
    profileName: "Interlect Demo thesis",
    profileVersion: "v2",
    thesis: input.thesis ?? THESIS,
    threshold: 70,
    headline: input.deep.overallAssessment ?? null,
    overallScore: input.deep.score,
    confidence: 0.73,
    recommendation: "follow",
    executionStatus: "complete",
    executionText: "Complete",
    processStage: "further_evaluation",
    workspaceStatus: "deep_analysis",
    hasFailedGate: input.deep.hasFailedGate,
    hasCriticalRisk: input.deep.hasCriticalRisk,
    analysisKind: "deep",
    screening: null,
    deep: input.deep,
    committeeDeep: input.deep,
    basisScreenings: [],
    history: [],
    criteria: input.deep.criteria,
    strengths: [],
    weaknesses: [],
    questions: [],
    risks: input.deep.risks,
    calculations: input.deep.calculations,
    evidence: input.evidence,
    documents: [
      { id: `${input.id}-deck`, kind: "pitch_deck", fileName: "deck.pdf", status: "ready" },
    ],
    financialSeries: [],
    relatedMemory: [],
    updatedAt: "2026-11-09T09:00:00Z",
  };
}

function statement(
  periodEnd: string,
  items: Record<string, number>,
  reportingClassText = "Regnskabsklasse B",
): MetricsStatementInput {
  return {
    periodStart: `${periodEnd.slice(0, 4)}-01-01`,
    periodEnd,
    sourceDocumentUrl: `https://registry.example/${periodEnd}.pdf`,
    reportingClassText,
    lineItems: Object.entries(items).map(([metric, value]) => ({ metric, value })),
  };
}

function resolvedGate(gateKey: GateKey, reason: string, gatePassed = true): MemoGateTask {
  return {
    linkedKind: "gate",
    linkedKey: gateKey,
    status: "resolved",
    answerText: reason,
    answerValue: { gatePassed },
    resolvedAt: "2026-11-09T10:00:00Z",
  };
}

const proposal = (rationale: string, beliefComments: Record<string, string> = {}): MemoInput => ({
  id: "00000000-0000-4000-8000-000000000001",
  rationale,
  beliefComments,
  authorId: "00000000-0000-4000-8000-0000000000a1",
  updatedAt: "2026-11-09T09:30:00Z",
});

// ---------------------------------------------------------------------------
// Veo Technologies (run e73e0506, score 65, failed stage gate, one critical risk)
// ---------------------------------------------------------------------------

const VEO_STATEMENTS = [
  statement("2022-12-31", {
    gross_profit: -17172000,
    employee_expense: 122488000,
    operating_result: -204625000,
    net_result: -207025000,
    assets: 638902000,
    current_assets: 539807000,
    cash: 446678000,
    equity: 406621000,
    liabilities: 227454000,
    shortterm_liabilities: 186298000,
  }),
  statement("2023-12-31", {
    revenue: 342979000,
    gross_profit: 57327000,
    employee_expense: 122587000,
    operating_result: -178574000,
    net_result: -167708000,
    assets: 517847000,
    current_assets: 376209000,
    cash: 343570000,
    equity: 238913000,
    liabilities: 266023000,
    shortterm_liabilities: 234711000,
  }),
  statement("2024-12-31", {
    revenue: 446060000,
    gross_profit: 237513000,
    employee_expense: 139210000,
    operating_result: -46704000,
    net_result: -58102000,
    assets: 512672000,
    current_assets: 331213000,
    cash: 276456000,
    equity: 182525000,
    liabilities: 320409000,
    shortterm_liabilities: 294908000,
  }),
  statement("2025-12-31", {
    revenue: 503900000,
    gross_profit: 277071000,
    operating_result: -16422000,
    net_result: -4629000,
    assets: 574067000,
    current_assets: 337318000,
    cash: 264382000,
    equity: 177896000,
    liabilities: 393671000,
    shortterm_liabilities: 377334000,
  }),
];

const VEO_RISKS: RiskView[] = [
  {
    category: "stage_mandate_mismatch",
    label: "Later stage than the mandate",
    level: "critical",
    likelihood: 5,
    impact: 5,
    statement:
      "The financing history includes a Series C in 2022, so the company may sit outside the Seed to Series B mandate.",
    mitigation: "Confirm the current round and the stage it represents with the company.",
  },
  {
    category: "recurring_revenue_visibility",
    label: "Recurring revenue not visible",
    level: "high",
    likelihood: 4,
    impact: 4,
    statement: "The split between hardware and subscription revenue is not disclosed.",
    mitigation: "Request revenue by type and the subscription renewal rate.",
  },
  {
    category: "technology_and_data_rights",
    label: "Data rights",
    level: "high",
    likelihood: 4,
    impact: 4,
    statement: "Rights to the recorded match footage used for training are not documented.",
    mitigation: "Review the terms of service and data processing agreements.",
  },
  {
    category: "ownership_and_entry_fit",
    label: "Entry and ownership",
    level: "high",
    likelihood: 4,
    impact: 4,
    statement: "A ticket of DKK 3 to 20 m may buy very little ownership at this valuation.",
    mitigation: "Ask for the current price and the available allocation.",
  },
  {
    category: "leadership_coverage_gap",
    label: "Leadership coverage",
    level: "medium",
    likelihood: 3,
    impact: 4,
    statement: "The public record names few leaders beyond the founders.",
    mitigation: null,
  },
];

const VEO_CARDS: DeepCardData = {
  team: found({
    kind: "team",
    people: [
      {
        name: "Henrik Bjørn Teisbæk",
        role: "CEO / managing director / co-founder",
        scores: { domain: 6, execution: 8, technical: null, commercial: 6, leadership: 8 },
        evidenceIds: ["veo-verified-0"],
      },
      {
        name: "Jesper Taxbøl",
        role: "Co-founder",
        scores: { domain: 5, execution: 6, technical: null, commercial: null, leadership: 5 },
        evidenceIds: ["veo-verified-1"],
      },
      {
        name: "Keld Reinicke",
        role: "Co-founder / board-linked figure",
        scores: { domain: 4, execution: 5, technical: null, commercial: 4, leadership: 5 },
        evidenceIds: ["veo-verified-2"],
      },
      {
        name: "Lars Thinggaard",
        role: "Chair of the board",
        scores: { domain: 5, execution: 7, technical: 4, commercial: 5, leadership: 7 },
        evidenceIds: ["veo-verified-3"],
      },
    ],
    notFound: null,
  }),
  market: found({
    kind: "market",
    label: "Global automated camera systems for sports market",
    scope: "market",
    geography: "Global",
    currency: "USD",
    unit: "million",
    points: [
      { year: 2025, value: 820, basis: "actual", evidenceIds: ["veo-corroborated-0"] },
      { year: 2034, value: 2366.9, basis: "forecast", evidenceIds: ["veo-corroborated-0"] },
    ],
    notFound: null,
  }),
  techBenchmarks: notFound(
    "No source gives a technical key figure next to the industry's level for this company.",
  ),
  ownership: found({
    kind: "ownership",
    holders: [],
    rounds: [
      {
        name: "Series A",
        date: "2019",
        amount: 40000000,
        currency: "DKK",
        investors: [],
        evidenceIds: ["veo-corroborated-1"],
      },
      {
        name: "Series B",
        date: "2021-01-06",
        amount: 20000000,
        currency: "EUR",
        investors: ["Chr. Augustinus Fabrikker", "Courtside VC", "Ventech", "SEED Capital"],
        evidenceIds: ["veo-corroborated-2"],
      },
      {
        name: "Series C",
        date: "2022",
        amount: 557000000,
        currency: "DKK",
        investors: ["ATP"],
        evidenceIds: ["veo-corroborated-3"],
      },
    ],
    notFound: null,
  }),
  highlights: {
    technology_risk: {
      kind: "highlights",
      items: [
        {
          label: "Weekly match uploads",
          value: 25000,
          unit: "matches/week",
          period: null,
          evidenceIds: ["veo-company_stated-0"],
        },
        {
          label: "Claimed clubs and schools",
          value: 20000,
          unit: "organisations",
          period: null,
          evidenceIds: ["veo-company_stated-1"],
        },
        {
          label: "Staff reported",
          value: 400,
          unit: "employees",
          period: "2026",
          evidenceIds: ["veo-company_stated-2"],
        },
      ],
      notFound: null,
    },
    custom_8an32liol8i6: {
      kind: "highlights",
      items: [
        {
          label: "Countries with reported use",
          value: 90,
          unit: "countries",
          period: null,
          evidenceIds: ["veo-company_stated-3"],
        },
        {
          label: "Annual subscription term",
          value: 12,
          unit: "months",
          period: null,
          evidenceIds: ["veo-company_stated-4"],
        },
      ],
      notFound: null,
    },
  },
};

function veoCase(language: Language, teamAnswers: Partial<Record<GateKey, string>>): CaseViewModel {
  const { items, usedIds } = evidence("veo", {
    verified: 29,
    corroborated: 57,
    company_stated: 24,
    unknown: 22,
  });
  const danish = language === "da";
  return caseView({
    id: "6d12eb2e-7d49-4cb3-b891-c3d76abccedc",
    companyName: "Veo Technologies",
    description: danish
      ? "Veo laver AI-kameraer og software, der optager og analyserer kampe for klubber og skoler."
      : "Veo makes AI cameras and software that record and analyse matches for clubs and schools.",
    stageText: danish ? "Serie B" : "Series B",
    sector: "Sports technology",
    geography: danish ? "Danmark" : "Denmark",
    website: "https://www.veo.co",
    evidence: items,
    deep: deepRun({
      id: "e73e0506-1b7a-4acd-b879-43070a90fa98",
      score: 65,
      criteria: criteria(
        { team: 64, marked: 67, produkt: 79, traction: 76, timing: 66, teknologi: 68, deal: 32 },
        {
          deal: "Valuation and allocation are not evidenced; the stage is likely beyond the mandate.",
        },
      ),
      gates: gates(
        {
          geography_fit: true,
          stage_fit: false,
          ticket_fit: null,
          custom_no_consumer_hardware_as_the_core_busines: true,
        },
        {
          geography_fit: "The company is Danish, inside the Nordic geography.",
          stage_fit: "The financing history includes a Series C in 2022.",
          ticket_fit: "The material does not evidence a live round or the expected allocation.",
          custom_no_consumer_hardware_as_the_core_busines:
            "A B2B offering for teams, clubs and schools that combines camera and software.",
        },
        teamAnswers,
      ),
      risks: VEO_RISKS,
      cardData: VEO_CARDS,
      specialists: specialists({
        people_team:
          "The founders have built and scaled the company. Wider leadership is thinly documented.",
        product_market_gtm:
          "The product is widely used by clubs. Revenue grew in every reported year.",
        technology_risk:
          "The camera and software are real and in use. Data rights are not documented.",
        fund_finance_deal: "The company is later stage than the mandate. Deal terms are not known.",
        custom_8an32liol8i6:
          "No regulatory blocker found. Data protection for minors needs a check.",
      }),
      evidenceIds: usedIds,
      condition: danish
        ? "Før en investering skal selskabet vise, at den aktuelle runde ligger inden for mandatets stadier."
        : "Before an investment, the company must show that the current round sits inside the mandate's stages.",
      contrary:
        "Veo may already be the category leader, with growth and a near break-even result that make the later stage worth the price.",
      assessment:
        "Veo is a real, growing sports technology company with broad adoption, but it is likely later stage than the mandate and the deal terms are unknown.",
      completedAt: "2026-10-16T07:40:56Z",
    }),
  });
}

// ---------------------------------------------------------------------------
// TWO AS (run be7126f4, score 64.3, two open gates, one critical risk)
// ---------------------------------------------------------------------------

const TWO_STATEMENTS = [
  statement(
    "2023-12-31",
    {
      revenue: 136593,
      employee_expense: 13949939,
      operating_result: -59294393,
      net_result: -55213844,
      assets: 237461781,
      current_assets: 225090018,
      cash: 14565034,
      equity: 193739420,
      liabilities: 43722362,
      shortterm_liabilities: 43722362,
    },
    "Norsk årsregnskab (regnskapsloven, små foretak)",
  ),
  statement(
    "2024-12-31",
    {
      revenue: 12753030,
      employee_expense: 9978585,
      operating_result: -30715939,
      net_result: -8147532,
      assets: 196146940,
      current_assets: 142542137,
      cash: 12458996,
      equity: 186533060,
      liabilities: 9613880,
      shortterm_liabilities: 5533063,
    },
    "Norsk årsregnskab (regnskapsloven, små foretak)",
  ),
  statement(
    "2025-12-31",
    {
      revenue: 22078205,
      employee_expense: 12402014,
      operating_result: -44266846,
      net_result: -42484328,
      assets: 303632556,
      current_assets: 223525260,
      cash: 10006662,
      equity: 294809463,
      liabilities: 8823093,
      shortterm_liabilities: 8823093,
    },
    "Norsk årsregnskab (regnskapsloven, små foretak)",
  ),
];

const TWO_GATE_NOTES: Record<GateKey, string> = {
  geography_fit: "Registered in Oslo, Norway.",
  stage_fit: "Beyond Seed; the evidence does not settle whether it is Series A or B.",
  ticket_fit: "The current round size, minimum cheque and available ownership are not shown.",
  custom_no_consumer_hardware_as_the_core_busines: "B2B payments and software platform.",
};

const TWO_SCORES = {
  team: 65,
  marked: 67,
  produkt: 74,
  traction: 69,
  timing: 64,
  teknologi: 62,
  deal: 46,
};

/** A long, plain paragraph of `length` characters (the memo must never cut it). */
function longText(sentence: string, length: number): string {
  let out = "";
  while (out.length + sentence.length + 1 <= length) out += `${out ? " " : ""}${sentence}`;
  return out;
}

function twoRisks(long: boolean): RiskView[] {
  const body = (text: string) => (long ? longText(text, 1600) : text);
  return [
    {
      category: "regulatory_perimeter",
      label: "Unverified regulatory perimeter",
      level: "critical",
      likelihood: 4,
      impact: 5,
      statement: body(
        "Product flows may sit closer to regulated payment and credit activity than the evidence supports.",
      ),
      mitigation: long
        ? body(
            "A jurisdiction-by-jurisdiction responsibility matrix with counsel's memo and register extracts.",
          )
        : "A responsibility matrix with counsel's memo and register extracts.",
    },
    {
      category: "control_maturity",
      label: "Control opacity",
      level: "high",
      likelihood: 4,
      impact: 5,
      statement: body(
        "Security and compliance controls may be less mature than the commercial progress suggests.",
      ),
      mitigation: "A security and compliance pack with named owners.",
    },
    {
      category: "traction_quality",
      label: "Opaque revenue quality",
      level: "high",
      likelihood: 4,
      impact: 4,
      statement: body("Adoption signals may overstate how repeatable the revenue is."),
      mitigation: "A 12-month cohort pack of signed, active and paying merchants.",
    },
    {
      category: "partner_dependency",
      label: "Critical partner dependence",
      level: "high",
      likelihood: 4,
      impact: 4,
      statement: body(
        "The product depends on a small set of banks, insurers and payment networks.",
      ),
      mitigation: "Top partner contracts or counsel's summary.",
    },
    {
      category: "deal_visibility",
      label: "Deal visibility and runway",
      level: "high",
      likelihood: 4,
      impact: 4,
      statement: body("Price, ownership and liquidity are not visible."),
      mitigation: "Cap table, latest financing documents and the current price.",
    },
  ];
}

const TWO_CARDS: DeepCardData = {
  team: found({
    kind: "team",
    people: [
      {
        name: "Andreas Mjelde",
        role: "CEO & Co-Founder",
        scores: { domain: 8, execution: 7, technical: null, commercial: 7, leadership: 7 },
        evidenceIds: ["two-verified-0"],
      },
      {
        name: "Joachim Krüger",
        role: "Co-Founder & CPO",
        scores: { domain: 6, execution: 7, technical: 8, commercial: null, leadership: 6 },
        evidenceIds: ["two-verified-1"],
      },
      {
        name: "Douglas Lindsay",
        role: "CTO",
        scores: { domain: null, execution: null, technical: 7, commercial: null, leadership: 5 },
        evidenceIds: ["two-verified-2"],
      },
      {
        name: "Alvin Chan",
        role: "VP Data Science",
        scores: { domain: 7, execution: 5, technical: 7, commercial: null, leadership: 5 },
        evidenceIds: ["two-verified-3"],
      },
      {
        name: "Joye Oyekan",
        role: "UK Sales Lead",
        scores: { domain: 5, execution: null, technical: null, commercial: 6, leadership: 4 },
        evidenceIds: ["two-verified-4"],
      },
    ],
    notFound: null,
  }),
  market: found({
    kind: "market",
    label: "Europe B2B payments market",
    scope: "market",
    geography: "Europe",
    currency: "USD",
    unit: "billion",
    points: [
      { year: 2025, value: 348.58, basis: "actual", evidenceIds: ["two-corroborated-0"] },
      { year: 2034, value: 926.99, basis: "forecast", evidenceIds: ["two-corroborated-0"] },
    ],
    notFound: null,
  }),
  techBenchmarks: notFound(
    "No reliable public source in the retrieved evidence provides a company metric and an industry benchmark.",
  ),
  ownership: found({
    kind: "ownership",
    holders: [],
    rounds: [
      {
        name: "Series A",
        date: "2023-03-21",
        amount: 18000000,
        currency: "EUR",
        investors: ["Shine Capital", "Antler"],
        evidenceIds: ["two-corroborated-1"],
      },
      {
        name: "Series A",
        date: "2025-07-11",
        amount: 13000000,
        currency: "EUR",
        investors: [
          "Idékapital",
          "Shine Capital",
          "Investinor",
          "Sequoia Capital",
          "Antler",
          "Alliance Ventures",
          "Arkwright",
          "Local Globe",
        ],
        evidenceIds: ["two-corroborated-2"],
      },
    ],
    notFound: null,
  }),
  highlights: {},
};

const TWO_SPECIALISTS = specialists({
  people_team:
    "Founder-market fit is documented. Risk, compliance and enterprise sales owners are not verified.",
  product_market_gtm:
    "A live product and a named rollout. Paid use, retention and unit economics are not separated.",
  technology_risk:
    "A technically non-trivial product. Model performance and security controls are mostly company-stated.",
  fund_finance_deal:
    "Verified revenue and prior financing. Valuation, ownership and allocation are not documented.",
  custom_8an32liol8i6:
    "No matching licence evidenced. Duties between company and partners are unmapped.",
});

function twoCase(variant: "long_text" | "thin"): CaseViewModel {
  const thin = variant === "thin";
  const { items, usedIds } = evidence(
    "two",
    thin
      ? { verified: 3, company_stated: 5, unknown: 4 }
      : { verified: 14, corroborated: 50, company_stated: 31, unknown: 15 },
  );
  const reason = "The retrieved evidence does not contain this.";
  return caseView({
    id: "92ce1cd4-27df-4d78-ba81-fea5f01959e7",
    companyName: "TWO AS",
    description:
      "TWO is a Norwegian B2B payments company that lets merchants sell to business buyers on invoice or net terms.",
    stageText: "Series A",
    sector: "B2B payments",
    geography: "Norway",
    website: "https://www.two.inc",
    evidence: items,
    thesis: thin ? THESIS : longText(THESIS, 1900),
    deep: deepRun({
      id: "be7126f4-405f-405b-8004-d14c379cce2e",
      score: 64.3,
      criteria: thin
        ? criteria({ ...TWO_SCORES, timing: 50, teknologi: 50, deal: 50 }, {}, [
            "timing",
            "teknologi",
            "deal",
          ])
        : criteria(TWO_SCORES, {
            team: longText(
              "Relevant enough to build and sell the product; not yet sufficient for scaled, regulated fintech execution.",
              1200,
            ),
            deal: "Valuation, ownership and round mechanics are not evidenced.",
          }),
      gates: gates(
        {
          geography_fit: true,
          stage_fit: null,
          ticket_fit: null,
          custom_no_consumer_hardware_as_the_core_busines: true,
        },
        TWO_GATE_NOTES,
      ),
      risks: thin
        ? twoRisks(false)
            .slice(0, 2)
            .map((risk) => ({ ...risk, mitigation: null }))
        : twoRisks(true),
      cardData: thin
        ? {
            team: notFound(reason),
            market: notFound(reason),
            techBenchmarks: notFound(reason),
            ownership: notFound(reason),
            highlights: {},
          }
        : TWO_CARDS,
      specialists: thin ? [] : TWO_SPECIALISTS,
      evidenceIds: usedIds,
      condition: thin
        ? null
        : longText(
            "Before an investment is defensible, the company must provide a register-verified regulatory responsibility matrix that matches product flows, partner roles and risk ownership.",
            1500,
          ),
      contrary: thin
        ? null
        : longText(
            "The bullish reading is that TWO has already crossed from promising fintech to category leader, with partners that are themselves part of the moat.",
            1800,
          ),
      assessment: thin
        ? "A live B2B payments product with early revenue; the analysis found little beyond the annual reports."
        : longText(
            "TWO looks like a credible Nordic B2B payments infrastructure company with real product substance and a meaningful merchant pain point.",
            2400,
          ),
      completedAt: "2026-10-15T22:29:49Z",
    }),
  });
}

// ---------------------------------------------------------------------------
// STRISE AS (run c6a70dd3, score 65.1, one open gate, no critical risk)
// ---------------------------------------------------------------------------

const STRISE_CARDS: DeepCardData = {
  team: found({
    kind: "team",
    people: [
      {
        name: "Marit Rødevand",
        role: "Founder and Chief Executive Officer",
        scores: { domain: 6, execution: 8, technical: 5, commercial: 6, leadership: 8 },
        evidenceIds: ["strise-verified-0"],
      },
      {
        name: "Patrick Skjennum",
        role: "Co-founder and former CTO",
        scores: { domain: 4, execution: 6, technical: 8, commercial: 2, leadership: 5 },
        evidenceIds: ["strise-verified-1"],
      },
      {
        name: "Sigve Søråsen",
        role: "Co-founder and former CPO",
        scores: { domain: 4, execution: 6, technical: 4, commercial: 3, leadership: 6 },
        evidenceIds: ["strise-verified-2"],
      },
    ],
    notFound: null,
  }),
  market: notFound("No named source gives the market's size in two different years."),
  techBenchmarks: found({
    kind: "techBenchmarks",
    items: [
      {
        metric: "Entities screened",
        unit: "entities",
        company: 11500000,
        industry: null,
        higherIsBetter: true,
        evidenceIds: ["strise-company_stated-0"],
      },
      {
        metric: "Routine cases automated",
        unit: "%",
        company: 80,
        industry: null,
        higherIsBetter: true,
        evidenceIds: ["strise-company_stated-1"],
      },
      {
        metric: "False-positive reduction",
        unit: "%",
        company: 30,
        industry: null,
        higherIsBetter: true,
        evidenceIds: ["strise-company_stated-2"],
      },
    ],
    notFound: null,
  }),
  ownership: found({
    kind: "ownership",
    holders: [
      {
        holder: "Maki.vc Fund I KY",
        holderType: "investor",
        percent: 19.24,
        asOf: "2025-12-31",
        evidenceIds: ["strise-verified-3"],
      },
      {
        holder: "Atomico Venture VI SCSp",
        holderType: "investor",
        percent: 17.19,
        asOf: "2025-12-31",
        evidenceIds: ["strise-verified-3"],
      },
      {
        holder: "Curiosity Early Stage Fund Coöperatief",
        holderType: "investor",
        percent: 10.25,
        asOf: "2025-12-31",
        evidenceIds: ["strise-verified-3"],
      },
      {
        holder: "Root AS",
        holderType: "other",
        percent: 9.2,
        asOf: "2025-12-31",
        evidenceIds: ["strise-verified-3"],
      },
      {
        holder: "Strise AS",
        holderType: "other",
        percent: 6.73,
        asOf: null,
        evidenceIds: ["strise-verified-3"],
      },
    ],
    rounds: [
      {
        name: "Seed / funding round",
        date: "2022-11-07",
        amount: 3300000,
        currency: "EUR",
        investors: ["Curiosity"],
        evidenceIds: ["strise-corroborated-0"],
      },
      {
        name: "Series A",
        date: "2023-09-06",
        amount: 10800000,
        currency: "USD",
        investors: ["Atomico", "Curiosity", "Maki.vc", "Sondo"],
        evidenceIds: ["strise-corroborated-1"],
      },
      {
        name: "Convertible financing",
        date: "2024",
        amount: 66500000,
        currency: "NOK",
        investors: [],
        evidenceIds: ["strise-corroborated-2"],
      },
    ],
    notFound: null,
  }),
  highlights: {
    product_market_gtm: {
      kind: "highlights",
      items: [
        {
          label: "Entities screened",
          value: 11500000,
          unit: "entities",
          period: null,
          evidenceIds: ["strise-company_stated-0"],
        },
        {
          label: "Routine cases automated",
          value: 80,
          unit: "%",
          period: null,
          evidenceIds: ["strise-company_stated-1"],
        },
      ],
      notFound: null,
    },
  },
};

function striseCase(): CaseViewModel {
  const { items, usedIds } = evidence("strise", {
    verified: 14,
    corroborated: 54,
    company_stated: 41,
    unknown: 12,
  });
  return caseView({
    id: "d8c0413a-fa9c-4c93-a71a-58c8fba3e4f3",
    companyName: "STRISE AS",
    description:
      "Strise makes AML and KYC software that automates customer due diligence for banks and fintechs.",
    stageText: "Series A",
    sector: "RegTech",
    geography: "Norway",
    website: "https://www.strise.ai",
    evidence: items,
    deep: deepRun({
      id: "c6a70dd3-3102-4af6-8793-a6dc2efb9793",
      score: 65.1,
      criteria: criteria({
        team: 60,
        marked: 69,
        produkt: 73,
        traction: 70,
        timing: 78,
        teknologi: 63,
        deal: 48,
      }),
      gates: gates(
        {
          geography_fit: true,
          stage_fit: true,
          ticket_fit: null,
          custom_no_consumer_hardware_as_the_core_busines: true,
        },
        {
          geography_fit: "STRISE AS is a Norwegian legal entity in Oslo.",
          stage_fit: "A documented 2023 Series A and later convertible financing.",
          ticket_fit: "The current round size, expected cheque and valuation are not established.",
          custom_no_consumer_hardware_as_the_core_busines: "Software for AML and KYC workflows.",
        },
      ),
      risks: [
        {
          category: "revenue_durability",
          label: "Revenue durability",
          level: "high",
          likelihood: 4,
          impact: 5,
          statement: "Revenue growth is real, but renewal and churn are not shown.",
          mitigation: "Request net revenue retention by cohort.",
        },
        {
          category: "runway_financing",
          label: "Runway",
          level: "high",
          likelihood: 4,
          impact: 5,
          statement: "Losses are large against the cash at year-end.",
          mitigation: "A current cash bridge and the financing plan.",
        },
        {
          category: "technical_leadership",
          label: "Technical leadership",
          level: "high",
          likelihood: 4,
          impact: 4,
          statement: "The co-founding CTO and CPO are described as former.",
          mitigation: "Map the current technical leadership.",
        },
        {
          category: "data_dependency",
          label: "Data dependency",
          level: "high",
          likelihood: 4,
          impact: 4,
          statement: "The product depends on third-party data sources.",
          mitigation: "Review the key data supply contracts.",
        },
        {
          category: "regulatory_footing",
          label: "Regulatory footing",
          level: "medium",
          likelihood: 3,
          impact: 5,
          statement: "New EU AML rules change customers' obligations from 2027.",
          mitigation: null,
        },
      ],
      cardData: STRISE_CARDS,
      specialists: specialists({
        people_team: "A credible founder CEO. The original technical co-founders have moved on.",
        product_market_gtm:
          "Strong timing from new AML rules. Revenue roughly doubled from 2023 to 2025.",
        technology_risk: "Real automation claims, all company-stated.",
        fund_finance_deal: "Within stage; the round and price are unknown.",
        custom_8an32liol8i6: "Regulation is a tailwind, not a blocker.",
      }),
      evidenceIds: usedIds,
      condition:
        "Before an investment, the company must show net revenue retention and a funded runway.",
      contrary:
        "Strise may be early to a regulatory wave that makes its product mandatory infrastructure.",
      assessment: "Strise is a well-timed RegTech company with growing revenue and heavy losses.",
      completedAt: "2026-10-22T10:19:43Z",
    }),
  });
}

// ---------------------------------------------------------------------------
// The five fixtures
// ---------------------------------------------------------------------------

const HUMAN_GAPS = ["customer_references", "competitor_map", "round_terms", "legal_review"];

const VEO_TICKET = "DKK 12 m is inside the range. Entered by the proposer.";
const VEO_DA_ANSWERS = {
  stage_fit: "Runden er en forlængelse af serie C; vi tager den til komiteen som en undtagelse.",
  ticket_fit: "12 mio. kr. ligger inden for rammen.",
};

export const MEMO_FIXTURES: MemoFixture[] = [
  {
    name: "rich",
    language: "en",
    caseView: veoCase("en", { ticket_fit: VEO_TICKET }),
    proposer: proposal(
      "Category leader in automated sports video with broad club adoption and a near break-even 2025. I want to propose a small ticket if the round fits our stages.",
      {
        produkt: "Clubs use it every week; that settles product fit for me.",
        deal: "Only if the round is inside our stages.",
      },
    ),
    gateTasks: [resolvedGate("ticket_fit", VEO_TICKET)],
    statements: VEO_STATEMENTS,
    gapAnswers: [],
    expect: {
      gaps: [...HUMAN_GAPS, "unit_economics_inputs"],
      openGaps: 5,
      metGates: 3,
      openGates: ["stage_fit"],
      years: ["2022", "2023", "2024", "2025"],
      revenue: 503900000,
      cash: 264382000,
      operatingResult: -16422000,
    },
  },
  {
    name: "thin",
    language: "en",
    caseView: twoCase("thin"),
    proposer: null,
    gateTasks: [],
    statements: TWO_STATEMENTS,
    currency: "NOK",
    registryCountry: "NO",
    gapAnswers: [],
    expect: {
      gaps: [
        ...HUMAN_GAPS,
        "unit_economics_inputs",
        "market_size",
        "team_background",
        "funding_history",
      ],
      openGaps: 8,
      metGates: 2,
      openGates: ["stage_fit", "ticket_fit"],
      years: ["2023", "2024", "2025"],
      revenue: 22078205,
      cash: 10006662,
      operatingResult: -44266846,
    },
  },
  {
    name: "no_reports",
    language: "en",
    caseView: striseCase(),
    proposer: proposal("Early to the EU AML wave with a credible founder. Worth a committee look."),
    gateTasks: [],
    statements: [],
    gapAnswers: [],
    expect: {
      gaps: [...HUMAN_GAPS, "unit_economics_inputs", "financial_statements", "market_size"],
      openGaps: 7,
      metGates: 3,
      openGates: ["ticket_fit"],
      years: [],
      revenue: null,
      cash: null,
      operatingResult: null,
    },
  },
  {
    name: "long_text",
    language: "en",
    caseView: twoCase("long_text"),
    proposer: proposal(
      longText(
        "Founder-led company with a real merchant problem, live at scale in a named Nordic rollout, and revenue up 73 % last year; I want to lead a DKK 12 m ticket once we have the regulatory responsibility matrix.",
        7900,
      ),
      Object.fromEntries(
        CRITERIA.map((criterion) => [
          criterion.key,
          longText(
            `My view on ${criterion.label.toLowerCase()}: the analysis matches what I have seen in meetings.`,
            1900,
          ),
        ]),
      ),
    ),
    gateTasks: [],
    statements: TWO_STATEMENTS,
    currency: "NOK",
    registryCountry: "NO",
    gapAnswers: [],
    expect: {
      gaps: [...HUMAN_GAPS, "unit_economics_inputs"],
      openGaps: 5,
      metGates: 2,
      openGates: ["stage_fit", "ticket_fit"],
      years: ["2023", "2024", "2025"],
      revenue: 22078205,
      cash: 10006662,
      operatingResult: -44266846,
    },
  },
  {
    name: "danish",
    language: "da",
    caseView: veoCase("da", VEO_DA_ANSWERS),
    proposer: proposal(
      "Førende inden for automatisk sportsvideo med bred udbredelse i klubberne og næsten balance i 2025. Jeg foreslår en lille billet, hvis runden passer til vores stadier.",
      { produkt: "Klubberne bruger det hver uge; det afgør produktet for mig." },
    ),
    gateTasks: [
      resolvedGate("stage_fit", VEO_DA_ANSWERS.stage_fit),
      resolvedGate("ticket_fit", VEO_DA_ANSWERS.ticket_fit),
    ],
    statements: VEO_STATEMENTS,
    gapAnswers: [
      {
        id: "00000000-0000-4000-8000-0000000000b1",
        gapKey: "customer_references",
        state: "not_needed",
        reason: "Vi har selv talt med tre klubber, der bruger kameraet.",
        answeredBy: "00000000-0000-4000-8000-0000000000a1",
        answeredAt: "2026-11-09T10:30:00Z",
      },
      {
        id: "00000000-0000-4000-8000-0000000000b2",
        gapKey: "legal_review",
        state: "filled",
        reason: null,
        answeredBy: "00000000-0000-4000-8000-0000000000a1",
        answeredAt: "2026-11-09T10:31:00Z",
      },
    ],
    expect: {
      gaps: [...HUMAN_GAPS, "unit_economics_inputs"],
      openGaps: 3,
      metGates: 4,
      openGates: [],
      years: ["2022", "2023", "2024", "2025"],
      revenue: 503900000,
      cash: 264382000,
      operatingResult: -16422000,
    },
  },
];
