import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeFinancialMetrics } from "../analysis/financial-metrics.ts";
import { LANGUAGES } from "../i18n/language.ts";
import { DICTIONARIES } from "../i18n/translate.ts";
import { MEMO_GAP_KEY } from "./memo.ts";
import {
  BELIEF_HOLDS_FROM,
  BELIEF_PARTLY_FROM,
  MEMO_SECTIONS,
  beliefVerdict,
  buildMemoModel,
  type MemoCriterion,
  type MemoGateTask,
  type MemoModel,
} from "./memo-model.ts";
import { MEMO_GAP_KEYS, memoGaps, openMemoGaps } from "./memo-gaps.ts";
import { AS_OF, MEMO_FIXTURES, type MemoFixture } from "./memo.test.data.ts";

function build(fixture: MemoFixture): MemoModel {
  const financials =
    fixture.statements.length === 0
      ? null
      : computeFinancialMetrics(fixture.statements, AS_OF, {
          currency: fixture.currency,
          registryCountry: fixture.registryCountry,
          language: fixture.language,
        });
  return buildMemoModel(fixture.caseView, fixture.proposer, fixture.gateTasks, {
    language: fixture.language,
    financials,
    gapAnswers: fixture.gapAnswers,
  });
}

/** Every property name and every value anywhere in the model. */
function walk(
  value: unknown,
  visit: (key: string | null, value: unknown) => void,
  key: string | null = null,
) {
  visit(key, value);
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (value && typeof value === "object")
    for (const [name, inner] of Object.entries(value)) walk(inner, visit, name);
}

function lookup(language: (typeof LANGUAGES)[number], key: string): unknown {
  let node: unknown = DICTIONARIES[language];
  for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
  return node;
}

test("the five fixtures are the five agreed cases", () => {
  assert.deepEqual(
    MEMO_FIXTURES.map((fixture) => fixture.name),
    ["rich", "thin", "no_reports", "long_text", "danish"],
  );
});

for (const fixture of MEMO_FIXTURES) {
  test(`${fixture.name}: thirteen sections in the fixed order, with a status per field`, () => {
    const model = build(fixture);
    assert.equal(model.sections.length, 13);
    assert.deepEqual(
      model.sections.map((section) => [section.number, section.key]),
      MEMO_SECTIONS.map((section, index) => [index + 1, section.key]),
    );
    for (const section of model.sections) {
      assert.ok(section.fields.length > 0, section.key);
      for (const field of section.fields)
        assert.ok(["found", "missing", "human_only"].includes(field.status), field.key);
    }
    assert.equal(model.analysisId, fixture.caseView.committeeDeep?.id);
    assert.equal(model.language, fixture.language);
  });

  test(`${fixture.name}: the gaps before the committee are the ones the case lacks`, () => {
    const model = build(fixture);
    const gaps = memoGaps(model);
    assert.deepEqual(
      gaps.map((gap) => gap.key),
      fixture.expect.gaps,
    );
    assert.equal(openMemoGaps(gaps).length, fixture.expect.openGaps);
    for (const gap of gaps) {
      assert.match(gap.key, MEMO_GAP_KEY, "storable in case_memo_gap_answers");
      assert.notEqual(gap.fieldStatus, "found");
      assert.equal(model.sections[gap.sectionNumber - 1]!.key, gap.section);
    }
  });

  test(`${fixture.name}: mandate requirements met, and the ones that still need an answer`, () => {
    const model = build(fixture);
    assert.equal(model.mandate.total, 4);
    assert.equal(model.mandate.met, fixture.expect.metGates);
    assert.deepEqual(
      model.mandate.gates.filter((gate) => gate.needsAnswer).map((gate) => gate.key),
      fixture.expect.openGates,
    );
    assert.equal(model.mandate.open, fixture.expect.openGates.length);
    const mandate = model.sections[0]!.fields.find((field) => field.key === "mandate")!;
    assert.equal(mandate.status, fixture.expect.openGates.length === 0 ? "found" : "human_only");
  });

  test(`${fixture.name}: the figures are the annual reports' own, never invented`, () => {
    const model = build(fixture);
    const finance = model.finance;
    assert.deepEqual(finance.years, fixture.expect.years);
    assert.equal(finance.latest.revenue?.value ?? null, fixture.expect.revenue);
    assert.equal(finance.latest.cash?.value ?? null, fixture.expect.cash);
    assert.equal(finance.latest.operatingResult?.value ?? null, fixture.expect.operatingResult);
    assert.equal(finance.currency, fixture.currency ?? "DKK");
    assert.equal(
      finance.latest.revenue?.currency ?? null,
      fixture.expect.revenue === null ? null : (fixture.currency ?? "DKK"),
    );
    // Every amount in a series is a line item of the report (or null), year by year.
    const reported = new Map(
      fixture.statements.map((statement) => [
        statement.periodEnd.slice(0, 4),
        new Map(statement.lineItems.map((item) => [item.metric, item.value])),
      ]),
    );
    finance.years.forEach((year, index) => {
      assert.equal(finance.series.revenue[index], reported.get(year)?.get("revenue") ?? null);
      assert.equal(finance.series.cash[index], reported.get(year)?.get("cash") ?? null);
      assert.equal(
        finance.series.operatingResult[index],
        reported.get(year)?.get("operating_result") ?? null,
      );
    });
    // The cover's numbers are taken from the finance block, not computed again.
    const latest = Object.values(finance.latest).filter((figure) => figure !== null);
    for (const figure of model.keyFigures) assert.ok(latest.includes(figure), figure.key);
    assert.equal(finance.summary === null, fixture.statements.length === 0);
    // None of the code's ten finance calculations could be made on these runs.
    assert.equal(finance.unitEconomics, null);
    assert.equal(finance.notCalculable.length, 10);
    assert.equal(new Set(finance.missingInputs).size, finance.missingInputs.length);
    assert.ok(finance.missingInputs.includes("mrr"));
    // The unit-economics gap names only what LTV, CAC and payback lack, not runway's inputs.
    const unitGap = memoGaps(model).find((gap) => gap.key === "unit_economics_inputs");
    assert.deepEqual([...(unitGap?.details ?? [])].sort(), [
      "cogs",
      "customers",
      "monthly_churn_rate",
      "new_customers",
      "sales_marketing_spend",
    ]);
    assert.deepEqual(unitGap?.details, finance.unitEconomicsInputs);
    assert.ok(finance.missingInputs.includes("monthly_operating_expenses"));
  });

  test(`${fixture.name}: no Interlect recommendation, threshold or confidence anywhere in the model`, () => {
    const model = build(fixture);
    const forbidden = /recommend|threshold|confidence/i;
    const recommendations = new Set([
      "go_forward",
      "follow",
      "reject",
      "outside_thesis_interesting",
    ]);
    walk({ model, gaps: memoGaps(model) }, (key, value) => {
      if (key !== null) assert.doesNotMatch(key, forbidden, `field "${key}"`);
      if (typeof value === "string") assert.ok(!recommendations.has(value), `value "${value}"`);
      // The fixtures' confidences (criteria 0.73, gates 0.8, evidence 0.9) never pass through.
      if (typeof value === "number")
        assert.ok(![0.73, 0.8, 0.9].includes(value), `number ${value}`);
    });
    assert.ok(fixture.caseView.recommendation !== null && fixture.caseView.threshold !== null);
  });

  test(`${fixture.name}: every text is a dictionary key with Danish and English`, () => {
    const model = build(fixture);
    const keys: string[] = [];
    walk({ model, gaps: memoGaps(model) }, (key, value) => {
      // gapKey is a stored gap's key ("customer_references"), not a text.
      if (key !== null && key !== "gapKey" && key.endsWith("Key") && typeof value === "string")
        keys.push(value);
    });
    assert.ok(keys.length > 60);
    for (const key of keys) assert.ok(key.startsWith("memo."), key);
    for (const key of new Set(keys)) {
      for (const language of LANGUAGES) {
        const text = lookup(language, key);
        assert.equal(typeof text, "string", `${language}: ${key}`);
        assert.ok((text as string).length > 0, `${language}: ${key}`);
      }
    }
  });

  test(`${fixture.name}: only the evidence the analysis used is counted`, () => {
    const model = build(fixture);
    const used = fixture.caseView.committeeDeep!.inputEvidenceIds.length;
    assert.equal(model.diligence.evidenceTotal, used);
    assert.equal(
      model.diligence.evidence.reduce((sum, entry) => sum + entry.count, 0),
      used,
    );
    assert.ok(model.diligence.evidenceTotal < fixture.caseView.evidence.length);
  });

  test(`${fixture.name}: risks are numbered critical first, and each gives a next step`, () => {
    const model = build(fixture);
    const order = { critical: 3, high: 2, medium: 1, low: 0 };
    model.risks.forEach((risk, index) => {
      assert.equal(risk.number, index + 1);
      if (index > 0) assert.ok(order[model.risks[index - 1]!.level] >= order[risk.level]);
    });
    assert.deepEqual(
      model.nextSteps.map((step) => step.riskNumber),
      model.risks.map((risk) => risk.number),
    );
    for (const step of model.nextSteps) {
      const risk = model.risks[step.riskNumber - 1]!;
      assert.equal(step.action, risk.mitigation);
      assert.equal(
        step.phase,
        risk.level === "critical"
          ? "before_signing"
          : risk.level === "high"
            ? "diligence"
            : "after_closing",
      );
    }
  });
}

test("rich (Veo): the team's answer replaces the analysis's reading, a breach still needs one", () => {
  const model = build(MEMO_FIXTURES[0]!);
  const ticket = model.mandate.gates.find((gate) => gate.key === "ticket_fit")!;
  assert.equal(ticket.mark, "passed");
  assert.equal(ticket.answer?.reason, "DKK 12 m is inside the range. Entered by the proposer.");
  assert.equal(ticket.answer?.passed, true);
  assert.equal(ticket.analysisNote, null);
  const stage = model.mandate.gates.find((gate) => gate.key === "stage_fit")!;
  assert.equal(stage.mark, "hard_breach");
  assert.equal(stage.binding, true);
  assert.equal(stage.answer, null);
  assert.equal(stage.analysisNote, "The financing history includes a Series C in 2022.");
  const hardware = model.mandate.gates.find((gate) => gate.key.startsWith("custom_"))!;
  assert.equal(hardware.binding, false);
});

test("rich (Veo): the card data is the run's own", () => {
  const model = build(MEMO_FIXTURES[0]!);
  assert.equal(model.score, 65);
  assert.deepEqual(
    model.team.people.map((person) => person.name),
    ["Henrik Bjørn Teisbæk", "Jesper Taxbøl", "Keld Reinicke", "Lars Thinggaard"],
  );
  assert.deepEqual(model.market.size?.points, [
    { year: 2025, value: 820, forecast: false },
    { year: 2034, value: 2366.9, forecast: true },
  ]);
  assert.deepEqual(
    model.deal.rounds.map((round) => [round.name, round.amount, round.currency]),
    [
      ["Series A", 40000000, "DKK"],
      ["Series B", 20000000, "EUR"],
      ["Series C", 557000000, "DKK"],
    ],
  );
  assert.equal(model.traction.highlights.length, 5);
  assert.equal(model.diligence.specialists.length, 5);
  // Market (13 %) and Timing (10 %) both sit in "Market and timing".
  assert.deepEqual(
    model.market.criteria.map((criterion) => criterion.key),
    ["marked", "timing"],
  );
  assert.deepEqual(
    model.product.criteria.map((criterion) => criterion.key),
    ["produkt", "teknologi"],
  );
  const field = (key: string) =>
    model.sections.flatMap((section) => section.fields).find((entry) => entry.key === key)!.status;
  assert.equal(field("tech_benchmarks"), "missing");
  assert.equal(field("cap_table"), "missing");
  assert.equal(field("funding_history"), "found");
  assert.equal(field("proposer_rationale"), "found");
  // The proposer's comments sit on their beliefs; the others have none.
  const belief = (key: string) => model.thesis.beliefs.find((entry) => entry.key === key)!;
  assert.equal(
    belief("produkt").comment,
    "Clubs use it every week; that settles product fit for me.",
  );
  assert.equal(belief("team").comment, null);
  assert.equal(belief("produkt").verdict, "holds");
  assert.equal(belief("deal").verdict, "not_shown");
});

test("rich (Veo): revenue growth and equity ratio come from the code's report", () => {
  const model = build(MEMO_FIXTURES[0]!);
  const growth = model.finance.latest.revenueGrowth!;
  assert.equal(growth.unit, "percent");
  assert.ok(Math.abs(growth.value - (503900000 / 446060000 - 1) * 100) < 0.1);
  assert.equal(model.finance.latest.equityRatio?.unit, "percent");
  assert.deepEqual(
    model.keyFigures.map((figure) => figure.key),
    ["revenue", "revenue_growth", "ebit", "cash"],
  );
});

test("thin (TWO variant): what the analysis did not find is missing, not a placeholder", () => {
  const model = build(MEMO_FIXTURES[1]!);
  assert.equal(model.proposal.rationale, "");
  assert.equal(model.conclusion.condition, null);
  assert.equal(model.conclusion.counterArgument, null);
  assert.equal(model.market.size, null);
  assert.deepEqual(model.team.people, []);
  assert.deepEqual(model.deal.rounds, []);
  assert.deepEqual(
    model.diligence.specialists.length > 0,
    true,
    "criteria still group by specialist",
  );
  const status = new Map(
    model.sections.flatMap((section) => section.fields).map((field) => [field.key, field.status]),
  );
  assert.equal(status.get("proposer_rationale"), "human_only");
  assert.equal(status.get("investment_condition"), "missing");
  assert.equal(status.get("counter_argument"), "missing");
  assert.equal(status.get("next_steps"), "missing");
  assert.equal(status.get("financial_statements"), "found");
  // A stage prior is something the analysis could not establish.
  const priors = model.thesis.beliefs.filter((belief) => belief.verdict === "not_established");
  assert.deepEqual(
    priors.map((belief) => belief.key),
    ["timing", "teknologi", "deal"],
  );
});

test("no_reports (STRISE without reports): no numbers, and the reports are a gap", () => {
  const model = build(MEMO_FIXTURES[2]!);
  assert.deepEqual(model.keyFigures, []);
  assert.equal(model.finance.summary, null);
  assert.deepEqual(model.finance.series.revenue, []);
  assert.equal(model.deal.holders.length, 5);
  assert.equal(model.product.benchmarks.length, 3);
  // Its market came as highlights, not as a market size.
  assert.equal(model.market.size, null);
  assert.equal(model.traction.highlights.length, 2);
});

test("long_text (TWO): nothing is cut, however long", () => {
  const fixture = MEMO_FIXTURES[3]!;
  const model = build(fixture);
  const deep = fixture.caseView.committeeDeep!;
  assert.equal(model.proposal.rationale, fixture.proposer!.rationale.trim());
  assert.ok(model.proposal.rationale.length > 7000);
  for (const belief of model.thesis.beliefs)
    assert.equal(belief.comment, fixture.proposer!.beliefComments[belief.key]);
  for (const risk of model.risks) {
    const source = deep.risks.find((entry) => entry.category === risk.category)!;
    assert.equal(risk.statement, source.statement);
    assert.ok(risk.statement.length > 1400);
  }
  assert.equal(model.conclusion.reading, deep.overallAssessment);
  assert.equal(model.thesis.text, fixture.caseView.thesis);
  assert.equal(model.thesis.criteria[0]!.note, deep.criteria[0]!.verdict);
  // The prototype (memo-v5 is this run): 2 of 4 met, revenue NOK 22.1 m up 73.1 %.
  assert.equal(model.finance.latest.revenue?.currency, "NOK");
  assert.ok(Math.abs(model.finance.latest.revenueGrowth!.value - 73.1) < 0.1);
  // ... burn NOK 3.5 m a month, about three months of runway at the balance date, none today.
  assert.ok(Math.abs(model.finance.latest.burnPerMonth!.value - 3540360.67) < 1);
  assert.ok(Math.abs(model.finance.latest.runwayAtBalanceDate!.value - 2.83) < 0.01);
  assert.equal(model.finance.latest.runwayToday?.value, 0);
  assert.ok(Math.abs(model.finance.latest.equityRatio!.value - 97.1) < 0.1);
  assert.equal(model.score, 64.3);
});

test("danish (Veo): the memo follows the team's language, and the answers sit on the gaps", () => {
  const model = build(MEMO_FIXTURES[4]!);
  assert.equal(model.language, "da");
  assert.ok(model.finance.summary!.kpis.some((kpi) => kpi.label.startsWith("Omsætning")));
  assert.equal(model.diligence.specialists[0]!.label, "Team");
  const gaps = memoGaps(model);
  const references = gaps.find((gap) => gap.key === "customer_references")!;
  assert.deepEqual(references.answer, {
    state: "not_needed",
    reason: "Vi har selv talt med tre klubber, der bruger kameraet.",
    answeredAt: "2026-11-09T10:30:00Z",
  });
  assert.equal(gaps.find((gap) => gap.key === "legal_review")!.answer?.state, "filled");
  assert.deepEqual(
    openMemoGaps(gaps).map((gap) => gap.key),
    ["competitor_map", "round_terms", "unit_economics_inputs"],
  );
  // Both open requirements were answered in Danish, so nothing blocks the memo.
  assert.equal(model.mandate.open, 0);
  assert.equal(
    model.mandate.gates.find((gate) => gate.key === "stage_fit")!.answer?.reason,
    "Runden er en forlængelse af serie C; vi tager den til komiteen som en undtagelse.",
  );
});

// ---------------------------------------------------------------------------
// The mandate as the case page counts it: the case's gate tasks are the team's current answers.
// ---------------------------------------------------------------------------

const AFTER_RUN = "2026-11-09T12:00:00Z";

function gateTask(
  linkedKey: string,
  resolvedAt: string,
  answerValue: MemoGateTask["answerValue"],
  answerText: string | null = "The team's reason, written in full.",
): MemoGateTask {
  return { linkedKind: "gate", linkedKey, status: "resolved", answerText, answerValue, resolvedAt };
}

/** TWO AS as the run left it (no team answers stored), with the given tasks. */
function twoMandate(tasks: MemoGateTask[]) {
  const fixture = MEMO_FIXTURES[1]!;
  return buildMemoModel(fixture.caseView, null, tasks, { language: "en" }).mandate;
}

const gateOf = (mandate: MemoModel["mandate"], key: string) =>
  mandate.gates.find((gate) => gate.key === key)!;

test("mandate: an answer given after the run counts, through the task alone", () => {
  const mandate = twoMandate([
    gateTask("stage_fit", AFTER_RUN, { gatePassed: true }, "Both stages are inside the mandate."),
  ]);
  const stage = gateOf(mandate, "stage_fit");
  assert.equal(stage.mark, "passed");
  assert.equal(stage.analysisNote, null);
  assert.equal(stage.needsAnswer, false);
  assert.deepEqual(stage.answer, {
    passed: true,
    reason: "Both stages are inside the mandate.",
    override: false,
    answeredAt: AFTER_RUN,
  });
  assert.equal(mandate.met, 3);
  assert.deepEqual(
    mandate.gates.filter((gate) => gate.needsAnswer).map((gate) => gate.key),
    ["ticket_fit"],
  );
});

test("mandate: the team's 'not met' on a requirement the analysis passed is not counted as met", () => {
  const mandate = twoMandate([gateTask("geography_fit", AFTER_RUN, { gatePassed: false })]);
  const geography = gateOf(mandate, "geography_fit");
  assert.equal(geography.mark, "hard_breach");
  assert.equal(geography.answer?.passed, false);
  assert.equal(geography.needsAnswer, false);
  assert.equal(mandate.met, 1);
});

test("mandate: a task resolved with text only is no answer, so the requirement still blocks", () => {
  const mandate = twoMandate([gateTask("ticket_fit", AFTER_RUN, null, "We will ask the company.")]);
  const ticket = gateOf(mandate, "ticket_fit");
  assert.equal(ticket.answer, null);
  assert.equal(ticket.needsAnswer, true);
  assert.equal(
    ticket.analysisNote,
    "The current round size, minimum cheque and available ownership are not shown.",
  );
  assert.equal(mandate.open, 2);
});

test("mandate: the latest answer wins, whatever order the tasks come in", () => {
  const newer = gateTask(
    "ticket_fit",
    "2026-11-09T11:00:00Z",
    { gatePassed: true },
    "DKK 12 m fits.",
  );
  const older = gateTask("ticket_fit", "2026-11-09T10:00:00Z", { gatePassed: false }, "Too small.");
  for (const tasks of [
    [older, newer],
    [newer, older],
  ]) {
    const ticket = gateOf(twoMandate(tasks), "ticket_fit");
    assert.equal(ticket.mark, "passed");
    assert.equal(ticket.answer?.reason, "DKK 12 m fits.");
  }
});

test("mandate: 'met' does not lift a breach the analysis found, unless it is an override after it", () => {
  // Veo's run found the stage breached; the rich fixture's own tasks leave it unanswered.
  const fixture = MEMO_FIXTURES[0]!;
  const build = (tasks: MemoGateTask[]) =>
    buildMemoModel(fixture.caseView, null, [...fixture.gateTasks, ...tasks], { language: "en" })
      .mandate;
  const plain = gateOf(
    build([gateTask("stage_fit", AFTER_RUN, { gatePassed: true })]),
    "stage_fit",
  );
  assert.equal(plain.mark, "hard_breach");
  assert.equal(plain.needsAnswer, true);
  const overridden = build([
    gateTask("stage_fit", AFTER_RUN, { gatePassed: true, override: true }),
  ]);
  const stage = gateOf(overridden, "stage_fit");
  assert.equal(stage.mark, "passed");
  assert.equal(stage.answer?.override, true);
  assert.equal(overridden.met, 4);
  assert.equal(overridden.open, 0);
});

test("mandate: an answer given under another setup version does not count when the version is known", () => {
  const tasks = [
    gateTask("stage_fit", AFTER_RUN, { gatePassed: true, configVersionId: "old-version" }),
  ];
  const fixture = MEMO_FIXTURES[1]!;
  const known = buildMemoModel(fixture.caseView, null, tasks, {
    language: "en",
    configVersionId: "current-version",
  }).mandate;
  assert.equal(gateOf(known, "stage_fit").needsAnswer, true);
  assert.equal(gateOf(twoMandate(tasks), "stage_fit").needsAnswer, false);
});

test("mandate: a finance requirement is binding by its own fixed treatment", () => {
  const fixture = MEMO_FIXTURES[1]!;
  const deep = fixture.caseView.committeeDeep!;
  const gates = [
    {
      ...deep.gates[0]!,
      key: "finance_no_going_concern",
      treatment: "hard" as const,
      passed: false,
    },
  ];
  const caseView = { ...fixture.caseView, committeeDeep: { ...deep, gates } };
  const gate = buildMemoModel(caseView, null, [], { language: "en" }).mandate.gates[0]!;
  assert.equal(gate.binding, false);
  assert.equal(gate.mark, "review_breach");
});

test("finance: the code's estimates (burn, runway) are marked, reported figures are not", () => {
  const model = build(MEMO_FIXTURES[3]!);
  assert.equal(model.finance.latest.burnPerMonth?.estimate, true);
  assert.equal(model.finance.latest.runwayAtBalanceDate?.estimate, true);
  assert.equal(model.finance.latest.revenue?.estimate, false);
  assert.equal(model.finance.latest.cash?.estimate, false);
});

test("a belief holds from the prototype's bands, not from the team's threshold", () => {
  const criterion = (score: number | null, isStagePrior = false): MemoCriterion => ({
    key: "k",
    label: "K",
    category: "c",
    score,
    weight: 10,
    isStagePrior,
    note: null,
  });
  assert.equal(beliefVerdict(criterion(BELIEF_HOLDS_FROM)), "holds");
  assert.equal(beliefVerdict(criterion(BELIEF_HOLDS_FROM - 1)), "partly");
  assert.equal(beliefVerdict(criterion(BELIEF_PARTLY_FROM)), "partly");
  assert.equal(beliefVerdict(criterion(BELIEF_PARTLY_FROM - 1)), "not_shown");
  assert.equal(beliefVerdict(criterion(null)), "not_established");
  assert.equal(beliefVerdict(criterion(80, true)), "not_established");
});

test("a case without a finished deep analysis gives an empty memo, not an error", () => {
  const fixture = MEMO_FIXTURES[0]!;
  const caseView = { ...fixture.caseView, committeeDeep: null, deep: null };
  const model = buildMemoModel(caseView, null, [], { language: "en" });
  assert.equal(model.analysisId, null);
  assert.equal(model.score, null);
  assert.deepEqual(model.risks, []);
  assert.equal(model.mandate.total, 0);
  assert.equal(model.sections.length, 13);
});

test("the gap catalogue has unique, storable keys", () => {
  assert.equal(new Set(MEMO_GAP_KEYS).size, MEMO_GAP_KEYS.length);
  for (const key of MEMO_GAP_KEYS) assert.match(key, MEMO_GAP_KEY);
});

test("the memo model is pure: no server, database, React or alias imports", () => {
  for (const file of ["memo-model.ts", "memo-gaps.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+"([^"]+)";/gm)];
    assert.ok(imports.length > 0, file);
    for (const [, typeOnly, path] of imports) {
      assert.doesNotMatch(path!, /^@\/|\.server|\.functions|^react|supabase/, `${file}: ${path}`);
      if (path!.includes("view-model") || path!.includes("financial-metrics"))
        assert.ok(typeOnly, `${file}: ${path} is a type import`);
    }
  }
});
