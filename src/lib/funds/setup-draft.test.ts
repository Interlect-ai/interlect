import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyReview,
  clipText,
  criteriaFromAnswer,
  draftSaveParts,
  draftStages,
  economyFromAnswer,
  fitStageToBudget,
  keyFromLabel,
  normalizeWeights,
  repeatsSharedRule,
  rulesFromAnswer,
  setupDraftFrameSchema,
  setupDraftRequestSchema,
  specialistsFromAnswer,
  stageSummary,
  teamSearchQueries,
  thresholdFromAnswer,
  type DraftProblems,
  type MandateAnswer,
  type StageDraft,
} from "./setup-draft.ts";
import { setupInputSchema } from "./setup-input.ts";
import { teamTextUsed, TEAM_TEXT_BUDGET } from "../analysis/team-text.ts";

const log = (): DraftProblems => ({ problems: [], fixed: 0 });
const frame = (overrides: Partial<Parameters<typeof setupDraftFrameSchema.parse>[0]> = {}) =>
  setupDraftFrameSchema.parse({ stages: ["seed", "Series A"], ...overrides });

test("normalizeWeights: whole numbers in 5-40 that sum to 100", () => {
  for (const raw of [
    [30, 25, 20, 10, 15],
    [1, 1, 1, 1],
    [90, 5, 3, 2],
    [50, 50, 50],
    [0, -3, Number.NaN, 7, 12, 40, 1, 2],
    [33.3, 33.3, 33.4],
  ]) {
    const weights = normalizeWeights(raw);
    assert.equal(weights.length, raw.length);
    assert.equal(
      weights.reduce((sum, weight) => sum + weight, 0),
      100,
      JSON.stringify(raw),
    );
    for (const weight of weights) {
      assert.ok(Number.isInteger(weight) && weight >= 5 && weight <= 40, `${weight} in ${raw}`);
    }
  }
  // Proportions are kept where the limits allow.
  assert.deepEqual(normalizeWeights([30, 25, 20, 10, 15]), [30, 25, 20, 10, 15]);
  const capped = normalizeWeights([90, 5, 3, 2]);
  assert.equal(capped[0], 40);
});

test("normalizeWeights: too few or too many criteria cannot meet the limits", () => {
  assert.throws(() => normalizeWeights([50, 50]));
  assert.throws(() => normalizeWeights(new Array(21).fill(1)));
});

test("keyFromLabel: stable, ascii, unique", () => {
  const taken = new Set<string>();
  assert.equal(keyFromLabel("Founder-market fit", taken, "x"), "founder_market_fit");
  assert.equal(keyFromLabel("Founder market fit", taken, "x"), "founder_market_fit_2");
  assert.equal(
    keyFromLabel("Økonomi og vækst på én gang", taken, "x"),
    "oekonomi_og_vaekst_paa_en_gang",
  );
  assert.equal(keyFromLabel("???", taken, "criterion_3"), "criterion_3");
});

test("criteriaFromAnswer: duplicates out, weights repaired, texts clipped and cleaned", () => {
  const problems = log();
  const criteria = criteriaFromAnswer(
    {
      criteria: [
        {
          label: "Team",
          description: "Vurdér <b>teamet</b>.",
          category: "founder_market_fit",
          weight: 60,
        },
        { label: "team", description: "Dublet.", category: "team_market_fit", weight: 10 },
        { label: "Marked", description: "x".repeat(2000), category: "market_timing", weight: 20 },
        { label: "Traction", description: "Kunder.", category: "traction_gtm", weight: 20 },
        { label: "Evidens", description: "Kilder.", category: "evidence_quality", weight: 20 },
      ],
    },
    problems,
  );
  assert.deepEqual(
    criteria.map((criterion) => criterion.label),
    ["Team", "Marked", "Traction", "Evidens"],
  );
  assert.equal(
    criteria.reduce((sum, criterion) => sum + criterion.weight, 0),
    100,
  );
  assert.equal(criteria[0]!.weight, 40);
  assert.ok(!criteria[0]!.description.includes("<"), "team text is cleaned");
  assert.ok(criteria[1]!.description.length <= 701);
  assert.ok(problems.problems.includes("criteria_duplicate"));
  assert.ok(problems.problems.includes("criteria_weights"));
});

test("criteriaFromAnswer: fewer than three distinct criteria is an error", () => {
  assert.throws(() =>
    criteriaFromAnswer(
      {
        criteria: [
          { label: "A", description: "a", category: "evidence_quality", weight: 50 },
          { label: "a", description: "a", category: "evidence_quality", weight: 50 },
          { label: "B", description: "b", category: "evidence_quality", weight: 50 },
        ],
      },
      log(),
    ),
  );
});

const mandate = (overrides: Partial<MandateAnswer> = {}): MandateAnswer => ({
  rules: [],
  points: [],
  questions: [],
  expectation: "Forvent de første betalende kunder.",
  threshold: 72,
  ...overrides,
});

test("rulesFromAnswer: binding only from the team's own words; no repeat of the shared mandate", () => {
  const problems = log();
  const rules = rulesFromAnswer(
    mandate({
      rules: [
        {
          label: "Ticket mellem 0,5 og 2 mio. EUR",
          description: "Står i tesen.",
          treatment: "hard",
          basis: "team_text",
        },
        {
          label: "Mindst én medinvestor",
          description: "God praksis.",
          treatment: "hard",
          basis: "practice",
        },
        { label: "Geografi: Norden", description: "Delt.", treatment: "hard", basis: "team_text" },
        {
          label: "Kun B2B software",
          description: "Samme som delt.",
          treatment: "review",
          basis: "research",
        },
        {
          label: "Mindst én medinvestor",
          description: "Dublet.",
          treatment: "review",
          basis: "practice",
        },
      ],
    }),
    [{ key: "sector", label: "Kun B2B software" }],
    new Set(["sector"]),
    problems,
  );
  assert.deepEqual(
    rules.map((rule) => [rule.label, rule.treatment]),
    [
      ["Ticket mellem 0,5 og 2 mio. EUR", "hard"],
      ["Mindst én medinvestor", "review"],
    ],
  );
  assert.ok(problems.problems.includes("rule_binding_without_team_text"));
  assert.equal(problems.problems.filter((p) => p === "rule_repeats_shared").length, 2);
  assert.notEqual(rules[0]!.key, "sector");
});

test("repeatsSharedRule: stage, geography and sector are shared lists", () => {
  assert.ok(repeatsSharedRule({ label: "Stadie: kun seed", description: "" }, []));
  assert.ok(repeatsSharedRule({ label: "Sectors we avoid", description: "" }, []));
  assert.ok(
    !repeatsSharedRule({ label: "Ejerandel over 10 %", description: "" }, [{ label: "Ticket" }]),
  );
});

test("economyFromAnswer: only differences from the stage's standard are kept", () => {
  const problems = log();
  const economy = economyFromAnswer(
    mandate({
      points: [
        { key: "runway", on: true, threshold: 12 }, // standard on, standard limit: nothing kept
        { key: "gross_margin", on: true, threshold: 50 }, // off by standard for seed
        { key: "revenue_growth", on: false, threshold: null }, // on by standard for seed
        { key: "runway_extra", on: true, threshold: 1 }, // unknown
        { key: "use_of_funds", on: true, threshold: 99 }, // no limit: threshold ignored
      ],
      questions: [
        { text: "Hvor stor er pipelinen?", answer: "num" },
        { text: "hvor stor er pipelinen?", answer: "num" },
      ],
    }),
    "seed",
    problems,
  );
  assert.deepEqual(economy.points, {
    gross_margin: { on: true, threshold: 50 },
    revenue_growth: { on: false },
  });
  assert.equal(economy.questions.length, 1);
  assert.equal(economy.missing, "task");
  assert.ok(problems.problems.includes("economy_unknown_point"));
});

test("thresholdFromAnswer: within 40-90", () => {
  assert.equal(thresholdFromAnswer(95), 90);
  assert.equal(thresholdFromAnswer(12), 40);
  assert.equal(thresholdFromAnswer(71.6), 72);
  assert.equal(thresholdFromAnswer(Number.NaN), 70);
});

const specialistsAnswer = {
  specialists: ["people_team", "product_market_gtm", "technology_risk", "fund_finance_deal"].map(
    (key) => ({
      key,
      foci: [
        { title: "Første", text: "Vurdér det første.", evidence: "Bevis." },
        { title: "første", text: "Dublet.", evidence: "" },
        { title: "Anden", text: "Vurdér det andet.", evidence: "" },
      ],
      riskAreas: ["Nøgleperson", "Nøgleperson", "Hul i teamet"],
    }),
  ),
};

test("specialistsFromAnswer: the four standard specialists, unique foci and risks", () => {
  const specialists = specialistsFromAnswer(specialistsAnswer, log());
  assert.deepEqual(
    specialists.map((specialist) => specialist.key),
    ["people_team", "product_market_gtm", "technology_risk", "fund_finance_deal"],
  );
  assert.equal(specialists[0]!.foci.length, 2);
  assert.deepEqual(specialists[0]!.riskAreas, ["Nøgleperson", "Hul i teamet"]);
  assert.throws(() =>
    specialistsFromAnswer({ specialists: specialistsAnswer.specialists.slice(0, 3) }, log()),
  );
});

function stageDraft(): StageDraft {
  const problems = log();
  const answer = mandate({
    rules: [
      {
        label: "Ticket under 2 mio. EUR",
        description: "Fra tesen.",
        treatment: "hard",
        basis: "team_text",
      },
    ],
    points: [{ key: "gross_margin", on: true, threshold: 55 }],
    questions: [{ text: "Hvor mange piloter?", answer: "num" }],
  });
  return {
    stage: "seed",
    criteria: criteriaFromAnswer(
      {
        criteria: [
          {
            label: "Founder-market fit",
            description: "Vurdér founderne.",
            category: "founder_market_fit",
            weight: 30,
          },
          {
            label: "Problem",
            description: "Vurdér problemet.",
            category: "fund_thesis_fit",
            weight: 30,
          },
          {
            label: "Traction",
            description: "Vurdér kunderne.",
            category: "traction_gtm",
            weight: 25,
          },
          {
            label: "Evidens",
            description: "Vurdér kilderne.",
            category: "evidence_quality",
            weight: 15,
          },
        ],
      },
      problems,
    ),
    rules: rulesFromAnswer(answer, [], new Set(), problems),
    economy: economyFromAnswer(answer, "seed", problems),
    threshold: 70,
    expectation: "Forvent de første betalende kunder.",
    specialists: specialistsFromAnswer(specialistsAnswer, problems),
    consistency: { problems: 0, fixed: 0 },
  };
}

test("applyReview: only safe fixes; never binding, never weights; unknown refs ignored", () => {
  const draft = stageDraft();
  const weights = draft.criteria.map((criterion) => criterion.weight);
  const applied = applyReview(draft, {
    issues: [
      {
        area: "criteria",
        ref: "traction",
        problem: "",
        action: "rewrite",
        text: "Ny tekst om kunder.",
      },
      { area: "criteria", ref: "findes_ikke", problem: "", action: "rewrite", text: "x" },
      { area: "rules", ref: draft.rules[0]!.key, problem: "", action: "make_review", text: "" },
      {
        area: "specialists",
        ref: "people_team:2",
        problem: "",
        action: "rewrite",
        text: "Ny fokustekst.",
      },
      { area: "specialists", ref: "people_team:9", problem: "", action: "rewrite", text: "x" },
      { area: "economy", ref: "gross_margin", problem: "", action: "turn_off_point", text: "" },
      { area: "economy", ref: "runway", problem: "", action: "turn_off_point", text: "" },
      {
        area: "expectation",
        ref: "expectation",
        problem: "",
        action: "rewrite",
        text: "Ny forventning.",
      },
      { area: "criteria", ref: "traction", problem: "", action: "remove_rule", text: "" },
    ],
  });
  assert.equal(applied, 6);
  assert.equal(
    draft.criteria.find((c) => c.key === "traction")!.description,
    "Ny tekst om kunder.",
  );
  assert.equal(draft.rules[0]!.treatment, "review");
  assert.equal(draft.specialists[0]!.foci[1]!.text, "Ny fokustekst.");
  // gross_margin is off by standard for seed, but its own limit stays with it.
  assert.deepEqual(draft.economy.points["gross_margin"], { on: false, threshold: 55 });
  assert.deepEqual(draft.economy.points["runway"], { on: false });
  assert.equal(draft.expectation, "Ny forventning.");
  assert.deepEqual(
    draft.criteria.map((criterion) => criterion.weight),
    weights,
  );
});

test("applyReview: a rule is removed; a point back on its standard drops its key", () => {
  const draft = stageDraft();
  applyReview(draft, {
    issues: [
      { area: "rules", ref: draft.rules[0]!.key, problem: "", action: "remove_rule", text: "" },
      { area: "economy", ref: "revenue_growth", problem: "", action: "turn_on_point", text: "" },
    ],
  });
  assert.equal(draft.rules.length, 0);
  assert.equal(draft.economy.points["revenue_growth"], undefined);
});

test("fitStageToBudget: shortens the draft's texts, never the team's", () => {
  const draft = stageDraft();
  for (const criterion of draft.criteria)
    criterion.description = "Vurdér noget vigtigt. ".repeat(30);
  draft.expectation = "Forvent meget. ".repeat(60);
  const big = frame({ thesis: "T".repeat(4000), about: "A".repeat(2500) });
  const changed = fitStageToBudget(draft, big, ["Forventning i et andet stadie."]);
  assert.ok(changed);
  const used = teamTextUsed({
    thesis: big.thesis,
    riskPosture: "",
    ticketNote: "",
    stageExpectations: { a: draft.expectation, b: "Forventning i et andet stadie." },
    dealbreakers: [],
    about: big.about,
    criteria: draft.criteria,
    gates: draft.rules,
  });
  const questions = draft.economy.questions.reduce((sum, q) => sum + q.text.length, 0);
  assert.ok(used + questions <= TEAM_TEXT_BUDGET, `${used + questions}`);
  assert.equal(big.thesis.length, 4000);
});

test("draftSaveParts: what saveFundConfigDraft and the module texts take, per stage", () => {
  const draft = stageDraft();
  const parts = draftSaveParts([draft, { ...stageDraft(), stage: "series_a" }]);
  assert.equal(parts.criteria.filter((criterion) => criterion.stage === "seed").length, 4);
  assert.equal(parts.criteria.filter((criterion) => criterion.stage === "series_a").length, 4);
  assert.equal(parts.gates[0]!.stage, "seed");
  assert.equal(parts.stages.seed!.threshold, 70);
  assert.equal(parts.stageExpectations.seed, draft.expectation);
  // setup.stages passes the server's own schema (setup-input.ts).
  const setup = setupInputSchema.parse({ stages: parts.stages });
  assert.ok(setup.stages?.seed?.economy);
  const people = parts.moduleOverrides.seed!.people_team;
  assert.ok(people.mandate[0]!.startsWith("Første: "));
  assert.ok(people.evidenceTests.length >= 1 && people.riskAreas.length >= 1);
  for (const value of [...people.mandate, ...people.evidenceTests]) assert.ok(value.length <= 400);
});

test("stageSummary: the counts the waiting screen shows", () => {
  const draft = stageDraft();
  const summary = stageSummary(draft);
  assert.equal(summary.criteria, 4);
  assert.equal(summary.specialists, 4);
  // Seed's six standard points plus gross margin, which the draft turned on.
  assert.equal(summary.points, 7);
});

test("teamSearchQueries: the team's name and website only, never the thesis", () => {
  const queries = teamSearchQueries({
    teamName: "Change Ventures",
    thesisName: "Change Ventures Fund III",
    website: "https://www.changeventures.com/about",
  });
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.ok(query.includes("Change Ventures (changeventures.com)"));
    assert.ok(query.length <= 300);
  }
  assert.ok(queries[2]!.includes("Change Ventures Fund III"));
  assert.deepEqual(teamSearchQueries({ teamName: "", thesisName: "", website: "" }), []);
});

test("request: stages read in any stored form; unknown keys refused", () => {
  assert.deepEqual(draftStages(frame({ stages: ["Series A", "seed", "Serie B+", "foo"] })), [
    "seed",
    "series_a",
    "series_b",
  ]);
  assert.equal(draftStages(frame({ stages: ["foo"] })).length, 0);
  assert.equal(
    setupDraftRequestSchema.safeParse({
      fundId: "00000000-0000-4000-8000-000000000001",
      configId: "00000000-0000-4000-8000-000000000002",
      frame: { stages: ["seed"], extra: 1 },
    }).success,
    false,
  );
});

test("clipText: ends at a sentence or word", () => {
  assert.equal(clipText("Kort.", 10), "Kort.");
  assert.equal(clipText("Første sætning. Anden sætning er lang.", 25), "Første sætning.");
  assert.ok(clipText("ord ".repeat(50), 30).endsWith("…"));
  // No space in the second half: still at most `max` characters, the ellipsis included.
  const long = clipText("abc " + "y".repeat(500), 400);
  assert.equal([...long].length, 400);
  assert.ok(long.endsWith("…"));
});
