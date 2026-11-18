/** Web search in the chat through the fund's masking. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV4 } from "ai/test";
import { createRedactor } from "../../ai/redact.ts";
import { buildRedactionDictionary } from "../../ai/redact-dictionary.ts";
import { runWebSearch, WEB_SEARCH_MODEL } from "./search.server.ts";

// A fund's dictionary as loadRedactionDictionary builds it: the company, an investor, a founder
// (kept) and a bookkeeper (a private person, masked).
const DICTIONARY = buildRedactionDictionary({
  people: [
    { name: "Mette Kjær", roles: ["Founder & CEO"], keyPerson: true },
    { name: "Torben Vestergaard", roles: ["Bogholder"], keyPerson: false },
  ],
  organisations: ["Nordlys Robotics ApS", "Nordlys Robotics", "Seed Capital Denmark"],
});

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function searchModel() {
  return new MockLanguageModelV4({
    // The Gateway's id, so the data rules treat it as the search engine it is.
    modelId: WEB_SEARCH_MODEL,
    doGenerate: async () => ({
      content: [
        { type: "text" as const, text: "Nordlys Robotics rejste 12 mio. kr. i 2025." },
        {
          type: "source" as const,
          sourceType: "url" as const,
          id: "s1",
          url: "https://example.test/nordlys",
          title: "Nordlys",
        },
      ],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage,
      warnings: [],
    }),
  });
}

/** What the search engine was sent, one user prompt per query. */
function sentQueries(model: MockLanguageModelV4): string[] {
  return model.doGenerateCalls.map((call) => {
    const user = call.prompt.find((message) => message.role === "user");
    const part = user?.role === "user" ? user.content[0] : undefined;
    return part?.type === "text" ? part.text : "";
  });
}

const book = (async (_service, _input, run) => {
  const outcome = await run();
  return { value: outcome.value, costUsd: outcome.costUsd ?? 0 };
}) satisfies Parameters<typeof runWebSearch>[1]["book"];

test("the company, the investor and a founder from the dictionary reach the search unmasked (T-706)", async () => {
  const model = searchModel();
  const queries = [
    "Nordlys Robotics funding 2025",
    "Mette Kjær Nordlys Robotics ApS",
    "Seed Capital Denmark portefølje",
  ];
  const result = await runWebSearch({} as SupabaseClient, {
    fundId: "00000000-0000-4000-8000-000000000001",
    queries,
    model,
    redactor: createRedactor(DICTIONARY),
    book,
  });
  assert.deepEqual(sentQueries(model).sort(), [...queries].sort());
  for (const sent of sentQueries(model)) assert.doesNotMatch(sent, /\[(Person|E-mail|Telefon)/);
  assert.equal(result.results.length, 3);
  assert.equal(result.failed, 0);
});

test("a private person from the dictionary is still masked before the search engine sees it (T-706)", async () => {
  const model = searchModel();
  await runWebSearch({} as SupabaseClient, {
    fundId: "00000000-0000-4000-8000-000000000001",
    queries: ["Torben Vestergaard Nordlys Robotics"],
    model,
    redactor: createRedactor(DICTIONARY),
    book,
  });
  const [sent] = sentQueries(model);
  assert.doesNotMatch(sent ?? "", /Torben|Vestergaard/);
  assert.match(sent ?? "", /\[Person 1\] Nordlys Robotics/);
});

test("an abort stops a search that is already running, not only the next one (T-706)", async () => {
  const controller = new AbortController();
  let started = 0;
  const model = new MockLanguageModelV4({
    // The Gateway's id, so the data rules treat it as the search engine it is.
    modelId: WEB_SEARCH_MODEL,
    doGenerate: async ({ abortSignal }) => {
      started += 1;
      if (started === 2) controller.abort();
      await new Promise((resolve, reject) => {
        if (abortSignal?.aborted) return reject(abortSignal.reason);
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
        setTimeout(resolve, 5_000);
      });
      throw new Error("not aborted");
    },
  });
  const began = Date.now();
  const result = await runWebSearch({} as SupabaseClient, {
    fundId: "00000000-0000-4000-8000-000000000001",
    queries: ["Nordlys Robotics funding", "Nordlys Robotics team"],
    signal: controller.signal,
    model,
    redactor: createRedactor(DICTIONARY),
    book,
  });
  assert.equal(started, 2, "both searches had started");
  assert.equal(result.failed, 2);
  assert.ok(Date.now() - began < 2_000, "the running searches stopped at once");
});
