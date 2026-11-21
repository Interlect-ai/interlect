/**
 * The stage's economy points on a screening: registry figures in code, the AI's sourced
 * answers, limits compared in code, missing figures gathered into one task. Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readEconomySetup } from "../funds/economy-points.ts";
import type { FinanceGateContext } from "./financial-gates.ts";
import type { FinancialMetricsReport } from "./financial-metrics.ts";
import {
  economyAsk,
  economyAskKeys,
  economyTask,
  evaluateEconomy,
  readEconomyResult,
  registryFigure,
  registryFigures,
  withinLimit,
  type EconomyAnswer,
} from "./economy-check.ts";

function context(
  metrics: Record<string, number | null>,
  extra: Partial<FinanceGateContext> = {},
): FinanceGateContext {
  const report = {
    years: ["2024-12-31"],
    metrics: Object.entries(metrics).map(([key, value]) => ({ key, latest: { value } })),
  } as unknown as FinancialMetricsReport;
  return { report, identityConfirmed: true, stage: "seed", ...extra };
}

const evidence = new Set(["ev-1", "ev-2"]);

function answer(key: string, value: number | null, more: Partial<EconomyAnswer> = {}) {
  return { key, value, answer: `Svar på ${key}.`, evidenceIds: ["ev-1"], ...more };
}

test("a limit is met at the limit itself and marked past it", () => {
  assert.equal(withinLimit(12, { value: 12, direction: "min" }), true);
  assert.equal(withinLimit(11.9, { value: 12, direction: "min" }), false);
  assert.equal(withinLimit(30, { value: 30, direction: "max" }), true);
  assert.equal(withinLimit(31, { value: 30, direction: "max" }), false);
});

test("the registry gives a figure only with a certain match and readable accounts", () => {
  const figures = context({ revenue_growth: 42, equity: -10, latest_filing_age: 20 });
  assert.deepEqual(registryFigure("revenue_growth", figures), { value: 42 });
  assert.deepEqual(registryFigure("positive_equity", figures), { value: false });
  assert.equal(registryFigure("customer_concentration", figures), null);
  assert.equal(
    registryFigure("revenue_growth", { ...figures, identityConfirmed: false }),
    null,
    "a company we are not sure is this one never decides anything",
  );
  assert.equal(registryFigure("revenue_growth", { ...figures, loadError: true }), null);
  assert.equal(registryFigure("revenue_growth", null), null);
  assert.deepEqual(registryFigure("runway", context({ operating_burn: 0 })), {
    value: null,
    met: true,
  });
  assert.deepEqual(registryFigure("going_concern", context({}, { latestGoingConcernNote: true })), {
    value: true,
  });
});

test("the AI is asked every point that is not only from the registry, and the own questions", () => {
  const setup = readEconomySetup(
    { questions: [{ text: "Er væksten drevet af få kunder?", answer: "yn" }] },
    "seed",
  );
  const ask = economyAsk(setup)!;
  assert.deepEqual(economyAskKeys(ask), [
    "revenue_growth",
    "customer_concentration",
    "runway",
    "use_of_funds",
    "round_size",
    "own_1",
  ]);
  assert.equal(ask.points.find((point) => point.key === "use_of_funds")?.kind, "text");
  assert.equal(economyAsk(null), null);
  const accountsOnly = readEconomySetup(
    {
      points: Object.fromEntries(
        ["revenue_growth", "customer_concentration", "runway", "use_of_funds", "round_size"].map(
          (key) => [key, { on: false }],
        ),
      ),
    },
    "seed",
  );
  assert.equal(economyAsk(accountsOnly), null, "only filing_age is on, and the registry has it");
  assert.deepEqual(registryFigures(accountsOnly, context({ latest_filing_age: 9 })), [
    { key: "filing_age", value: 9 },
  ]);
});

test("the screening's economy: registry first, sourced AI answers, limits compared in code", () => {
  const setup = readEconomySetup(
    {
      points: { gross_margin: { on: true }, positive_equity: { on: true } },
      questions: [
        { text: "Er væksten drevet af få kunder?", answer: "yn" },
        { text: "Hvor mange ansatte er der?", answer: "num" },
        { text: "Hvem er revisor?", answer: "txt" },
      ],
    },
    "seed",
  );
  const result = evaluateEconomy({
    stage: "seed",
    setup,
    registry: context({ revenue_growth: 150, equity: 5, latest_filing_age: 30 }),
    answers: [
      answer("revenue_growth", 10),
      answer("customer_concentration", 45),
      answer("gross_margin", 70, { evidenceIds: ["not-in-the-screening"] }),
      answer("runway", 8),
      answer("use_of_funds", null, { answer: "Salg i Tyskland." }),
      answer("round_size", null, { answer: "" }),
      answer("own_1", null, { yes: true }),
      answer("own_2", null),
      answer("own_3", null, { answer: "Deloitte.", evidenceIds: ["ev-2", "ev-2"] }),
    ],
    allowedEvidenceIds: evidence,
  })!;
  const point = (key: string) => result.points.find((item) => item.key === key)!;
  assert.equal(result.stage, "seed");
  assert.equal(result.missingMode, "task");
  assert.deepEqual(
    { status: point("revenue_growth").status, value: point("revenue_growth").value },
    { status: "met", value: 150 },
    "the registry figure wins over the AI's 10 %",
  );
  assert.equal(point("revenue_growth").source, "registry");
  assert.equal(point("customer_concentration").status, "marked");
  assert.equal(point("customer_concentration").source, "material");
  assert.equal(point("gross_margin").status, "missing", "a source the screening did not have");
  assert.equal(point("runway").status, "marked");
  assert.equal(point("use_of_funds").status, "answered");
  assert.equal(point("use_of_funds").answer, "Salg i Tyskland.");
  assert.equal(point("round_size").status, "missing", "no text is no answer");
  assert.equal(point("positive_equity").status, "met");
  assert.equal(point("filing_age").status, "marked");
  assert.deepEqual(
    result.questions.map((question) => [question.key, question.status, question.value]),
    [
      ["own_1", "answered", true],
      ["own_2", "missing", null],
      ["own_3", "answered", null],
    ],
  );
  assert.deepEqual(result.questions[2]?.evidenceIds, ["ev-2"]);
  assert.deepEqual(readEconomyResult(JSON.parse(JSON.stringify(result))), result);
});

test("a registry-only point without accounts is missing, never asked of the AI", () => {
  const setup = readEconomySetup(undefined, "growth");
  const result = evaluateEconomy({
    stage: "growth",
    setup,
    registry: null,
    answers: [answer("positive_equity", null, { yes: true }), answer("filing_age", 3)],
    allowedEvidenceIds: evidence,
  })!;
  for (const key of ["positive_equity", "filing_age", "going_concern", "nibd_ebitda"]) {
    assert.equal(result.points.find((point) => point.key === key)?.status, "missing", key);
  }
});

test("missing figures become one task when the team chose it, and none otherwise", () => {
  const evaluate = (missing: "task" | "unknown", answers: EconomyAnswer[]) =>
    evaluateEconomy({
      stage: "pre_seed",
      setup: readEconomySetup(
        { missing, questions: [{ text: "Hvem er revisor?", answer: "txt" }] },
        "pre_seed",
      ),
      registry: null,
      answers,
      allowedEvidenceIds: evidence,
    });
  const task = economyTask(evaluate("task", [answer("runway", 14)]), "da");
  assert.deepEqual(task, {
    title: "Skaf økonomitallene",
    question:
      "Skaf økonomitallene: brugen af pengene, rundens størrelse og leder, ejerfordeling, «Hvem er revisor?».",
    why: "Interlect kunne ikke finde disse tal i casens materiale eller i registrene. Casen går videre som normalt.",
  });
  assert.equal(economyTask(evaluate("unknown", []), "da"), null);
  const all = [
    answer("runway", 14),
    answer("use_of_funds", null),
    answer("round_size", null),
    answer("founder_ownership", 70),
    answer("own_1", null),
  ];
  assert.equal(economyTask(evaluate("task", all), "da"), null, "nothing is missing");
  assert.equal(economyTask(null, "da"), null);
  assert.equal(economyTask(evaluate("task", []), "en")?.title, "Get the financial figures");
});

test("no economy without a stage or a setup (every version from before T-1093)", () => {
  const setup = readEconomySetup(undefined, "seed");
  const base = { registry: null, answers: [], allowedEvidenceIds: evidence };
  assert.equal(evaluateEconomy({ ...base, stage: null, setup }), null);
  assert.equal(evaluateEconomy({ ...base, stage: "seed", setup: null }), null);
  assert.equal(readEconomyResult({ stage: "x", points: [], questions: [] }), null);
  assert.equal(readEconomyResult(null), null);
});

test("a registry that could not be read is kept apart and never asked for in the task", () => {
  const setup = readEconomySetup(
    { points: { runway: { on: false }, use_of_funds: { on: false }, round_size: { on: false } } },
    "growth",
  );
  const evaluate = (registry: FinanceGateContext | null) =>
    evaluateEconomy({
      stage: "growth",
      setup: readEconomySetup(
        {
          points: Object.fromEntries(
            setup.points
              .filter((point) => point.key !== "positive_equity")
              .map((point) => [point.key, { on: false }]),
          ),
        },
        "growth",
      ),
      registry,
      answers: [],
      allowedEvidenceIds: evidence,
    })!;
  const reason = (registry: FinanceGateContext | null) =>
    evaluate(registry).points[0]?.missingReason;
  assert.equal(reason(context({}, { loadError: true })), "load_error");
  assert.equal(reason(context({ equity: 3 }, { identityConfirmed: false })), "identity_unsure");
  assert.equal(reason(null), "not_found");
  assert.equal(reason(context({})), "not_found");
  assert.equal(economyTask(evaluate(context({}, { loadError: true })), "da"), null);
  assert.equal(economyTask(evaluate(null), "da")?.question, "Skaf økonomitallene: egenkapital.");
});
