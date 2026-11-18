import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyConfigOps,
  draftFingerprint,
  FLAT_OP_NAMES,
  mainDraftChanged,
  parseFlatOp,
  screeningChanged,
  type DraftFields,
  type FlatOp,
} from "./config-ops.ts";

const base: DraftFields = {
  fundName: "Test Ventures",
  strategyType: "venture",
  thesis: "Vi investerer i nordisk B2B SaaS.",
  stages: ["seed"],
  geographies: ["Danmark"],
  sectors: ["B2B SaaS"],
  fundSizeEur: null,
  ticketMinEur: 500_000,
  ticketMaxEur: 2_000_000,
  ticketNote: "",
  analysisThreshold: 70,
  approvalMode: "partner_approval",
  riskPosture: "Moderat.",
  stageExpectations: {},
  dealbreakers: [],
  gates: [{ key: "geo", label: "Geografi", description: "Nordisk.", treatment: "hard" }],
  criteria: [
    {
      key: "team",
      label: "Team",
      description: "Stærkt team.",
      category: "founder_market_fit",
      weight: 50,
    },
    {
      key: "market",
      label: "Marked",
      description: "Stort marked.",
      category: "market_timing",
      weight: 50,
    },
  ],
};

function flat(partial: Partial<FlatOp> & { op: string }): FlatOp {
  return {
    target: null,
    text: null,
    number: null,
    values: null,
    treatment: null,
    category: null,
    label: null,
    ...partial,
  };
}

test("edits are applied to a copy and the draft itself is untouched", () => {
  const before = JSON.stringify(base);
  const result = applyConfigOps(base, [
    { op: "set_thesis", text: "Ny tese." },
    { op: "set_threshold", number: 65 },
    { op: "set_weight", key: "team", weight: 40 },
    { op: "set_weight", key: "market", weight: 60 },
  ]);
  assert.equal(JSON.stringify(base), before);
  assert.equal(result.draft.thesis, "Ny tese.");
  assert.equal(result.draft.analysisThreshold, 65);
  assert.deepEqual(result.errors, []);
  // 60 % is over the 40 % limit: shown next to the diff, the proposal itself is still usable.
  assert.deepEqual(
    result.limitViolations.map((v) => v.code),
    ["weight_range"],
  );
});

test("an edit that points at something that does not exist is an error", () => {
  const result = applyConfigOps(base, [
    { op: "set_weight", key: "unknown", weight: 10 },
    { op: "remove_gate", key: "nope" },
    { op: "set_gate_treatment", key: "nope", treatment: "review" },
  ]);
  assert.equal(result.errors.length, 3);
});

test("criteria and gates can be added and removed, and keys stay unique", () => {
  const result = applyConfigOps(base, [
    {
      op: "add_criterion",
      key: "finance",
      label: "Økonomi",
      description: "Sund økonomi.",
      category: "financial_strength",
      weight: 10,
    },
    {
      op: "add_criterion",
      key: "team",
      label: "Dublet",
      description: "x",
      category: "traction_gtm",
      weight: 5,
    },
    {
      op: "add_gate",
      key: "ticket",
      label: "Ticket",
      description: "Inden for ticket.",
      treatment: "review",
    },
    { op: "remove_criterion", key: "market" },
  ]);
  assert.deepEqual(result.errors, ["Kriteriet team findes allerede."]);
  assert.deepEqual(
    result.draft.criteria.map((c) => c.key),
    ["team", "finance"],
  );
  assert.equal(result.draft.criteria.find((c) => c.key === "finance")?.codeAnchor, true);
  assert.deepEqual(
    result.draft.gates.map((g) => g.key),
    ["geo", "ticket"],
  );
});

test("a binding gate can be switched to a review rule and back", () => {
  const review = applyConfigOps(base, [
    { op: "set_gate_treatment", key: "geo", treatment: "review" },
  ]);
  assert.equal(review.draft.gates[0]?.treatment, "review");
});

test("list edits replace the list without duplicates", () => {
  const result = applyConfigOps(base, [
    { op: "set_list", field: "stages", values: ["seed", "series_a", "seed"] },
  ]);
  assert.deepEqual(result.draft.stages, ["seed", "series_a"]);
});

test("the model's flat edits become real edits or are refused with a reason", () => {
  const ok = parseFlatOp(flat({ op: "set_weight", target: "team", number: 35 }));
  assert.deepEqual(ok, { op: { op: "set_weight", key: "team", weight: 35 } });

  const addGate = parseFlatOp(
    flat({
      op: "add_gate",
      target: "ticket",
      label: "Ticket",
      text: "Inden for ticket.",
      treatment: "review",
    }),
  );
  assert.ok("op" in addGate);

  for (const bad of [
    flat({ op: "set_weight", target: "Team!", number: 35 }),
    flat({ op: "set_weight", target: "team", number: null }),
    flat({ op: "set_list", target: "fundName", values: ["x"] }),
    flat({ op: "drop_database" }),
    flat({ op: "set_threshold", number: 400 }),
  ]) {
    assert.ok("error" in parseFlatOp(bad), bad.op);
  }
});

test("the fingerprint changes with any content change and ignores key order", () => {
  const same = draftFingerprint({ ...base });
  assert.equal(draftFingerprint(base), same);
  const reordered = JSON.parse(JSON.stringify(base)) as DraftFields;
  reordered.criteria = reordered.criteria.map((c) =>
    Object.fromEntries(Object.entries(c).reverse()),
  ) as typeof reordered.criteria;
  assert.equal(draftFingerprint(reordered), same);
  assert.notEqual(draftFingerprint({ ...base, thesis: "Andet." }), same);
  assert.notEqual(
    draftFingerprint(applyConfigOps(base, [{ op: "set_weight", key: "team", weight: 49 }]).draft),
    same,
  );
});

import { opsFromResponse, proposalResponseSchema, PROPOSAL_JSON_SCHEMA } from "./config-ops.ts";

test("a model response becomes edits, or is refused as a whole when one edit is invalid", () => {
  const good = proposalResponseSchema.parse({
    summary: "Team vægter mere.",
    ops: [flat({ op: "set_weight", target: "team", number: 40 })],
  });
  const result = opsFromResponse(good);
  assert.ok("ops" in result && result.ops.length === 1);

  const mixed = proposalResponseSchema.parse({
    summary: "x",
    ops: [
      flat({ op: "set_weight", target: "team", number: 40 }),
      flat({ op: "set_weight", target: "x y", number: 1 }),
    ],
  });
  assert.ok("error" in opsFromResponse(mixed));
});

test("a response with no edits or too many edits does not parse", () => {
  assert.equal(proposalResponseSchema.safeParse({ summary: "x", ops: [] }).success, false);
  const many = Array.from({ length: 13 }, () => flat({ op: "set_threshold", number: 60 }));
  assert.equal(proposalResponseSchema.safeParse({ summary: "x", ops: many }).success, false);
});

test("the strict schema lists every field as required, as structured output demands", () => {
  const item = PROPOSAL_JSON_SCHEMA.properties.ops.items;
  assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
});

test("T-861b: the screening instruction and cards are edits like the rest", () => {
  const draft: DraftFields = { ...base, screeningInstruction: "", screeningCards: ["finance"] };
  const instruction = parseFlatOp(
    flat({ op: "set_screening_instruction", text: "  Founders først.  " }),
  );
  assert.ok("op" in instruction);
  // The model is no longer offered the cards, but an older proposal with them still applies.
  const cards = {
    op: "set_screening_cards" as const,
    values: ["market" as const, "team" as const],
  };
  const applied = applyConfigOps(draft, [instruction.op, cards]);
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.draft.screeningInstruction, "Founders først.");
  // Fixed order and each card once, as the database keeps them.
  assert.deepEqual(applied.draft.screeningCards, ["team", "market"]);
  assert.equal(screeningChanged(draft, applied.draft), true);
  assert.equal(screeningChanged(draft, applyConfigOps(draft, []).draft), false);

  const cleared = parseFlatOp(flat({ op: "set_screening_instruction", text: "" }));
  assert.ok("op" in cleared);
  assert.equal(applyConfigOps(applied.draft, [cleared.op]).draft.screeningInstruction, "");

  assert.ok("error" in parseFlatOp(flat({ op: "set_screening_cards", values: ["team"] })));
  assert.ok(!(FLAT_OP_NAMES as readonly string[]).includes("set_screening_cards"));
  assert.ok(
    "error" in parseFlatOp(flat({ op: "set_screening_instruction", text: "x".repeat(3001) })),
  );
  // null from the model means "remove the instruction", not a broken proposal.
  const nulled = parseFlatOp(flat({ op: "set_screening_instruction", text: null }));
  assert.ok(
    "op" in nulled && nulled.op.op === "set_screening_instruction" && nulled.op.text === "",
  );
});

test("T-861b: the screening at its defaults keeps the old fingerprint; only real changes count", () => {
  const withDefaults: DraftFields = {
    ...base,
    screeningInstruction: "",
    screeningCards: ["finance"],
  };
  assert.equal(draftFingerprint(withDefaults), draftFingerprint(base));
  assert.notEqual(
    draftFingerprint({ ...withDefaults, screeningInstruction: "Founders først." }),
    draftFingerprint(base),
  );
  assert.notEqual(
    draftFingerprint({ ...withDefaults, screeningCards: [] }),
    draftFingerprint(base),
  );
  const onlyScreening = { ...withDefaults, screeningCards: ["finance" as const, "team" as const] };
  assert.equal(mainDraftChanged(withDefaults, onlyScreening), false);
  assert.equal(mainDraftChanged(withDefaults, { ...onlyScreening, thesis: "Ny tese." }), true);
});
