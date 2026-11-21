/** The Interlect-Assistent's request, its checked proposal and what Ja / Fortryd do. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assistantRequestSchema,
  assistantUserPrompt,
  normalizeChange,
  readAssistantOutput,
  type AssistantChange,
  type AssistantSnapshot,
} from "./setup-assistant.ts";
import { applyChange, applyFocusChange, isFocusChange } from "./setup-assistant-apply.ts";
import { criteriaOf, economyOf, gatesOf } from "./stage-editor.ts";
import type { SaveFundConfigInput } from "./config.functions.ts";

const snapshot = (patch: Partial<AssistantSnapshot> = {}): AssistantSnapshot => ({
  place: "screening",
  sheet: "crit",
  stage: "seed",
  stageLabel: "Seed",
  field: null,
  teamName: "Interlect Demo",
  thesis: "Vi investerer i software.",
  about: "",
  stages: ["Seed"],
  geographies: ["Norden"],
  sectors: ["Software"],
  ticket: "1-3 mio. EUR",
  criteria: [
    { key: "team", label: "Team", weight: 50, description: "Erfarne founders." },
    { key: "market", label: "Marked", weight: 50, description: "Stort marked." },
  ],
  rules: [
    {
      key: "geography_fit",
      label: "Geografi",
      treatment: "hard",
      description: "Norden.",
      shared: true,
    },
    {
      key: "rule_3",
      label: "Alder",
      treatment: "review",
      description: "Under 10 år.",
      shared: false,
    },
  ],
  economy: [
    { key: "runway", label: "Runway", on: false, limit: 12, unit: "mdr." },
    { key: "going_concern", label: "Going concern", on: true, limit: null, unit: "" },
  ],
  questions: ["Hvad er burn?"],
  expectation: "",
  specialist: null,
  ...patch,
});

const raw = (patch: Record<string, unknown>) => ({
  kind: "none",
  target: "",
  label: "",
  text: "",
  treatment: "none",
  points: [],
  on: true,
  value: 0,
  questions: [],
  ...patch,
});

test("request: keeps the newest messages and needs the person's message last", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    text: `m${i}`,
  }));
  messages.push({ role: "user", text: "sidste" });
  const parsed = assistantRequestSchema.parse({
    fundId: "00000000-0000-4000-8000-000000000001",
    messages,
    snapshot: snapshot(),
  });
  assert.equal(parsed.messages.length, 16);
  assert.equal(parsed.messages.at(-1)?.text, "sidste");
  assert.throws(() =>
    assistantRequestSchema.parse({
      fundId: "00000000-0000-4000-8000-000000000001",
      messages: [{ role: "assistant", text: "hej" }],
      snapshot: snapshot(),
    }),
  );
  const prompt = JSON.parse(assistantUserPrompt(parsed));
  assert.equal(prompt.where.stage, "Seed");
  assert.equal(prompt.conversation.length, 16);
});

test("a question gives no change; a change that fits the page is kept", () => {
  assert.equal(normalizeChange(raw({}), snapshot()), null);
  assert.deepEqual(
    normalizeChange(
      raw({ kind: "text", target: "criterion:team", text: "Founders med erfaring." }),
      snapshot(),
    ),
    { kind: "text", target: "criterion:team", text: "Founders med erfaring." },
  );
});

test("a change that names something missing, changes nothing or is too long is dropped", () => {
  const s = snapshot();
  assert.equal(
    normalizeChange(raw({ kind: "text", target: "criterion:nope", text: "x" }), s),
    null,
  );
  assert.equal(
    normalizeChange(
      raw({ kind: "text", target: "thesis", text: " Vi investerer i  software. " }),
      s,
    ),
    null,
  );
  assert.equal(
    normalizeChange(raw({ kind: "text", target: "rule:rule_3", text: "x".repeat(1001) }), s),
    null,
  );
  assert.equal(
    normalizeChange(raw({ kind: "add_criterion", label: "team", text: "dublet" }), s),
    null,
  );
  assert.equal(
    normalizeChange(raw({ kind: "rule_treatment", target: "rule_3", treatment: "review" }), s),
    null,
  );
  assert.equal(
    normalizeChange(raw({ kind: "economy_on", points: ["going_concern", "nope"], on: true }), s),
    null,
  );
  assert.equal(
    normalizeChange(raw({ kind: "economy_limit", target: "going_concern", value: 3 }), s),
    null,
  );
  assert.equal(normalizeChange(raw({ kind: "add_focus", label: "X", text: "Y" }), s), null);
  assert.equal(normalizeChange(raw({ kind: "made_up" }), s), null);
});

test("without a stage only the thesis, the about text and shared rules can change", () => {
  const s = snapshot({ stage: null, stageLabel: "" });
  assert.equal(
    normalizeChange(raw({ kind: "add_criterion", label: "Klima", text: "CO2" }), s),
    null,
  );
  assert.equal(
    normalizeChange(raw({ kind: "text", target: "criterion:team", text: "Nyt" }), s),
    null,
  );
  assert.ok(normalizeChange(raw({ kind: "text", target: "thesis", text: "Ny tese." }), s));
  assert.ok(
    normalizeChange(
      raw({ kind: "rule_treatment", target: "geography_fit", treatment: "review" }),
      s,
    ),
  );
  assert.equal(
    normalizeChange(raw({ kind: "rule_treatment", target: "rule_3", treatment: "hard" }), s),
    null,
  );
});

test("own questions: duplicates and overflow are left out, the answer kind defaults to text", () => {
  const change = normalizeChange(
    raw({
      kind: "add_questions",
      questions: [
        { text: "hvad er burn?", answer: "num" },
        { text: "Hvem er største kunde?", answer: "weird" },
      ],
    }),
    snapshot(),
  );
  assert.deepEqual(change, {
    kind: "add_questions",
    questions: [{ text: "Hvem er største kunde?", answer: "txt" }],
  });
});

test("readAssistantOutput: words stay when the change is dropped; broken JSON throws", () => {
  const reply = readAssistantOutput(
    JSON.stringify({
      answer: "Her er et forslag.",
      change: raw({ kind: "text", target: "nope", text: "x" }),
    }),
    snapshot(),
  );
  assert.deepEqual(reply, { answer: "Her er et forslag.", change: null });
  assert.throws(() => readAssistantOutput("{", snapshot()));
  assert.throws(() =>
    readAssistantOutput(JSON.stringify({ answer: " ", change: raw({}) }), snapshot()),
  );
});

// ---------------------------------------------------------------------------
// Ja and Fortryd
// ---------------------------------------------------------------------------

const editor = (): SaveFundConfigInput =>
  ({
    configId: "00000000-0000-4000-8000-000000000002",
    fundName: "Interlect Demo",
    strategyType: "venture",
    thesis: "Vi investerer i software.",
    stages: ["Seed"],
    geographies: [],
    sectors: [],
    fundSizeEur: null,
    ticketMinEur: null,
    ticketMaxEur: null,
    ticketNote: "",
    analysisThreshold: 60,
    approvalMode: "partner_approval",
    riskPosture: "",
    stageExpectations: {},
    dealbreakers: [],
    gates: [
      { key: "geography_fit", label: "Geografi", description: "Norden.", treatment: "hard" },
      {
        key: "rule_3",
        label: "Alder",
        description: "Under 10 år.",
        treatment: "review",
        stage: "seed",
      },
    ],
    criteria: [
      {
        key: "team",
        label: "Team",
        description: "Erfarne.",
        category: "team_execution",
        weight: 50,
        stage: "seed",
      },
      {
        key: "market",
        label: "Marked",
        description: "Stort.",
        category: "market_timing",
        weight: 50,
        stage: "seed",
      },
    ],
    setup: {},
  }) as SaveFundConfigInput;

const context = { stage: "seed" as const, rawStage: "Seed" };

test("Ja on a text, then Fortryd puts only that text back", () => {
  const change: AssistantChange = { kind: "text", target: "criterion:team", text: "Founders." };
  const applied = applyChange(editor(), change, context)!;
  assert.equal(criteriaOf(applied.next, "seed")[0]!.description, "Founders.");
  // Another edit after the Ja survives the undo.
  const later = { ...applied.next, thesis: "Ændret bagefter." };
  const undone = applied.undo(later)!;
  assert.equal(criteriaOf(undone, "seed")[0]!.description, "Erfarne.");
  assert.equal(undone.thesis, "Ændret bagefter.");
});

test("a new criterion spreads the weights; Fortryd removes it and restores the weights", () => {
  const applied = applyChange(
    editor(),
    { kind: "add_criterion", label: "Klima", description: "CO2-effekt." },
    context,
  )!;
  const criteria = criteriaOf(applied.next, "seed");
  assert.equal(criteria.length, 3);
  assert.equal(Math.round(criteria.reduce((sum, c) => sum + c.weight, 0)), 100);
  assert.equal(criteria[2]!.key, applied.createdKey);
  const undone = applied.undo(applied.next)!;
  assert.deepEqual(
    criteriaOf(undone, "seed").map((c) => [c.key, c.weight]),
    [
      ["team", 50],
      ["market", 50],
    ],
  );
  // Removed by hand in the meantime: nothing to put back.
  assert.equal(applied.undo(undone), null);
});

test("a new rule starts as op til vurdering; treatment and economy changes undo exactly", () => {
  const rule = applyChange(
    editor(),
    { kind: "add_rule", label: "Klima", description: "CO2." },
    context,
  )!;
  const added = gatesOf(rule.next, "seed").find((gate) => gate.key === rule.createdKey)!;
  assert.equal(added.treatment, "review");
  assert.equal(gatesOf(rule.undo(rule.next)!, "seed").length, 2);

  const hard = applyChange(
    editor(),
    { kind: "rule_treatment", ruleKey: "rule_3", treatment: "hard" },
    context,
  )!;
  assert.equal(gatesOf(hard.next, "seed").find((g) => g.key === "rule_3")!.treatment, "hard");
  assert.equal(
    gatesOf(hard.undo(hard.next)!, "seed").find((g) => g.key === "rule_3")!.treatment,
    "review",
  );

  const on = applyChange(editor(), { kind: "economy_on", points: ["runway"], on: true }, context)!;
  assert.equal(economyOf(on.next, "seed").points.find((p) => p.key === "runway")!.on, true);
  assert.deepEqual(on.undo(on.next)!.setup?.stages?.seed?.economy?.points, {});

  const limit = applyChange(
    editor(),
    { kind: "economy_limit", point: "runway", value: 18 },
    context,
  )!;
  const point = economyOf(limit.next, "seed").points.find((p) => p.key === "runway")!;
  assert.equal(point.on, true);
  assert.equal(point.limit?.value, 18);
});

test("own questions are added and Fortryd removes only those", () => {
  const applied = applyChange(
    editor(),
    { kind: "add_questions", questions: [{ text: "Hvad er burn?", answer: "num" }] },
    context,
  )!;
  assert.deepEqual(
    economyOf(applied.next, "seed").questions.map((q) => q.text),
    ["Hvad er burn?"],
  );
  assert.deepEqual(economyOf(applied.undo(applied.next)!, "seed").questions, []);
});

test("the expectation and the about text are written where the editor keeps them", () => {
  const expectation = applyChange(
    editor(),
    { kind: "text", target: "expectation", text: "Kunder." },
    context,
  )!;
  assert.equal(expectation.next.stageExpectations["Seed"], "Kunder.");
  assert.equal(expectation.undo(expectation.next)!.stageExpectations["Seed"], "");
  const about = applyChange(
    editor(),
    { kind: "text", target: "about", text: "Vi er to." },
    context,
  )!;
  assert.equal(about.next.setup?.about, "Vi er to.");
});

test("focus areas: added and rewritten on the sheet's list, with undo", () => {
  const foci = [{ title: "Kunder", text: "Betalende kunder.", evidence: "" }];
  const add: AssistantChange = { kind: "add_focus", title: "Team", text: "Erfaring." };
  assert.equal(isFocusChange(add), true);
  assert.equal(applyChange(editor(), add, context), null);
  const added = applyFocusChange(foci, add)!;
  assert.equal(added.next.length, 2);
  assert.deepEqual(added.undo(added.next), foci);
  const rewrite = applyFocusChange(foci, { kind: "text", target: "focus:0", text: "Ny tekst." })!;
  assert.equal(rewrite.next[0]!.text, "Ny tekst.");
  assert.equal(rewrite.undo(rewrite.next)![0]!.text, "Betalende kunder.");
  assert.equal(applyFocusChange(foci, { kind: "text", target: "focus:4", text: "x" }), null);
});

test("Fortryd never throws away what the person did after the Ja", () => {
  const thesis = applyChange(editor(), { kind: "text", target: "thesis", text: "Ny." }, context)!;
  assert.equal(thesis.undo({ ...thesis.next, thesis: "Ny. Og mere skrevet bagefter." }), null);

  const on = applyChange(editor(), { kind: "economy_on", points: ["runway"], on: true }, context)!;
  const limitByHand = {
    ...on.next,
    setup: {
      stages: { seed: { economy: { points: { runway: { on: true, threshold: 9 } } } } },
    },
  } as SaveFundConfigInput;
  assert.equal(on.undo(limitByHand), null);

  const focus = applyFocusChange([{ title: "Kunder", text: "Gammel.", evidence: "" }], {
    kind: "text",
    target: "focus:0",
    text: "Ny.",
  })!;
  assert.equal(focus.undo([{ title: "Kunder", text: "Ny. Rettet.", evidence: "" }]), null);
});

test("a shared rule changed in a stage: Fortryd removes the stage's copy again", () => {
  const value = {
    ...editor(),
    gates: [
      ...editor().gates,
      { key: "esg", label: "ESG", description: "Delt.", treatment: "review" as const },
    ],
  };
  const applied = applyChange(
    value,
    { kind: "rule_treatment", ruleKey: "esg", treatment: "hard" },
    context,
  )!;
  assert.equal(applied.next.gates.filter((gate) => gate.key === "esg").length, 2);
  const undone = applied.undo(applied.next)!;
  assert.deepEqual(
    undone.gates.filter((gate) => gate.key === "esg").map((gate) => gate.stage ?? null),
    [null],
  );
});

test("a focus text proposal is not made on a list that has moved", () => {
  const foci = [{ title: "Team", text: "x", evidence: "" }];
  assert.equal(
    applyFocusChange(foci, { kind: "text", target: "focus:0", text: "y" }, "Kunder"),
    null,
  );
});
