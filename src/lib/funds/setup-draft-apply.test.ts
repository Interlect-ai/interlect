/** The draft laid into the editor, and the waiting screen's progress. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStageDrafts,
  draftFrameOf,
  draftModuleTexts,
  stagesWithOwnContent,
} from "./setup-draft-apply.ts";
import {
  PREPARE_STEPS,
  orbStateOf,
  parseDraftLine,
  reduceProgress,
  startProgress,
  streamSetupDraft,
} from "./setup-draft-client.ts";
import { setupDraftRequestSchema, type StageDraft } from "./setup-draft.ts";
import type { SaveFundConfigInput } from "./config.functions.ts";

const base = {
  configId: "11111111-1111-4111-8111-111111111111",
  fundName: "Nordhav Ventures III",
  strategyType: "venture",
  thesis: "Vi bakker nordiske B2B-selskaber.",
  stages: ["Seed", "Series A"],
  geographies: ["Norden"],
  sectors: ["B2B-software"],
  fundSizeEur: null,
  ticketMinEur: 500_000,
  ticketMaxEur: 2_000_000,
  ticketNote: "",
  analysisThreshold: 70,
  approvalMode: "partner_approval",
  riskPosture: "",
  stageExpectations: { Seed: "gammel" },
  dealbreakers: [],
  gates: [
    { key: "stage_fit", label: "Stadie", description: "", treatment: "hard", stage: null },
    { key: "own_seed", label: "Gammel", description: "", treatment: "review", stage: "seed" },
  ],
  criteria: [
    {
      key: "old",
      label: "Gammelt",
      description: "",
      category: "fund_thesis_fit",
      weight: 100,
      stage: "seed",
    },
    {
      key: "shared",
      label: "Delt",
      description: "",
      category: "fund_thesis_fit",
      weight: 100,
    },
  ],
  setup: { about: "Vi er et lille team.", stages: { series_a: { threshold: 55 } } },
} as unknown as SaveFundConfigInput;

const seedDraft = {
  stage: "seed",
  criteria: [
    {
      key: "team",
      label: "Team",
      description: "Teamet.",
      category: "founder_market_fit",
      weight: 60,
    },
    {
      key: "pain",
      label: "Problem",
      description: "Problemet.",
      category: "fund_thesis_fit",
      weight: 40,
    },
  ],
  rules: [{ key: "ticket", label: "Ticket", description: "Under 2 mio.", treatment: "hard" }],
  economy: {
    points: { gross_margin: { on: true, threshold: 55 } },
    questions: [],
    missing: "task",
  },
  threshold: 72,
  expectation: "Forvent betalende kunder.",
  specialists: [
    {
      key: "team_founders",
      foci: [{ title: "Founderne", text: "Hvem er de?", evidence: "CV" }],
      riskAreas: ["Founderne"],
    },
  ],
  consistency: { problems: 0, fixed: 0 },
} as unknown as StageDraft;

test("draftFrameOf: the thesis as the editor has it, passing the request schema", () => {
  const frame = draftFrameOf(base);
  assert.equal(frame.thesisName, "Nordhav Ventures III");
  assert.equal(frame.about, "Vi er et lille team.");
  // Only the shared rules are the shared mandate, never a stage's own.
  assert.deepEqual(
    frame.sharedRules.map((rule) => rule.key),
    ["stage_fit"],
  );
  const parsed = setupDraftRequestSchema.safeParse({
    fundId: "22222222-2222-4222-8222-222222222222",
    configId: base.configId,
    frame,
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test("stagesWithOwnContent: stages a new draft would replace", () => {
  assert.deepEqual(stagesWithOwnContent(base), ["seed"]);
  assert.deepEqual(stagesWithOwnContent({ ...base, criteria: [], gates: [], setup: {} }), []);
});

test("applyStageDrafts: replaces the stage's own rows, keeps the shared and the other stages", () => {
  const next = applyStageDrafts(base, [seedDraft]);
  assert.deepEqual(
    next.criteria.map((criterion) => [criterion.key, criterion.stage ?? null]),
    [
      ["shared", null],
      ["team", "seed"],
      ["pain", "seed"],
    ],
  );
  assert.deepEqual(
    next.gates.map((gate) => [gate.key, gate.stage ?? null]),
    [
      ["stage_fit", null],
      ["ticket", "seed"],
    ],
  );
  assert.equal(next.setup?.stages?.["seed"]?.threshold, 72);
  assert.equal(next.setup?.stages?.["seed"]?.economy?.missing, "task");
  // A stage without a draft is left as it was.
  assert.equal(next.setup?.stages?.["series_a"]?.threshold, 55);
  assert.equal(next.setup?.about, "Vi er et lille team.");
  // "Hvad forventer I?" is keyed by the team's own entry for the stage.
  assert.equal(next.stageExpectations["Seed"], "Forvent betalende kunder.");
});

test("applyStageDrafts: no draft changes nothing", () => {
  assert.equal(applyStageDrafts(base, []), base);
});

test("draftModuleTexts: one text per stage and specialist, a focus area per line", () => {
  const texts = draftModuleTexts([seedDraft]);
  assert.equal(texts.length, 1);
  assert.equal(texts[0]!.stage, "seed");
  assert.equal(texts[0]!.moduleId, "team_founders");
  assert.deepEqual(texts[0]!.mandate, ["Founderne: Hvem er de?"]);
});

test("parseDraftLine: known events pass, broken or unknown lines are skipped", () => {
  assert.equal(parseDraftLine(""), null);
  assert.equal(parseDraftLine("{not json"), null);
  assert.equal(parseDraftLine('{"type":"mystery"}'), null);
  assert.deepEqual(parseDraftLine('{"type":"start","stages":["seed"]}'), {
    type: "start",
    stages: ["seed"],
  });
});

test("reduceProgress: three steps first, then the stage's five, then a summary", () => {
  let progress = startProgress(["seed", "series_a"]);
  assert.equal(orbStateOf(progress), "searching");
  progress = reduceProgress(progress, { type: "step", phase: "prepare", step: 1 });
  assert.equal(progress.prepare, 1);
  progress = reduceProgress(progress, { type: "step", phase: "prepare", step: 2 });
  progress = reduceProgress(progress, { type: "step", phase: "stage", stage: "seed", step: 1 });
  assert.equal(progress.prepare, PREPARE_STEPS);
  assert.equal(progress.current, "seed");
  assert.equal(orbStateOf(progress), "solving");
  progress = reduceProgress(progress, { type: "step", phase: "stage", stage: "seed", step: 2 });
  assert.equal(orbStateOf(progress), "composing");
  progress = reduceProgress(progress, {
    type: "stage_done",
    stage: "seed",
    draft: seedDraft,
    summary: { criteria: 2, points: 3, specialists: 4 },
  });
  assert.equal(progress.current, null);
  assert.deepEqual(progress.done["seed"], { criteria: 2, points: 3, specialists: 4 });
  progress = reduceProgress(progress, { type: "stage_failed", stage: "series_a", reason: "time" });
  assert.deepEqual(progress.failed, ["series_a"]);
});

function streamOf(text: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
  );
}

const request = setupDraftRequestSchema.parse({
  fundId: "22222222-2222-4222-8222-222222222222",
  configId: base.configId,
  frame: draftFrameOf(base),
});

async function collect(fetchImpl: typeof fetch) {
  const events = [];
  for await (const event of streamSetupDraft(request, {
    getToken: async () => "token",
    signal: new AbortController().signal,
    fetchImpl,
  })) {
    events.push(event);
  }
  return events;
}

test("streamSetupDraft: yields the events in order and stops at done", async () => {
  const events = await collect(async () =>
    streamOf(
      '{"type":"start","stages":["seed"]}\nbroken\n{"type":"done","stages":["seed"],"research":{"searched":true,"siteRead":false,"previousInvestments":0}}\n',
    ),
  );
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "done"],
  );
});

test("streamSetupDraft: a refusal before the stream keeps its code", async () => {
  const events = await collect(async () => Response.json({ code: "credits" }, { status: 402 }));
  assert.deepEqual(events, [{ type: "refused", code: "credits" }]);
  const unknown = await collect(async () => new Response("no", { status: 500 }));
  assert.deepEqual(unknown, [{ type: "refused", code: "failed" }]);
});

test("streamSetupDraft: a stream that ends without done is an error, never silence", async () => {
  const events = await collect(async () => streamOf('{"type":"start","stages":["seed"]}\n'));
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "error"],
  );
});

test("streamSetupDraft: a network failure is a refusal with a code", async () => {
  const events = await collect(async () => {
    throw new Error("offline");
  });
  assert.deepEqual(events, [{ type: "refused", code: "failed" }]);
});

test("draftFrameOf: stays within the request's limits, so a big team is never refused", () => {
  const big = {
    ...base,
    geographies: Array.from({ length: 45 }, (_, index) => `Land ${index}`),
    sectors: Array.from({ length: 40 }, (_, index) => `Sektor ${index}`),
    thesis: "x".repeat(6000),
    ticketNote: "y".repeat(1500),
    gates: Array.from({ length: 25 }, (_, index) => ({
      key: `rule_${index}`,
      label: `Regel ${index}`,
      description: "",
      treatment: "review" as const,
      stage: null,
    })),
  } as unknown as SaveFundConfigInput;
  const parsed = setupDraftRequestSchema.safeParse({
    fundId: "22222222-2222-4222-8222-222222222222",
    configId: base.configId,
    frame: draftFrameOf(big),
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test("applyStageDrafts: every entry of the team for a stage gets the expectation", () => {
  const twice = { ...base, stages: ["seed", "Seed"], stageExpectations: {} } as SaveFundConfigInput;
  const next = applyStageDrafts(twice, [seedDraft]);
  assert.equal(next.stageExpectations["seed"], "Forvent betalende kunder.");
  assert.equal(next.stageExpectations["Seed"], "Forvent betalende kunder.");
});
