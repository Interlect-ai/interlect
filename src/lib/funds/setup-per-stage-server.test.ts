/**
 * the server side of Teamopsætning pr. stadie (session 4): the setup the server saves, the publish
 * limits per stage, the save arguments, the
 * AI proposals on a setup per stage and the redaction of the setup's prompt texts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  economyQuestionsByStage,
  hasSetup,
  readStoredSetup,
  setupInputSchema,
  toStoredSetup,
} from "./setup-input.ts";
import { checkConfigLimits } from "./config-limits.ts";
import { saveDraftRpcArgs } from "./save-draft-args.ts";
import {
  applyConfigOps,
  draftFingerprint,
  sharedRowsOnly,
  type DraftFields,
} from "./config-ops.ts";
import { redactOverrides } from "./override-redaction.ts";
import { fixedRuleDefault } from "./fixed-rules.ts";

const criterion = (key: string, weight: number, stage?: string) => ({
  key,
  label: key,
  description: `${key} beskrevet`,
  category: "team_market_fit" as const,
  weight,
  ...(stage ? { stage: stage as "seed" } : {}),
});

const shared = [criterion("team", 40), criterion("market", 30), criterion("product", 30)];
const seedOnly = [
  criterion("team", 40, "seed"),
  criterion("market", 30, "seed"),
  criterion("product", 30, "seed"),
];

test("the setup is stored cleaned, with an entry for every chosen stage", () => {
  const stored = toStoredSetup(
    {
      about: "  Vi er et klimahold.  ",
      fixedRules: { compare_dates: "Sammenlign altid datoerne." },
      stages: { seed: { threshold: 65, economy: { missing: "unknown", points: {} } } },
    },
    ["Pre-seed", "seed", "Serie B+"],
  );
  assert.deepEqual(stored, {
    about: "Vi er et klimahold.",
    fixed_rules: { compare_dates: "Sammenlign altid datoerne." },
    // "Serie B+" is the stage series_b; an empty economy part is left out.
    stages: {
      seed: { threshold: 65, economy: { missing: "unknown" } },
      pre_seed: {},
      series_b: {},
    },
  });
  // A stage the team did not choose keeps its own part when it has one.
  assert.deepEqual(toStoredSetup({ stages: { buyout: { threshold: 80 } } }, []), {
    stages: { buyout: { threshold: 80 } },
  });
});

test("a fixed rule set back to its standard text is not stored (Nulstil)", () => {
  const stored = toStoredSetup(
    { fixedRules: { compare_dates: fixedRuleDefault("compare_dates", "da") } },
    [],
  );
  assert.equal(stored.fixed_rules, undefined);
});

test("the editor's setup refuses locked rules, unknown keys and bad values", () => {
  assert.equal(setupInputSchema.safeParse({ fixedRules: { evidence_only: "x" } }).success, false);
  assert.equal(setupInputSchema.safeParse({ risk: "high" }).success, false);
  assert.equal(setupInputSchema.safeParse({ stages: { unknown: {} } }).success, false);
  assert.equal(setupInputSchema.safeParse({ stages: { seed: { threshold: 101 } } }).success, false);
  assert.equal(
    setupInputSchema.safeParse({ stages: { seed: { economy: { points: { nope: {} } } } } }).success,
    false,
  );
  assert.equal(
    setupInputSchema.safeParse({
      stages: {
        seed: {
          threshold: 60,
          economy: {
            points: { runway: { on: true, threshold: 18 } },
            questions: [{ text: "Har I en CFO?", answer: "yn" }],
            missing: "task",
          },
        },
      },
    }).success,
    true,
  );
  assert.equal(setupInputSchema.safeParse({ about: "x".repeat(3001) }).success, false);
});

test("a stored setup reads back in the editor's shape; an old version is {}", () => {
  assert.deepEqual(readStoredSetup({}), {});
  assert.deepEqual(readStoredSetup(null), {});
  assert.equal(hasSetup(readStoredSetup({})), false);
  const read = readStoredSetup({
    about: "Hold",
    fixed_rules: { compare_dates: "Datoer.", evidence_only: "låst" },
    stages: { seed: { threshold: 70 } },
  });
  assert.deepEqual(read, {
    about: "Hold",
    fixedRules: { compare_dates: "Datoer." },
    stages: { seed: { threshold: 70 } },
  });
  assert.equal(hasSetup(read), true);
});

test("the own economy questions per stage come from the setup", () => {
  assert.deepEqual(
    economyQuestionsByStage({
      stages: {
        seed: { economy: { questions: [{ text: "Har I en CFO?", answer: "yn" }] } },
        series_a: {},
      },
    }),
    { seed: ["Har I en CFO?"] },
  );
});

test("the weights add up per stage: the shared list and each stage's own", () => {
  const ok = checkConfigLimits({
    criteria: [
      ...shared,
      criterion("team", 40, "seed"),
      criterion("product", 30, "seed"),
      criterion("traction", 30, "seed"),
    ],
    gates: [],
    analysisThreshold: 70,
  });
  assert.deepEqual(ok, []);

  const off = checkConfigLimits({
    criteria: [...shared, criterion("team", 40, "seed")],
    gates: [],
    analysisThreshold: 70,
  });
  assert.equal(off.length, 1);
  assert.equal(off[0]?.code, "weight_sum");
  assert.equal(off[0]?.key, "seed");
});

test("the same key may stand once shared and once per stage, but not twice in one list", () => {
  const twice = checkConfigLimits({
    criteria: [
      criterion("team", 40, "seed"),
      criterion("team", 30, "seed"),
      criterion("market", 30, "seed"),
    ],
    gates: [
      { key: "geo", stage: null },
      { key: "geo", stage: "seed" },
      { key: "geo", stage: "seed" },
    ],
    analysisThreshold: 70,
  });
  assert.deepEqual(
    twice.map((violation) => violation.code),
    ["duplicate_criterion", "duplicate_gate"],
  );
});

test("a chosen stage with no criteria of its own and no shared ones is refused", () => {
  const violations = checkConfigLimits({
    criteria: seedOnly,
    gates: [],
    analysisThreshold: 70,
    stages: ["seed", "series_a"],
  });
  assert.deepEqual(
    violations.map((violation) => [violation.code, violation.key]),
    [["no_criteria", "series_a"]],
  );
  // With shared criteria the stage reads those, as the analysis does.
  assert.deepEqual(
    checkConfigLimits({
      criteria: [...shared, ...seedOnly],
      gates: [],
      analysisThreshold: 70,
      stages: ["seed", "series_a"],
    }),
    [],
  );
});

test("the setup's texts count in the stage's text budget at publish", () => {
  const long = "x".repeat(290);
  const violations = checkConfigLimits({
    // 2,000 + 3,000 + 600 shared, and the stage's 10 questions take it past 8,000.
    thesis: "t".repeat(2000),
    criteria: seedOnly,
    gates: [],
    analysisThreshold: 70,
    setup: {
      about: "y".repeat(3000),
      fixedRules: { compare_dates: "z".repeat(600) },
      stages: {
        seed: {
          economy: {
            questions: Array.from({ length: 10 }, (_, index) => ({
              text: `${index} ${long}`,
              answer: "txt" as const,
            })),
          },
        },
      },
    },
  });
  assert.deepEqual(
    violations.map((violation) => [violation.code, violation.key]),
    [["team_text_budget", "seed"]],
  );
});

const base = {
  configId: "00000000-0000-4000-8000-000000000001",
  fundName: "Team",
  strategyType: "venture" as const,
  thesis: "Tese",
  stages: ["seed"],
  geographies: ["Norden"],
  sectors: ["Klima"],
  fundSizeEur: null,
  ticketMinEur: null,
  ticketMaxEur: null,
  ticketNote: "",
  analysisThreshold: 70,
  approvalMode: "partner_approval" as const,
  riskPosture: "",
  stageExpectations: {},
  dealbreakers: [],
  gates: [],
  criteria: [criterion("team", 100, "seed")],
};

test("only a save of the whole setup sends _setup (old editors replace only the shared rows)", () => {
  const { setup: _none, ...old } = { ...base, setup: undefined };
  assert.equal("_setup" in saveDraftRpcArgs(old), false);
  const args = saveDraftRpcArgs({ ...base, setup: { about: "Hold" } });
  assert.deepEqual(args._setup, { about: "Hold", stages: { seed: {} } });
  assert.equal((args._criteria[0] as { stage?: string }).stage, "seed");
});

test("an AI proposal changes only the shared rules and criteria, never a stage's own", () => {
  const draft: DraftFields = {
    ...base,
    criteria: [
      criterion("team", 40),
      criterion("market", 30),
      criterion("team", 60, "seed"),
      criterion("market", 40, "seed"),
    ],
    gates: [
      { key: "geo", label: "Norden", description: "Nordisk", treatment: "hard" },
      { key: "geo", label: "Norden", description: "Nordisk", treatment: "review", stage: "seed" },
    ],
    setup: { about: "Hold" },
  };
  const { draft: next, errors } = applyConfigOps(draft, [
    { op: "set_weight", key: "team", weight: 40 },
    { op: "set_weight", key: "market", weight: 60 },
    { op: "set_gate_treatment", key: "geo", treatment: "review" },
    { op: "remove_gate", key: "geo" },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    next.criteria.map((item) => [item.stage ?? null, item.key, item.weight]),
    [
      [null, "team", 40],
      [null, "market", 60],
      ["seed", "team", 60],
      ["seed", "market", 40],
    ],
  );
  assert.deepEqual(
    next.gates.map((item) => [item.stage ?? null, item.treatment]),
    [["seed", "review"]],
  );
  assert.deepEqual(next.setup, { about: "Hold" });
});

test("an old draft's fingerprint is unchanged: no stage and no setup are added", () => {
  const old: DraftFields = { ...base, criteria: [criterion("team", 100)] };
  const fingerprint = draftFingerprint(old);
  assert.equal(draftFingerprint(JSON.parse(JSON.stringify(old)) as DraftFields), fingerprint);
  assert.notEqual(draftFingerprint({ ...old, setup: { about: "Hold" } }), fingerprint);
});

test("the setup's prompt texts and the stages' module texts are emptied for who may not configure", () => {
  const config = {
    moduleOverrides: { people_team: { mandate: ["a"], evidenceTests: ["b"], riskAreas: ["c"] } },
    researchModuleOverrides: {},
    stageModuleOverrides: {
      seed: { people_team: { mandate: ["d"], evidenceTests: ["e"], riskAreas: ["f"] } },
    },
    setup: {
      about: "Hold",
      fixedRules: { compare_dates: "Datoer." },
      stages: {
        seed: {
          threshold: 60,
          economy: { questions: [{ text: "Har I en CFO?", answer: "yn" as const }] },
        },
      },
    },
  };
  assert.deepEqual(redactOverrides(config, true), config);
  const shown = redactOverrides(config, false);
  assert.deepEqual(shown.stageModuleOverrides, {
    seed: { people_team: { mandate: [], evidenceTests: [], riskAreas: [] } },
  });
  assert.deepEqual(shown.setup, {
    about: "",
    fixedRules: { compare_dates: "" },
    stages: { seed: { threshold: 60, economy: { questions: [{ text: "", answer: "yn" }] } } },
  });
});

test("a stored setup with one unreadable part keeps every other part (a save never wipes it)", () => {
  const read = readStoredSetup({
    about: "Hold",
    fixed_rules: { compare_dates: "Datoer." },
    stages: {
      seed: {
        threshold: 65,
        economy: {
          points: { runway: { on: true, threshold: 18 }, renamed_point: { on: true } },
          questions: [
            { text: "Har I en CFO?", answer: "yn" },
            { text: "", answer: "yn" },
          ],
          missing: "sometimes",
        },
      },
      series_z: { threshold: 50 },
      series_a: { threshold: 300 },
    },
  });
  assert.deepEqual(read, {
    about: "Hold",
    fixedRules: { compare_dates: "Datoer." },
    stages: {
      seed: {
        threshold: 65,
        economy: {
          points: { runway: { on: true, threshold: 18 } },
          questions: [{ text: "Har I en CFO?", answer: "yn" }],
        },
      },
      series_a: {},
    },
  });
});

test("the AI proposals' model input and diff hold only the shared rows", () => {
  const draft: DraftFields = {
    ...base,
    criteria: [criterion("team", 40), criterion("team", 60, "seed")],
    gates: [{ key: "geo", label: "Norden", description: "x", treatment: "hard", stage: "seed" }],
  };
  const shared = sharedRowsOnly(draft);
  assert.deepEqual(
    shared.criteria.map((item) => [item.stage ?? null, item.weight]),
    [[null, 40]],
  );
  assert.deepEqual(shared.gates, []);
});
