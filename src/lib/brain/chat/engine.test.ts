import { capUsd } from "./prompt.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { asSchema, tool, type ToolSet } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { AiDataPolicyError } from "../../ai/gateway-options.ts";
import { MaskingUnavailableError } from "../../ai/model-call.ts";
import { createRedactor } from "../../ai/redact.ts";
import { AI_MODEL_POLICIES } from "../../ai/zdr-models.ts";
import type { ChatRequest, ChatStreamEvent } from "../chat-contract.ts";
import {
  INCOMPLETE_NOTE,
  STOPPED_NOTE,
  incompleteNote,
  stoppedNote,
  planStep,
  prepareChatTurn,
  streamChatTurn,
  type ChatEngineDeps,
  type ChatTurn,
} from "./engine.server.ts";
import type { ChatMessageInsert, ChatStore, ChatThreadRow } from "./store.server.ts";
import type { ChatToolContext } from "./tools.server.ts";

const FUND = "00000000-0000-4000-8000-00000000f001";
const USER = "00000000-0000-4000-8000-00000000u001";
const CASE = "00000000-0000-4000-8000-00000000c001";

const usage = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 200, text: 200, reasoning: 0 },
};
const finish = (reason: "stop" | "tool-calls") => ({
  type: "finish" as const,
  finishReason: { unified: reason, raw: reason },
  usage,
});
const textResult = (parts: string[], delay: number | null = null) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "stream-start" as const, warnings: [] },
      { type: "text-start" as const, id: "t" },
      ...parts.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
      { type: "text-end" as const, id: "t" },
      finish("stop"),
    ],
    initialDelayInMs: null,
    chunkDelayInMs: delay,
  }),
});
const toolResult = (toolName: string, input: unknown) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "stream-start" as const, warnings: [] },
      {
        type: "tool-call" as const,
        toolCallId: "call-1",
        toolName,
        input: JSON.stringify(input),
      },
      finish("tool-calls"),
    ],
    initialDelayInMs: null,
    chunkDelayInMs: null,
  }),
});

type FakeStore = ChatStore & {
  messages: ChatMessageInsert[];
  threads: Array<{ caseId: string | null; title: string }>;
  finalized: Array<{ usd: number; requests: number }>;
  released: number;
  cited: Set<string> | null;
};

function fakeStore(
  options: { reserve?: string | null; threads?: ChatThreadRow[] } = {},
): FakeStore {
  const store: FakeStore = {
    messages: [],
    threads: [],
    finalized: [],
    released: 0,
    cited: null,
    loadThread: async (_fund, id) => options.threads?.find((thread) => thread.id === id) ?? null,
    caseName: async (_fund, id) => (id === CASE ? "Pleo" : null),
    entities: async () => [],
    recentQuestions: async () => 0,
    thesis: async () => "Tese: B2B SaaS i Norden.",
    history: async () => [
      { role: "user", content: "Tidligere spørgsmål" },
      { role: "assistant", content: "Tidligere svar [4]." },
    ],
    createThread: async (input) => {
      store.threads.push({ caseId: input.caseId, title: input.title });
      return "thread-new";
    },
    insertMessage: async (input) => {
      store.messages.push(input);
    },
    reserve: async () => (options.reserve === undefined ? "usage-1" : options.reserve),
    finalize: async (input) => {
      store.finalized.push({ usd: input.usd, requests: input.requests });
      return true;
    },
    release: async () => {
      store.released += 1;
      return true;
    },
    caseNames: async () => new Map([[CASE, "Pleo"]]),
    markCited: async (_fund, _message, keys) => {
      store.cited = new Set(keys);
    },
  };
  return store;
}

function fakeTools(ctx: ChatToolContext): ToolSet {
  return {
    search_brain: tool({
      description: "search",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => {
        const n = ctx.registry.add({
          kind: "chunk",
          id: "chunk-1",
          label: "Note",
          quote: "Pleo har 100 kunder",
          caseId: CASE,
          ref: "case_notes:n1",
        });
        return { results: [{ n, text: "Pleo har 100 kunder" }] };
      },
    }),
  };
}

const request = (extra: Partial<ChatRequest> = {}): ChatRequest => ({
  fundId: FUND,
  threadId: null,
  caseId: null,
  entityIds: [],
  scope: "cases",
  question: "Hvor mange kunder har Pleo?",
  mode: "fast",
  ...extra,
});

const turnFor = (extra: Partial<ChatTurn> = {}): ChatTurn => ({
  fundId: FUND,
  fundName: "Testfond",
  userId: USER,
  request: request(),
  thread: null,
  focusCase: null,
  entities: [],
  ...extra,
});

let ids = 0;
function deps(store: ChatStore, model: MockLanguageModelV4, extra: Partial<ChatEngineDeps> = {}) {
  const afterCalls: string[] = [];
  const value: ChatEngineDeps = {
    store,
    createTools: fakeTools,
    model: () => model,
    redactor: async () => createRedactor({ mask: [{ name: "Line Hansen" }], keep: [] }),
    afterCall: async ({ answer }) => {
      afterCalls.push(answer);
      return { confidence: "high", missing: ["Upload seneste statusrapport"], costUsd: 0.001 };
    },
    newId: () => `id-${++ids}`,
    now: () => new Date("2026-10-04T12:00:00Z"),
    log: () => undefined,
    ...extra,
  };
  return { deps: value, afterCalls };
}

async function collect(stream: AsyncGenerator<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

test("maskering (T-209): modellen ser kun pladsholdere, værktøjet og brugeren de rigtige værdier", async () => {
  const secrets = ["Line Hansen", "line.hansen@privat.dk", "010190-1234"];
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [
      toolResult("search_brain", { query: "[Person 1]" }),
      textResult(["[Person 1] er rådgiver, mail [E-", "mail 1] [1]."]),
    ],
  });
  const queries: string[] = [];
  const { deps: d, afterCalls } = deps(store, model, {
    createTools: (ctx) => ({
      search_brain: tool({
        description: "search",
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => {
          queries.push(query);
          const n = ctx.registry.add({
            kind: "chunk",
            id: "chunk-1",
            label: "Note",
            quote: "Line Hansen",
            caseId: CASE,
            ref: "case_notes:n1",
          });
          return { results: [{ n, text: "Line Hansen, CPR 010190-1234, er rådgiver." }] };
        },
      }),
    }),
  });
  const events = await collect(
    streamChatTurn(
      d,
      turnFor({ request: request({ question: "Hvem er Line Hansen (line.hansen@privat.dk)?" }) }),
      new AbortController().signal,
    ),
  );
  assert.deepEqual(queries, ["Line Hansen"]);
  for (const call of model.doStreamCalls) {
    const prompt = JSON.stringify(call.prompt);
    for (const secret of secrets) assert.ok(!prompt.includes(secret), `${secret} i ${prompt}`);
  }
  const shown = events.map((event) => (event.type === "delta" ? event.text : "")).join("");
  assert.equal(shown, "Line Hansen er rådgiver, mail line.hansen@privat.dk [1].");
  assert.equal(store.messages[1]?.content, shown);
  assert.deepEqual(afterCalls, [shown]);
});

test("maskering (T-209): kan ordbogen ikke hentes, sendes og reserveres intet", async () => {
  const store = fakeStore();
  let reserved = 0;
  const reserve = store.reserve;
  store.reserve = async (input) => {
    reserved += 1;
    return reserve(input);
  };
  const model = new MockLanguageModelV4({ doStream: [textResult(["svar"])] });
  const { deps: d } = deps(store, model, {
    redactor: async () => {
      throw new MaskingUnavailableError();
    },
  });
  const events = await collect(streamChatTurn(d, turnFor(), new AbortController().signal));
  assert.deepEqual(events, [{ type: "error", code: "failed" }]);
  assert.equal(reserved, 0);
  assert.equal(model.doStreamCalls.length, 0);
  assert.equal(store.messages.length, 0);
});

test("et svar: tråd, trin, tekst, kun citerede kilder, done; budget og citater gemmes", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [
      toolResult("search_brain", { query: "Pleo kunder" }),
      textResult(["Pleo har 100 kunder ", "[1]. Omsætningen er ukendt [9]."]),
    ],
  });
  const { deps: d, afterCalls } = deps(store, model);
  const events = await collect(streamChatTurn(d, turnFor(), new AbortController().signal));

  assert.deepEqual(
    events.map((event) => event.type),
    ["thread", "step", "step", "delta", "delta", "sources", "done"],
  );
  assert.deepEqual(events[0], {
    type: "thread",
    threadId: "thread-new",
    title: "Hvor mange kunder har Pleo?",
  });
  assert.deepEqual(
    events
      .filter((event) => event.type === "step")
      .map((event) => event.type === "step" && event.text),
    ["Leder i jeres cases og noter", "Skriver svaret"],
  );
  const sources = events.find((event) => event.type === "sources");
  assert.ok(sources?.type === "sources");
  assert.equal(sources.citations.length, 1);
  assert.equal(sources.citations[0]?.label, "Pleo · Note");
  assert.equal(sources.citations[0]?.ref, "case_notes:n1");
  const done = events.at(-1);
  assert.ok(done?.type === "done");
  assert.equal(done.unsourcedClaims, true);
  assert.equal(done.confidence, "high");
  assert.deepEqual(done.missing, ["Upload seneste statusrapport"]);

  assert.deepEqual(
    store.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  const answer = store.messages[1]!;
  assert.equal(answer.id, done.messageId);
  assert.equal(answer.content, "Pleo har 100 kunder [1]. Omsætningen er ukendt [9].");
  assert.equal(answer.citations?.length, 1);
  assert.deepEqual(
    answer.toolCalls?.map((call) => call.name),
    ["search_brain"],
  );
  assert.equal(afterCalls.length, 1);
  // Two steps at list price (1000 in, 200 out on gpt-5.4-mini) plus the after-call.
  assert.equal(store.finalized.length, 1);
  assert.ok(Math.abs(store.finalized[0]!.usd - (2 * 0.00165 + 0.001)) < 1e-6);
  assert.equal(store.finalized[0]!.requests, 3);
  assert.deepEqual([...(store.cited ?? [])], ["chunk:chunk-1"]);
  // The model never sees the fund's id.
  assert.doesNotMatch(JSON.stringify(model.doStreamCalls[0]?.prompt), new RegExp(FUND));
});

test("månedsloftet er nået: kun en fejl, ingen tråd og ingen besked", async () => {
  const store = fakeStore({ reserve: null });
  const model = new MockLanguageModelV4({ doStream: [textResult(["svar"])] });
  const events = await collect(
    streamChatTurn(deps(store, model).deps, turnFor(), new AbortController().signal),
  );
  assert.deepEqual(events, [{ type: "error", code: "budget_reached" }]);
  assert.equal(store.threads.length, 0);
  assert.equal(store.messages.length, 0);
  assert.equal(model.doStreamCalls.length, 0);
});

test("en eksisterende tråd: ingen thread-hændelse, casen sendes med som kontekst", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({ doStream: [textResult(["Det ved Brain ikke endnu."])] });
  const events = await collect(
    streamChatTurn(
      deps(store, model).deps,
      turnFor({
        thread: { id: "thread-1", userId: USER, caseId: CASE },
        focusCase: { id: CASE, name: "Pleo" },
      }),
      new AbortController().signal,
    ),
  );
  assert.equal(events[0]?.type, "step");
  assert.equal(store.threads.length, 0);
  assert.equal(store.messages[0]?.threadId, "thread-1");
  const done = events.at(-1);
  assert.ok(done?.type === "done");
  assert.equal(done.unsourcedClaims, false);
  const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
  assert.match(prompt, /case \\"Pleo\\"/);
  // The thread's history goes back to the model without the old citation markers.
  assert.match(prompt, /Tidligere svar\./);
  assert.doesNotMatch(prompt, /Tidligere svar \[4\]/);
});

test("Stop midt i svaret: delsvaret gemmes, intet efterkald, budgettet afregnes", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [
      textResult(
        [
          "Første del af svaret er lang nok til at blive vist med det samme. ",
          "Anden del af svaret kommer lidt efter, også den er lang nok. ",
          "Tredje del når brugeren aldrig at se, fordi der er trykket Stop.",
        ],
        30,
      ),
    ],
  });
  const { deps: d, afterCalls } = deps(store, model);
  const controller = new AbortController();
  const events: ChatStreamEvent[] = [];
  for await (const event of streamChatTurn(d, turnFor(), controller.signal)) {
    events.push(event);
    if (event.type === "delta") controller.abort();
  }
  assert.ok(!events.some((event) => event.type === "error"));
  const saved = store.messages.find((message) => message.role === "assistant");
  assert.ok(saved);
  assert.ok(saved.content.startsWith("Første del af svaret"));
  assert.ok(!saved.content.includes("Tredje del"));
  assert.equal(afterCalls.length, 0);
  assert.equal(store.finalized.length, 1);
  assert.ok(store.finalized[0]!.usd > 0);
});

test("modellen fejler: fast fejlkode, og kaldet bogføres til trinnets maksimum", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: async () => {
      throw new Error("upstream 500 with raw provider text");
    },
  });
  const events = await collect(
    streamChatTurn(deps(store, model).deps, turnFor(), new AbortController().signal),
  );
  assert.deepEqual(events.at(-1), { type: "error", code: "failed" });
  assert.ok(!JSON.stringify(events).includes("upstream"));
  assert.equal(store.messages.filter((message) => message.role === "assistant").length, 0);
  // A failed call may have been billed: booked at the step's planned maximum, never released.
  assert.equal(store.released, 0);
  assert.equal(store.finalized.length, 1);
  assert.ok(store.finalized[0]!.usd > 0);
});

test("et værktøj fejler: modellen får en fast tekst, og uden andre opslag bliver det en fejl", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [
      toolResult("search_brain", { query: "Pleo" }),
      textResult(["Det ved Brain ikke endnu, for der er ingen kilder om Pleo."]),
    ],
  });
  const failing = (): ToolSet => ({
    search_brain: tool({
      description: "search",
      inputSchema: z.object({ query: z.string() }),
      execute: async (): Promise<{ results: unknown[] }> => {
        throw new Error("brain_search_chunks: permission denied for table brain_chunks");
      },
    }),
  });
  const logs: string[] = [];
  const events = await collect(
    streamChatTurn(
      deps(store, model, {
        createTools: failing,
        log: (message, detail) => logs.push(`${message} ${JSON.stringify(detail)}`),
      }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  assert.deepEqual(events.at(-1), { type: "error", code: "failed" });
  assert.ok(!events.some((event) => event.type === "done"));
  assert.equal(store.messages.filter((message) => message.role === "assistant").length, 0);
  // The model never saw the database's own words; the log has them, with the ids.
  assert.doesNotMatch(JSON.stringify(model.doStreamCalls[1]?.prompt), /permission denied/);
  assert.ok(logs.some((line) => /permission denied/.test(line) && line.includes(FUND)));
});

// Get_case as in tools.server.ts, a uuid or nothing.
function caseTools(calls: unknown[], fail = false): () => ToolSet {
  return () => ({
    get_case: tool({
      description: "case",
      inputSchema: z.object({ caseId: z.guid().optional() }),
      execute: async (input): Promise<{ name: string }> => {
        calls.push(input);
        if (fail) throw new Error("brain_case: permission denied");
        return { name: "Pleo" };
      },
    }),
  });
}
const toolPrompt = (model: MockLanguageModelV4, step: number) =>
  JSON.stringify(model.doStreamCalls[step]?.prompt.filter((message) => message.role === "tool"));

test("et ugyldigt værktøjs-input er ikke en teknisk fejl: modellen får en kort formatbesked, og svaret gives (T-701)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [
      toolResult("get_case", { caseId: "demo 05" }),
      textResult(["Jeg kunne ikke slå casen op; angiv casen igen."]),
    ],
  });
  const calls: unknown[] = [];
  const logs: string[] = [];
  const events = await collect(
    streamChatTurn(
      deps(store, model, {
        createTools: caseTools(calls),
        log: (message, detail) => logs.push(`${message} ${JSON.stringify(detail)}`),
      }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  assert.equal(events.at(-1)?.type, "done");
  assert.ok(!events.some((event) => event.type === "error"));
  assert.equal(calls.length, 0);
  const seen = toolPrompt(model, 1);
  assert.match(seen, /does not fit this tool: caseId must be a full uuid copied exactly/);
  // Not the validator's own words, and not the technical failure text.
  assert.doesNotMatch(seen, /Invalid (uuid|GUID)|invalid_(string|format)|technical reason/);
  assert.equal(store.messages.filter((message) => message.role === "assistant").length, 1);
  assert.ok(logs.some((line) => line.includes("input invalid") && line.includes("caseId")));
  assert.ok(!logs.some((line) => line.includes("all tools failed")));
});

test("et ugyldigt input og så et gyldigt: modellen prøver igen, og svaret gives (T-701)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [
      toolResult("get_case", { caseId: "00000000-0000" }),
      toolResult("get_case", { caseId: CASE }),
      textResult(["Pleo er casen."]),
    ],
  });
  const calls: unknown[] = [];
  const events = await collect(
    streamChatTurn(
      deps(store, model, { createTools: caseTools(calls) }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  assert.equal(events.at(-1)?.type, "done");
  assert.deepEqual(calls, [{ caseId: CASE }]);
  assert.match(toolPrompt(model, 2), /"name":"Pleo"/);
});

test("et ugyldigt input skjuler ikke en teknisk fejl: uden fund er det stadig en fejl (T-701)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [
      toolResult("get_case", { caseId: "demo 05" }),
      toolResult("get_case", { caseId: CASE }),
      textResult(["Det ved Brain ikke."]),
    ],
  });
  const events = await collect(
    streamChatTurn(
      deps(store, model, { createTools: caseTools([], true) }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  assert.deepEqual(events.at(-1), { type: "error", code: "failed" });
  assert.equal(store.messages.filter((message) => message.role === "assistant").length, 0);
});

test("formatbeskeden følger skemaet (valgmuligheder, grænser) og gentager ikke modellens værdi (T-701)", async () => {
  const model = new MockLanguageModelV4({
    doStream: [
      toolResult("find_cases", { stage: "Series A", limit: 50, query: "x" }),
      textResult(["Ingen cases fundet."]),
    ],
  });
  const findTools = (): ToolSet => ({
    find_cases: tool({
      description: "find",
      inputSchema: z.object({
        stage: z.enum(["seed", "series_a"]).optional(),
        limit: z.number().int().max(25).optional(),
        query: z.string().min(2).optional(),
      }),
      execute: async (): Promise<{ cases: unknown[] }> => ({ cases: [] }),
    }),
  });
  const events = await collect(
    streamChatTurn(
      deps(fakeStore(), model, { createTools: findTools }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  assert.equal(events.at(-1)?.type, "done");
  const seen = toolPrompt(model, 1);
  assert.match(seen, /stage must be one of: seed, series_a/);
  assert.match(seen, /limit must be at most 25/);
  assert.match(seen, /query must be at least 2 characters/);
  assert.doesNotMatch(seen, /uuid|Series A/);
});

test("formatbeskeden skelner et manglende felt fra en forkert type (T-701, zod 4 T-965)", async () => {
  const model = new MockLanguageModelV4({
    doStream: [toolResult("entity_facts", { predicate: 5 }), textResult(["Det ved Brain ikke."])],
  });
  const factTools = (): ToolSet => ({
    entity_facts: tool({
      description: "facts",
      inputSchema: z.object({
        entityId: z.guid(),
        direction: z.enum(["in", "out"]),
        predicate: z.string().max(60).optional(),
      }),
      execute: async (): Promise<{ facts: unknown[] }> => ({ facts: [] }),
    }),
  });
  const events = await collect(
    streamChatTurn(
      deps(fakeStore(), model, { createTools: factTools }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  assert.equal(events.at(-1)?.type, "done");
  const seen = toolPrompt(model, 1);
  assert.match(seen, /entityId is required/);
  assert.match(seen, /predicate must be a string/);
  assert.match(seen, /direction is required/);
});

test("et skema, der kaster under tjekket, er en teknisk fejl med den faste tekst (T-701)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [toolResult("get_case", { caseId: CASE }), textResult(["Det ved Brain ikke."])],
  });
  const throwing = (): ToolSet => ({
    get_case: tool({
      description: "case",
      inputSchema: z.object({ caseId: z.string() }).transform((): { caseId: string } => {
        throw new Error("schema exploded: secret detail");
      }),
      execute: async (): Promise<{ name: string }> => ({ name: "Pleo" }),
    }),
  });
  const events = await collect(
    streamChatTurn(
      deps(store, model, { createTools: throwing }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  assert.deepEqual(events.at(-1), { type: "error", code: "failed" });
  assert.doesNotMatch(toolPrompt(model, 1), /secret detail/);
  assert.match(toolPrompt(model, 1), /technical reason/);
});

test("et kald, AI SDK ikke kan læse (ukendt værktøj), er ikke en teknisk fejl (T-701)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [toolResult("get_cases", { caseId: CASE }), textResult(["Pleo har 100 kunder."])],
  });
  const events = await collect(
    streamChatTurn(deps(store, model).deps, turnFor(), new AbortController().signal),
  );
  assert.equal(events.at(-1)?.type, "done");
  assert.equal(store.messages.filter((message) => message.role === "assistant").length, 1);
});

test("modellen ser det samme skema som før, med uuid-formatet (T-701)", async () => {
  const model = new MockLanguageModelV4({ doStream: [textResult(["Hej."])] });
  await collect(
    streamChatTurn(
      deps(fakeStore(), model, { createTools: caseTools([]) }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  const sent = model.doStreamCalls[0]?.tools?.find((entry) => entry.name === "get_case");
  assert.ok(sent && sent.type === "function");
  assert.deepEqual(
    sent.inputSchema,
    await asSchema(z.object({ caseId: z.guid().optional() })).jsonSchema,
  );
});

test("datareglerne stopper modellen: egen fejlkode, intet reserveret, gemt eller sendt", async () => {
  const policy = AI_MODEL_POLICIES["openai/gpt-5.4-mini"];
  const before = { zdr: policy.zdr, env: process.env["AI_GATEWAY_ENFORCE_ZDR"] };
  policy.zdr = false;
  process.env["AI_GATEWAY_ENFORCE_ZDR"] = "true";
  try {
    let reserved = 0;
    const store = fakeStore();
    const reserve = store.reserve;
    store.reserve = async (input) => {
      reserved += 1;
      return reserve(input);
    };
    const model = new MockLanguageModelV4({ doStream: [textResult(["svar"])] });
    const events = await collect(
      streamChatTurn(deps(store, model).deps, turnFor(), new AbortController().signal),
    );
    assert.deepEqual(events, [{ type: "error", code: "blocked_by_policy" }]);
    assert.equal(reserved, 0);
    assert.equal(store.threads.length, 0);
    assert.equal(store.messages.length, 0);
    assert.equal(model.doStreamCalls.length, 0);
  } finally {
    policy.zdr = before.zdr;
    if (before.env === undefined) delete process.env["AI_GATEWAY_ENFORCE_ZDR"];
    else process.env["AI_GATEWAY_ENFORCE_ZDR"] = before.env;
  }
});

test("et værktøj stoppet af datareglerne giver blocked_by_policy, ikke en vag fejl", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [toolResult("search_brain", { query: "Pleo" }), textResult(["Ingen kilder."])],
  });
  const blocked = (): ToolSet => ({
    search_brain: tool({
      description: "search",
      inputSchema: z.object({ query: z.string() }),
      execute: async (): Promise<{ results: unknown[] }> => {
        throw new AiDataPolicyError("zdr_unavailable", "openai/text-embedding-3-small", "stop");
      },
    }),
  });
  const events = await collect(
    streamChatTurn(
      deps(store, model, { createTools: blocked }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  assert.deepEqual(events.at(-1), { type: "error", code: "blocked_by_policy" });
});

test("et efterkald stoppet af datareglerne bogføres ikke", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({ doStream: [textResult(["Pleo har 100 kunder."])] });
  const events = await collect(
    streamChatTurn(
      deps(store, model, {
        afterCall: async () => {
          throw new AiDataPolicyError("zdr_unavailable", "openai/gpt-5.4-mini", "stop");
        },
      }).deps,
      turnFor(),
      new AbortController().signal,
    ),
  );
  assert.equal(events.at(-1)?.type, "done");
  // One step at list price (1000 in, 200 out on gpt-5.4-mini); nothing for the stopped after-call.
  assert.equal(store.finalized.length, 1);
  assert.ok(Math.abs(store.finalized[0]!.usd - 0.00165) < 1e-6);
  assert.equal(store.finalized[0]!.requests, 1);
});

test("et svar, der blev skåret af, gemmes med en note og lav sikkerhed, uden efterkald", async () => {
  const store = fakeStore();
  const cut = {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "t" },
        {
          type: "text-delta" as const,
          id: "t",
          delta: "Pleo har en stærk vækst, og teamet mente at",
        },
        { type: "text-end" as const, id: "t" },
        {
          type: "finish" as const,
          finishReason: { unified: "length" as const, raw: "length" },
          usage,
        },
      ],
      initialDelayInMs: null,
      chunkDelayInMs: null,
    }),
  };
  const model = new MockLanguageModelV4({ doStream: [cut] });
  const { deps: d, afterCalls } = deps(store, model);
  const events = await collect(streamChatTurn(d, turnFor(), new AbortController().signal));
  const shown = events.map((event) => (event.type === "delta" ? event.text : "")).join("");
  assert.ok(shown.endsWith(INCOMPLETE_NOTE));
  const done = events.at(-1);
  assert.ok(done?.type === "done");
  assert.equal(done.confidence, "low");
  assert.equal(afterCalls.length, 0);
  assert.equal(store.messages.at(-1)?.content, shown);
});

const emptyLength = (calls: boolean) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "stream-start" as const, warnings: [] },
      ...(calls
        ? [
            {
              type: "tool-call" as const,
              toolCallId: "call-2",
              toolName: "search_brain",
              input: JSON.stringify({ query: "Pleo" }),
            },
          ]
        : []),
      {
        type: "finish" as const,
        finishReason: {
          unified: (calls ? "tool-calls" : "length") as "tool-calls" | "length",
          raw: "x",
        },
        usage,
      },
    ],
    initialDelayInMs: null,
    chunkDelayInMs: null,
  }),
});

test("et trin uden tekst, der rammer outputloftet, får ét afsluttende trin uden værktøjer (T-510)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [emptyLength(true), emptyLength(false), textResult(["Pleo har 100 kunder [1]."])],
  });
  const { deps: d } = deps(store, model);
  const events = await collect(streamChatTurn(d, turnFor(), new AbortController().signal));
  assert.equal(events.at(-1)?.type, "done");
  assert.equal(store.messages.at(-1)?.content, "Pleo har 100 kunder [1].");
  // Three steps and the after-call are all booked.
  assert.equal(store.finalized[0]?.requests, 4);
  // The closing step runs without tools.
  assert.equal(model.doStreamCalls.at(-1)?.tools?.length ?? 0, 0);
  assert.ok((model.doStreamCalls.at(0)?.tools?.length ?? 0) > 0);
});

test("forberedelse: kun ejeren skriver i en tråd, casen skal være fondens, og der er et minutloft", async () => {
  const mine = { id: "thread-1", userId: USER, caseId: null };
  const theirs = { id: "thread-2", userId: "someone-else", caseId: null };
  const store = fakeStore({ threads: [mine, theirs] });
  const base = { fundId: FUND, fundName: "Testfond", userId: USER };

  const ok = await prepareChatTurn(store, { ...base, request: request({ threadId: "thread-1" }) });
  assert.ok(ok.ok);
  assert.deepEqual(
    await prepareChatTurn(store, { ...base, request: request({ threadId: "thread-2" }) }),
    { ok: false, status: 403, code: "forbidden" },
  );
  assert.deepEqual(
    await prepareChatTurn(store, { ...base, request: request({ threadId: "thread-x" }) }),
    { ok: false, status: 403, code: "forbidden" },
  );
  assert.deepEqual(
    await prepareChatTurn(store, { ...base, request: request({ caseId: "other-fund-case" }) }),
    { ok: false, status: 403, code: "forbidden" },
  );
  const withCase = await prepareChatTurn(store, { ...base, request: request({ caseId: CASE }) });
  assert.ok(withCase.ok && withCase.turn.focusCase?.name === "Pleo");

  const busy = { ...store, recentQuestions: async () => 6 };
  assert.deepEqual(await prepareChatTurn(busy, { ...base, request: request() }), {
    ok: false,
    status: 429,
    code: "rate_limited",
  });
});

test("trinplan: sidste trin svarer uden værktøjer, tæt på loftet kortere, ellers stop", () => {
  const base = {
    spentUsd: 0,
    capUsd: 0.15,
    inputUsd: 0.01,
    outputUsdPerToken: 4.5 / 1_000_000,
    maxOutputTokens: 2000,
  };
  assert.deepEqual(planStep({ ...base, stepNumber: 0 }), { kind: "normal" });
  assert.deepEqual(planStep({ ...base, stepNumber: 5 }), { kind: "final", maxOutputTokens: 2000 });
  const near = planStep({ ...base, stepNumber: 2, spentUsd: 0.13 });
  assert.equal(near.kind, "final");
  assert.ok(near.kind === "final" && near.maxOutputTokens < 2000 && near.maxOutputTokens >= 300);
  assert.deepEqual(planStep({ ...base, stepNumber: 2, spentUsd: 0.14 }), { kind: "stop" });
});

test("et lækket værktøjskald når hverken brugeren eller databasen", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [
      textResult([
        " to=functions.search_brain  天天中彩票 json",
        '{"query":"Pleo"}Pleo er en dansk fintech-case, som ',
        "teamet har screenet [1].",
      ]),
    ],
  });
  const events = await collect(
    streamChatTurn(deps(store, model).deps, turnFor(), new AbortController().signal),
  );
  const shown = events.map((event) => (event.type === "delta" ? event.text : "")).join("");
  assert.equal(shown, "Pleo er en dansk fintech-case, som teamet har screenet [1].");
  const saved = store.messages.find((message) => message.role === "assistant");
  assert.equal(saved?.content, shown);
});

test("/hvorfor: instruktionen ligger i systemprompten, og modellen læser teksten efter kommandoen (T-119)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({ doStream: [textResult(["Det ved Brain ikke endnu."])] });
  const base = turnFor({ focusCase: { id: CASE, name: "Pleo" } });
  await collect(
    streamChatTurn(
      deps(store, model).deps,
      { ...base, request: { ...base.request, question: "/hvorfor fravalgt" } },
      new AbortController().signal,
    ),
  );
  const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
  assert.match(prompt, /Command \/hvorfor: explain why the case ended/);
  assert.match(prompt, /fravalgt/);
  assert.equal(store.messages[0]?.content, "/hvorfor fravalgt");
});

test("/sammenlign uden to emner: motoren svarer selv på teamets sprog, intet modelkald (T-119, T-747 b)", async () => {
  for (const language of ["da", "en"] as const) {
    const store = fakeStore();
    const model = new MockLanguageModelV4({ doStream: [textResult(["må ikke bruges"])] });
    const base = turnFor({});
    const events = await collect(
      streamChatTurn(
        deps(store, model).deps,
        { ...base, language, request: { ...base.request, question: "/sammenlign" } },
        new AbortController().signal,
      ),
    );
    assert.equal(model.doStreamCalls.length, 0);
    const saved = store.messages.find((message) => message.role === "assistant");
    assert.match(
      saved?.content ?? "",
      language === "da" ? /mangler 2 cases eller selskaber/ : /needs 2 more cases or companies/,
    );
    assert.ok(events.some((event) => event.type === "done"));
  }
});

test("/djævlens-advokat: motoren skriver åbningen, ikke modellen (T-120)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({ doStream: [textResult(["Kunden står for 55 %. [1]"])] });
  const base = turnFor({ focusCase: { id: CASE, name: "Pleo" } });
  const events = await collect(
    streamChatTurn(
      deps(store, model).deps,
      { ...base, request: { ...base.request, question: "/djævlens-advokat" } },
      new AbortController().signal,
    ),
  );
  const deltas = events.filter((event) => event.type === "delta").map((event) => event.text);
  assert.equal(deltas[0], "Dette er et bevidst ensidigt argument og ikke Brains vurdering.\n\n");
  const saved = store.messages.find((message) => message.role === "assistant");
  assert.match(saved?.content ?? "", /^Dette er et bevidst ensidigt argument/);
  // Without a case the command cannot run: no opening, only the usage hint.
  const bare = turnFor({});
  const other = await collect(
    streamChatTurn(
      deps(fakeStore(), new MockLanguageModelV4({ doStream: [textResult(["Brug det."])] })).deps,
      { ...bare, request: { ...bare.request, question: "/djævlens-advokat" } },
      new AbortController().signal,
    ),
  );
  assert.ok(!other.some((event) => event.type === "delta" && /ensidigt/.test(event.text)));
});

test("websøgning: godkendte søgninger køres før modellen, resultaterne ligger i web_search, loftet er 1 kr højere (T-217)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({ doStream: [textResult(["Det ved Brain ikke endnu."])] });
  const searched: string[][] = [];
  const reservedUsd: number[] = [];
  const reserve = store.reserve;
  store.reserve = async (input) => {
    reservedUsd.push(input.usd);
    return reserve(input);
  };
  const base = turnFor({});
  const d = deps(store, model, {
    webSearch: async (queries) => {
      searched.push([...queries]);
      return {
        results: [
          {
            query: queries[0]!,
            text: "Acme rejste 5 mio.",
            sources: [{ url: "https://x.test/a", title: "A" }],
          },
        ],
        costUsd: 0.01,
        failed: 0,
      };
    },
  });
  const events = await collect(
    streamChatTurn(
      d.deps,
      {
        ...base,
        request: {
          ...base.request,
          // Only the first two pass the filter: a quote and an e-mail never leave.
          webQueries: ["Acme funding", 'Acme "secret"', "kontakt anna@acme.dk", "Acme team"],
        },
      },
      new AbortController().signal,
    ),
  );
  assert.deepEqual(searched, [["Acme funding", "Acme team"]]);
  // One step per search, in order, before anything else.
  const steps = events.filter((event) => event.type === "step");
  assert.deepEqual(
    steps.slice(0, 2).map((event) => event.type === "step" && [event.index, event.text]),
    [
      [0, "Søger på nettet: Acme funding"],
      [1, "Søger på nettet: Acme team"],
    ],
  );
  assert.ok(steps.slice(2).every((event) => event.type === "step" && event.index >= 2));
  // The web step comes before the model writes anything.
  assert.ok(
    events.findIndex((e) => e.type === "step") < events.findIndex((e) => e.type === "delta"),
  );
  assert.equal(reservedUsd.at(-1), capUsd("fast", true));
  const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
  assert.match(prompt, /approved web searches/);
  assert.match(prompt, /never present it as a verified fact/);
  assert.ok(events.some((event) => event.type === "done"));
});

test("uden webSearch i motoren eller uden godkendte søgninger sker der intet på nettet (T-217)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({ doStream: [textResult(["svar"])] });
  let called = 0;
  const base = turnFor({});
  await collect(
    streamChatTurn(
      deps(store, model, {
        webSearch: async () => {
          called += 1;
          return { results: [], costUsd: 0, failed: 0 };
        },
      }).deps,
      base,
      new AbortController().signal,
    ),
  );
  assert.equal(called, 0);
  assert.doesNotMatch(JSON.stringify(model.doStreamCalls[0]?.prompt), /approved web searches/);
});

test("T-618: the cut-off and stop notes follow the fund's language; Danish is unchanged", () => {
  assert.equal(incompleteNote("da"), INCOMPLETE_NOTE);
  assert.equal(incompleteNote(undefined), INCOMPLETE_NOTE);
  assert.equal(stoppedNote("da"), STOPPED_NOTE);
  assert.match(incompleteNote("en"), /^\(The answer was cut off/);
  assert.equal(stoppedNote("en"), "(Stopped before the answer was finished.)");
});

test("stop under the web search ends the turn without asking the model (T-706)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({ doStream: [textResult(["svar"])] });
  const client = new AbortController();
  const base = turnFor({});
  let seen: AbortSignal | null = null;
  const events = await collect(
    streamChatTurn(
      deps(store, model, {
        webSearch: async (_queries, signal) => {
          seen = signal;
          client.abort();
          return { results: [], costUsd: 0.01, failed: 1 };
        },
      }).deps,
      { ...base, request: { ...base.request, webQueries: ["Acme funding"] } },
      client.signal,
    ),
  );
  assert.equal((seen as AbortSignal | null)?.aborted, true, "the search got the stop");
  assert.equal(model.doStreamCalls.length, 0);
  assert.ok(!events.some((event) => event.type === "delta"));
  // Saved as stopped, so a reload shows the stop.
  const saved = store.messages.find((message) => message.role === "assistant");
  assert.equal(saved?.content, STOPPED_NOTE);
});

test("Stop before the first word saves the answer as stopped, so a reload shows it (T-794)", async () => {
  const store = fakeStore();
  const model = new MockLanguageModelV4({
    doStream: [textResult(["Svaret kommer for sent."], 30)],
  });
  const { deps: d, afterCalls } = deps(store, model);
  const controller = new AbortController();
  const events: ChatStreamEvent[] = [];
  for await (const event of streamChatTurn(d, turnFor(), controller.signal)) {
    events.push(event);
    // Only the first progress was shown: the user stops before any text arrives.
    controller.abort();
  }
  assert.ok(!events.some((event) => event.type === "error"));
  assert.ok(!events.some((event) => event.type === "delta"));
  const saved = store.messages.find((message) => message.role === "assistant");
  assert.equal(saved?.content, STOPPED_NOTE);
  assert.equal(afterCalls.length, 0);
});

test("fejler alle godkendte websøgninger, siger svaret det (T-750 a)", async () => {
  for (const [language, expected] of [
    ["da", /^Nettet kunne ikke søges lige nu/],
    ["en", /^The web could not be searched just now/],
  ] as const) {
    const store = fakeStore();
    const model = new MockLanguageModelV4({ doStream: [textResult(["Svar fra egne data."])] });
    const base = turnFor({});
    const d = deps(store, model, {
      webSearch: async () => ({ results: [], costUsd: 0, failed: 1 }),
    });
    await collect(
      streamChatTurn(
        d.deps,
        { ...base, language, request: { ...base.request, webQueries: ["Acme funding"] } },
        new AbortController().signal,
      ),
    );
    const saved = store.messages.find((message) => message.role === "assistant");
    assert.match(saved?.content ?? "", expected);
  }
});

test("T-962: the after-call gets the answer's language (the question's, the team's when unclear)", async () => {
  for (const [teamLanguage, question, expected] of [
    ["en", "Why did we pass on Marlow Bio?", "en"],
    ["da", "Why did we pass on Marlow Bio?", "en"],
    ["en", "Hvorfor sagde vi nej til Marlow Bio?", "da"],
  ] as const) {
    const store = fakeStore();
    const model = new MockLanguageModelV4({
      doStream: [
        toolResult("search_brain", { query: "Marlow Bio" }),
        textResult(["Marlow Bio [1]."]),
      ],
    });
    const languages: string[] = [];
    const { deps: d } = deps(store, model, {
      afterCall: async ({ language }) => {
        languages.push(language);
        return { confidence: "high", missing: [], costUsd: 0.001 };
      },
    });
    await collect(
      streamChatTurn(
        d,
        turnFor({ language: teamLanguage, request: request({ question }) }),
        new AbortController().signal,
      ),
    );
    assert.deepEqual(languages, [expected], `${teamLanguage}: ${question}`);
  }
});
