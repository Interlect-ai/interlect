import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { isStepCount, jsonSchema, Output, tool } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { z } from "zod";
import {
  createStreamRestorer,
  embedMany,
  generateText,
  isPermanentPolicyStop,
  MaskingUnavailableError,
  maskedModel,
  postChatCompletion,
  restoreJsonText,
  streamText,
  UnmaskedCallError,
} from "./model-call.ts";
import { attachCallLog, MAX_PAYLOAD_CHARS, payloadForLog, writeCallLog } from "./call-log.ts";
import { AiDataPolicyError } from "./gateway-options.ts";
import { createRedactor, REDACTION_INSTRUCTION, type Redactor } from "./redact.ts";
import { TEST_DICTIONARY } from "./redact-testset.ts";

/**
 * Every model call goes through the masking. The payload tests catch what
 * would leave for the model (the prompt the provider gets, the values an embedding model gets,
 * the body posted to the Gateway) and fail if a test name, test e-mail or test CPR number is in
 * it; the scan fails on any direct model call outside model-call.ts.
 */

const NAME = "Line Hansen";
const EMAIL = "line.hansen@privat.dk";
const CPR = "010190-1234";
const SECRETS = [NAME, EMAIL, CPR];
const FOUNDER = "Anna Jensen";
const RULES = { gateway: { disallowPromptTraining: true as const } };

// The data rules depend on the ZDR flag; each test sets it itself.
const savedZdr = process.env["AI_GATEWAY_ENFORCE_ZDR"];
beforeEach(() => {
  delete process.env["AI_GATEWAY_ENFORCE_ZDR"];
});
afterEach(() => {
  if (savedZdr === undefined) delete process.env["AI_GATEWAY_ENFORCE_ZDR"];
  else process.env["AI_GATEWAY_ENFORCE_ZDR"] = savedZdr;
});

function assertNoSecrets(payload: unknown, where: string) {
  const text = JSON.stringify(payload);
  for (const secret of SECRETS) {
    assert.ok(!text.includes(secret), `${secret} left the system in ${where}: ${text}`);
  }
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const stop = { unified: "stop" as const, raw: "stop" };
const textAnswer = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: stop,
  usage,
  warnings: [],
});

const MATERIAL = `Ejerbog:\n${NAME} (privat), CPR ${CPR}, mail ${EMAIL}\nFounder: ${FOUNDER}`;

test("generateText: the provider gets no name, e-mail or CPR, and the answer is restored", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: textAnswer("[Person 1] ejer 10 %, skriv til [E-mail 1]."),
  });
  const result = await generateText({
    model: maskedModel(model, createRedactor(TEST_DICTIONARY)),
    system: "Du er analytiker.",
    prompt: MATERIAL,
    providerOptions: RULES,
  });
  const prompt = model.doGenerateCalls[0]?.prompt;
  assertNoSecrets(prompt, "the prompt");
  assert.match(JSON.stringify(prompt), new RegExp(FOUNDER), "a founder is kept");
  const system = prompt?.[0];
  assert.equal(system?.role, "system");
  assert.ok(String(system?.content).endsWith(REDACTION_INSTRUCTION), "the model is told");
  assert.equal(result.text, `${NAME} ejer 10 %, skriv til ${EMAIL}.`);
});

test("JSON text (a packet built with JSON.stringify) is masked value by value", async () => {
  const model = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
  await generateText({
    model: maskedModel(model, createRedactor(TEST_DICTIONARY)),
    prompt: JSON.stringify({ material: `Ejer:\n${NAME}\n${EMAIL}`, cpr: CPR }),
    providerOptions: RULES,
  });
  const user = model.doGenerateCalls[0]?.prompt.find((m) => m.role === "user");
  assertNoSecrets(user, "a JSON packet");
  const text =
    user?.role === "user" && user.content[0]?.type === "text" ? user.content[0].text : "";
  assert.doesNotThrow(() => JSON.parse(text), "still valid JSON");
});

test("a JSON text without personal data is sent exactly as it was", async () => {
  const model = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
  const prompt = JSON.stringify({ selskab: "Pleo", tal: [1, 2] }, null, 2);
  await generateText({
    model: maskedModel(model, createRedactor(TEST_DICTIONARY)),
    prompt,
    providerOptions: RULES,
  });
  const user = model.doGenerateCalls[0]?.prompt.find((m) => m.role === "user");
  assert.deepEqual(user?.content, [{ type: "text", text: prompt }]);
  assert.equal(model.doGenerateCalls[0]?.prompt[0]?.role, "user", "no instruction needed");
});

test("structured output is restored inside the JSON, escaped for its string", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: textAnswer(JSON.stringify({ owner: "[Person 1]", contact: "[E-mail 1]" })),
  });
  const result = await generateText({
    model: maskedModel(model, createRedactor(TEST_DICTIONARY)),
    prompt: MATERIAL,
    providerOptions: RULES,
    output: Output.object({
      schema: jsonSchema<{ owner: string; contact: string }>({
        type: "object",
        properties: { owner: { type: "string" }, contact: { type: "string" } },
        required: ["owner", "contact"],
      }),
    }),
  });
  assert.deepEqual(result.output, { owner: NAME, contact: EMAIL });

  const quoting = { restore: (text: string) => (text === "[Person 1]" ? 'Line "Lis"' : text) };
  const restored = restoreJsonText(quoting as Redactor, JSON.stringify({ a: "[Person 1]" }));
  assert.deepEqual(JSON.parse(restored), { a: 'Line "Lis"' });
});

test("streamText: a placeholder split between chunks is restored and never shown half", async () => {
  const deltas = ["Ejeren er [Per", "son 1", "] og ", "mailen [E-mail 1]", "."];
  const model = new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
          { type: "text-end" as const, id: "t" },
          { type: "finish" as const, finishReason: stop, usage },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    },
  });
  const result = streamText({
    model: maskedModel(model, createRedactor(TEST_DICTIONARY)),
    prompt: MATERIAL,
    providerOptions: RULES,
  });
  const shown: string[] = [];
  for await (const delta of result.textStream) shown.push(delta);
  assertNoSecrets(model.doStreamCalls[0]?.prompt, "a streamed call");
  assert.equal(shown.join(""), `Ejeren er ${NAME} og mailen ${EMAIL}.`);
  assert.ok(
    shown.every((delta) => !/\[(Per|E-m)/.test(delta)),
    shown.join("|"),
  );
});

test("the stream restorer gives back a lone bracket that is not a placeholder", () => {
  const restorer = createStreamRestorer((text) => text);
  assert.equal(restorer.push("Se kilde [3"), "Se kilde ");
  assert.equal(restorer.push("] her"), "[3] her");
  assert.equal(restorer.push(" [åben"), " ");
  assert.equal(restorer.flush(), "[åben");
});

test("tools: the tool gets the real name, and its result is masked before the next step", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "c1",
            toolName: "lookup",
            input: JSON.stringify({ name: "[Person 1]" }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
        usage,
        warnings: [],
      },
      textAnswer("[Person 1] kan nås på [E-mail 1]."),
    ],
  });
  const asked: string[] = [];
  const result = await generateText({
    model: maskedModel(model, createRedactor(TEST_DICTIONARY)),
    prompt: `Hvem er ${NAME}?`,
    providerOptions: RULES,
    stopWhen: isStepCount(2),
    tools: {
      lookup: tool({
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name }) => {
          asked.push(name);
          return { email: EMAIL, note: `CPR ${CPR}` };
        },
      }),
    },
  });
  assert.deepEqual(asked, [NAME]);
  for (const call of model.doGenerateCalls) assertNoSecrets(call.prompt, "a step");
  assert.match(JSON.stringify(model.doGenerateCalls[1]?.prompt), /\[E-mail 1\]/);
  assert.equal(result.text, `${NAME} kan nås på ${EMAIL}.`);
});

test("a name next to a CPR number in a later message is also masked in the earlier ones", async () => {
  const model = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
  await generateText({
    model: maskedModel(model, createRedactor()),
    messages: [
      { role: "user", content: "Hvad ved vi om Peter Holm?" },
      { role: "assistant", content: "Lad mig se." },
      { role: "user", content: `Køber Peter Holm, CPR ${CPR}` },
    ],
    providerOptions: RULES,
  });
  const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
  assert.ok(!prompt.includes("Peter Holm"), prompt);
  assert.ok(!prompt.includes(CPR), prompt);
});

test("files cannot be masked: refused unless the call names its exception", async () => {
  const model = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "Læs siden" },
        { type: "file" as const, data: new Uint8Array([1, 2, 3]), mediaType: "image/png" },
      ],
    },
  ];
  await assert.rejects(
    generateText({
      model: maskedModel(model, createRedactor()),
      messages,
      providerOptions: RULES,
    }),
    UnmaskedCallError,
  );
  assert.equal(model.doGenerateCalls.length, 0, "nothing was sent");
  await generateText({
    model: maskedModel(model, createRedactor(), { unmaskedFiles: "deck_pages_for_ocr" }),
    messages,
    providerOptions: RULES,
  });
  assert.equal(model.doGenerateCalls.length, 1);
});

test("a direct model call is stopped: an unmasked model, or no data rules", async () => {
  const model = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
  await assert.rejects(
    generateText({ model, prompt: NAME, providerOptions: RULES }),
    UnmaskedCallError,
  );
  assert.throws(
    () => streamText({ model: "openai/gpt-5.4", prompt: NAME, providerOptions: RULES }),
    UnmaskedCallError,
  );
  await assert.rejects(
    generateText({ model: maskedModel(model, createRedactor()), prompt: NAME }),
    UnmaskedCallError,
  );
  assert.equal(model.doGenerateCalls.length, 0);
});

test("a step may not switch to an unmasked model or drop the data rules (prepareStep)", async () => {
  const masked = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
  const plain = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
  await assert.rejects(
    generateText({
      model: maskedModel(masked, createRedactor(TEST_DICTIONARY)),
      prompt: MATERIAL,
      providerOptions: RULES,
      prepareStep: () => ({ model: plain }),
    }),
    UnmaskedCallError,
  );
  await assert.rejects(
    generateText({
      model: maskedModel(masked, createRedactor(TEST_DICTIONARY)),
      prompt: MATERIAL,
      providerOptions: RULES,
      prepareStep: () => ({ providerOptions: {} }),
    }),
    UnmaskedCallError,
  );
  assert.equal(plain.doGenerateCalls.length + masked.doGenerateCalls.length, 0);
});

test("with ZDR enforced, a call without zeroDataRetention is stopped (a search model is not)", () => {
  process.env["AI_GATEWAY_ENFORCE_ZDR"] = "true";
  const model = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
  assert.throws(
    () =>
      streamText({
        model: maskedModel(model, createRedactor()),
        prompt: "x",
        providerOptions: RULES,
      }),
    UnmaskedCallError,
  );
  const search = new MockLanguageModelV4({
    modelId: "perplexity/sonar",
    doGenerate: textAnswer("ok"),
  });
  assert.doesNotThrow(() =>
    streamText({
      model: maskedModel(search, createRedactor()),
      prompt: "x",
      providerOptions: RULES,
    }),
  );
});

test("JSON after a lead-in ('Materiale:\\n{...}') is still masked value by value", async () => {
  const model = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
  await generateText({
    model: maskedModel(model, createRedactor(TEST_DICTIONARY)),
    prompt: `Sagsmateriale:\n${JSON.stringify({ material: `Ejer:\n${NAME}\n${EMAIL}` })}\nSlut.`,
    providerOptions: RULES,
  });
  const user = model.doGenerateCalls[0]?.prompt.find((m) => m.role === "user");
  assertNoSecrets(user, "a lead-in and JSON");
  const text =
    user?.role === "user" && user.content[0]?.type === "text" ? user.content[0].text : "";
  assert.ok(text.startsWith("Sagsmateriale:\n") && text.endsWith("\nSlut."), text);
  assert.doesNotThrow(() => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
});

test("embedMany: the embedding model gets the masked values, masked as one payload", async () => {
  const model = new MockEmbeddingModelV4({
    // Both values in one call (the mock's default is one per call, and ai 7.0.140 checks the count).
    maxEmbeddingsPerCall: 2,
    doEmbed: { embeddings: [[1], [2]], warnings: [] },
  });
  await embedMany({
    model,
    values: [`Noten nævner Peter Holm.`, `Peter Holm, CPR ${CPR}, ${EMAIL}`],
    redactor: createRedactor(),
    providerOptions: RULES,
  });
  const values = model.doEmbedCalls[0]?.values ?? [];
  assertNoSecrets(values, "the embedding values");
  assert.ok(!JSON.stringify(values).includes("Peter Holm"), JSON.stringify(values));
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("postChatCompletion: the posted body has no secrets, the JSON answer is restored", async () => {
  const posted: unknown[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://ai-gateway.vercel.sh/v1/chat/completions");
    posted.push(JSON.parse(String(init?.body)));
    const content = JSON.stringify({ owner: "[Person 1]", cpr: "[CPR 1]" });
    return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
  };
  const response = await postChatCompletion({
    body: {
      model: "openai/gpt-5.4",
      providerOptions: RULES,
      messages: [
        { role: "system", content: "Analysér." },
        { role: "user", content: JSON.stringify({ material: MATERIAL }) },
      ],
      response_format: { type: "json_schema" },
    },
    redactor: createRedactor(TEST_DICTIONARY),
    token: "test",
  });
  assertNoSecrets(posted, "the posted body");
  const body = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  assert.deepEqual(JSON.parse(body.choices[0]?.message.content ?? ""), { owner: NAME, cpr: CPR });
  const system = (posted[0] as { messages: Array<{ content: string }> }).messages[0];
  assert.ok(system?.content.endsWith(REDACTION_INSTRUCTION));
});

test("postChatCompletion refuses a call without the data rules and parts it cannot read", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };
  const body = { model: "openai/gpt-5.4", messages: [{ role: "user", content: "hej" }] };
  await assert.rejects(
    postChatCompletion({
      body: { ...body, providerOptions: {} },
      redactor: createRedactor(),
      token: "t",
    }),
    UnmaskedCallError,
  );
  await assert.rejects(
    postChatCompletion({
      body: {
        ...body,
        providerOptions: RULES,
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }],
      },
      redactor: createRedactor(),
      token: "t",
    }),
    UnmaskedCallError,
  );
  assert.equal(calls, 0);
});

test("postChatCompletion refuses fields it cannot mask and a streamed answer", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };
  const base = {
    model: "openai/gpt-5.4",
    providerOptions: RULES,
    messages: [{ role: "user", content: "hej" }],
  };
  for (const body of [
    { ...base, user: NAME },
    { ...base, stream: true },
    { ...base, messages: [{ role: "assistant", content: "", tool_calls: [{ id: NAME }] }] },
  ]) {
    await assert.rejects(
      postChatCompletion({ body, redactor: createRedactor(), token: "t" }),
      UnmaskedCallError,
    );
  }
  assert.equal(calls, 0);
});

test("a dictionary that could not be loaded is retried, a real data rules stop is not", () => {
  assert.equal(isPermanentPolicyStop(new MaskingUnavailableError()), false);
  assert.ok(new MaskingUnavailableError() instanceof AiDataPolicyError, "nothing was sent");
  assert.equal(isPermanentPolicyStop(new UnmaskedCallError("m", "x")), true);
  assert.equal(isPermanentPolicyStop(new Error("x")), false);
});

// ---------------------------------------------------------------------------------------------
// The AI log
// ---------------------------------------------------------------------------------------------

const FUND = "a2100000-0000-4000-8000-00000000000f";

function logged(options: { fail?: boolean } = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const service = {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (options.fail) throw new Error("database down");
        rows.push({ table, ...row });
        return { error: null };
      },
    }),
  };
  const redactor = attachCallLog(createRedactor(TEST_DICTIONARY), {
    fundId: FUND,
    flow: "screening",
    service: service as unknown as Parameters<typeof attachCallLog>[1]["service"],
  });
  return { rows, redactor };
}

const ZDR_RULES = {
  gateway: { disallowPromptTraining: true as const, zeroDataRetention: true as const },
};
const GATEWAY_META = {
  gateway: {
    cost: "0.0012",
    enabledZeroDataRetention: true,
    generationId: "gen-1",
    routing: { finalProvider: "azure" },
  },
};

test("the AI log: one row per call with the masked payload, the provider, ZDR, tokens and price", async () => {
  const { rows, redactor } = logged();
  const model = new MockLanguageModelV4({
    doGenerate: { ...textAnswer("[Person 1] ejer."), providerMetadata: GATEWAY_META },
  });
  await generateText({
    model: maskedModel(model, redactor),
    prompt: MATERIAL,
    providerOptions: ZDR_RULES,
  });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assertNoSecrets(row["payload"], "the AI log");
  assert.match(JSON.stringify(row["payload"]), /\[Person 1\]/);
  assert.deepEqual(
    { ...row, payload: undefined },
    {
      table: "ai_call_log",
      fund_id: FUND,
      flow: "screening",
      model: "mock-model-id",
      provider: "azure",
      region: null,
      zdr: true,
      status: "ok",
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0.0012,
      masked: { person: 1, email: 1, cpr: 1 },
      payload: undefined,
      generation_id: "gen-1",
    },
  );
});

test("the AI log: a streamed step is logged when it finishes, a failed call as failed", async () => {
  const { rows, redactor } = logged();
  const model = new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: "ok" },
          { type: "text-end" as const, id: "t" },
          { type: "finish" as const, finishReason: stop, usage, providerMetadata: GATEWAY_META },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    },
  });
  const result = streamText({
    model: maskedModel(model, redactor),
    prompt: MATERIAL,
    providerOptions: ZDR_RULES,
  });
  for await (const _ of result.textStream) void _;
  assert.deepEqual(
    rows.map((row) => [row["status"], row["output_tokens"]]),
    [["ok", 5]],
  );

  const broken = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("provider down");
    },
  });
  await assert.rejects(
    generateText({
      model: maskedModel(broken, redactor),
      prompt: MATERIAL,
      providerOptions: ZDR_RULES,
      maxRetries: 0,
    }),
  );
  assert.equal(rows.at(-1)?.["status"], "failed");
  assertNoSecrets(rows.at(-1)?.["payload"], "a failed call's log row");
});

test("the AI log: embeddings and Chat Completions are logged; a log that cannot be written never breaks the call", async () => {
  const { rows, redactor } = logged();
  const embedder = new MockEmbeddingModelV4({
    doEmbed: { embeddings: [[1]], usage: { tokens: 10 }, warnings: [] },
  });
  await embedMany({ model: embedder, values: [MATERIAL], redactor, providerOptions: ZDR_RULES });
  globalThis.fetch = async () =>
    Response.json({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 7, completion_tokens: 2, cost: 0.0004 },
    });
  await postChatCompletion({
    body: {
      model: "openai/gpt-5.4",
      providerOptions: ZDR_RULES,
      messages: [{ role: "user", content: MATERIAL }],
    },
    redactor,
    token: "t",
  });
  assert.deepEqual(
    rows.map((row) => [row["model"], row["status"], row["input_tokens"], row["cost_usd"]]),
    [
      ["mock-model-id", "ok", 10, null],
      ["openai/gpt-5.4", "ok", 7, 0.0004],
    ],
  );
  for (const row of rows) assertNoSecrets(row["payload"], "a log row");

  const failing = logged({ fail: true });
  const errors: string[] = [];
  const errorLog = console.error;
  console.error = (line: string) => errors.push(line);
  try {
    const model = new MockLanguageModelV4({ doGenerate: textAnswer("ok") });
    const result = await generateText({
      model: maskedModel(model, failing.redactor),
      prompt: MATERIAL,
      providerOptions: ZDR_RULES,
    });
    assert.equal(result.text, "ok");
  } finally {
    console.error = errorLog;
  }
  assert.equal(errors.length, 1);
  assertNoSecrets(errors, "the error line");
});

test("the AI log never stores a file (deck pages): only its type and size", async () => {
  const { rows, redactor } = logged();
  const model = new MockLanguageModelV4({ doGenerate: textAnswer("side 1: tekst") });
  const pdf = new Uint8Array(200_000).fill(37);
  await generateText({
    model: maskedModel(model, redactor, { unmaskedFiles: "deck_pages_for_ocr" }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transskribér siderne." },
          { type: "file", data: pdf, mediaType: "application/pdf" },
        ],
      },
    ],
    providerOptions: ZDR_RULES,
  });
  const payload = JSON.stringify(rows[0]?.["payload"]);
  assert.ok(payload.length < 1_000, `${payload.length} chars`);
  assert.match(payload, /"omitted":"file"/);
  assert.match(payload, /"bytes":200000/);
});

test("the AI log: a cut payload, a safe flow name, a refused row kept without payload, a time limit", async () => {
  const huge = payloadForLog({ text: "x".repeat(MAX_PAYLOAD_CHARS + 10) }) as Record<
    string,
    unknown
  >;
  assert.equal(huge["truncated"], true);
  assert.equal(String(huge["text"]).length, MAX_PAYLOAD_CHARS);
  assert.deepEqual(payloadForLog({ a: "b\u0000c" }), { a: "bc" });

  const rows: Array<Record<string, unknown>> = [];
  let calls = 0;
  const service = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        calls += 1;
        if (row["payload"] !== null)
          return { error: { message: "unsupported Unicode escape sequence" } };
        rows.push(row);
        return { error: null };
      },
    }),
  };
  const redactor = attachCallLog(createRedactor(), {
    fundId: FUND,
    flow: "Brain L1-Extract!",
    service: service as unknown as Parameters<typeof attachCallLog>[1]["service"],
  });
  await writeCallLog(redactor, {
    model: "m",
    status: "ok",
    payload: ["hej"],
    providerOptions: ZDR_RULES,
  });
  assert.equal(calls, 2, "written again without the payload");
  assert.equal(rows[0]?.["flow"], "brain_l1_extract_");
  assert.equal(rows[0]?.["payload"], null);

  const hanging = attachCallLog(createRedactor(), {
    fundId: FUND,
    flow: "screening",
    service: {
      from: () => ({ insert: () => new Promise(() => {}) }),
    } as unknown as Parameters<typeof attachCallLog>[1]["service"],
  });
  const errorLog = console.error;
  const errors: string[] = [];
  console.error = (line: string) => errors.push(line);
  const started = Date.now();
  try {
    await writeCallLog(
      hanging,
      { model: "m", status: "ok", payload: [], providerOptions: ZDR_RULES },
      50,
    );
  } finally {
    console.error = errorLog;
  }
  assert.ok(Date.now() - started < 1_000);
  assert.match(errors[0] ?? "", /ai_call_log_failed/);
});

// ---------------------------------------------------------------------------------------------
// The scan: no model call outside model-call.ts (the lint rule in eslint.config.js says the same
// for src; this also covers scripts and .mjs files).
// ---------------------------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

/** Files that may call a model directly, and why. Keep this short. */
const ALLOWED: Record<string, string> = {
  "src/lib/ai/model-call.ts": "the control point itself",
  "scripts/check-zdr.ts": "sends only the fixed text 'Interlect ZDR check' to test the providers",
};

// What may be imported from "ai" outside the control point (the same list as eslint.config.js).
const AI_ALLOWED_IMPORTS = new Set([
  "asSchema",
  "jsonSchema",
  "Output",
  "tool",
  "isStepCount",
  "NoObjectGeneratedError",
  "NoOutputGeneratedError",
  "LanguageModel",
  "ModelMessage",
  "ToolSet",
]);

/** A direct model call: the Gateway's address, a provider package, or a model function of "ai". */
function directCall(source: string): boolean {
  if (/ai-gateway\.vercel\.sh(?!\/v1\/models)/.test(source)) return true;
  if (/(?:import|require)\(\s*["'](?:ai|@ai-sdk\/[a-z-]+)["']\s*\)/.test(source)) return true;
  if (/from\s*["']@ai-sdk\/(?!provider["'])[a-z-]+["']/.test(source)) return true;
  if (/import\s+(?:\*\s+as\s+\w+|\w+)\s*(?:,[^;]*)?from\s*["']ai["']/.test(source)) return true;
  for (const m of source.matchAll(
    /(?:import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']ai["']/g,
  )) {
    for (const item of (m[1] ?? "").split(",")) {
      const name =
        item
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0] ?? "";
      if (name && !AI_ALLOWED_IMPORTS.has(name)) return true;
    }
  }
  return false;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx|mjs|js)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) return [];
    return [path];
  });
}

test("no file calls an AI model except through model-call.ts", () => {
  const direct: string[] = [];
  for (const file of [...sourceFiles(join(ROOT, "src")), ...sourceFiles(join(ROOT, "scripts"))]) {
    const path = relative(ROOT, file);
    if (path in ALLOWED) continue;
    if (directCall(readFileSync(file, "utf8"))) direct.push(path);
  }
  assert.deepEqual(
    direct,
    [],
    "Call the model through src/lib/ai/model-call.ts (maskedModel, embedMany, postChatCompletion)",
  );
});

test("the scan finds a direct call", () => {
  assert.ok(directCall(`import { generateText, Output } from "ai";`));
  assert.ok(directCall(`import {\n  embedMany,\n} from 'ai';`));
  assert.ok(directCall(`import { rerank, type ToolSet } from "ai";`));
  assert.ok(directCall(`import * as ai from "ai";`));
  assert.ok(directCall(`export { streamText } from "ai";`));
  assert.ok(directCall(`const { embed } = await import("ai");`));
  assert.ok(directCall(`import("ai").then((m) => m.generateText);`));
  assert.ok(directCall(`fetch("https://ai-gateway.vercel.sh/v1/chat/completions")`));
  assert.ok(directCall("const BASE = `https://ai-gateway.vercel.sh/v3/ai`;"));
  assert.ok(directCall(`import { gateway } from "@ai-sdk/gateway";`));
  assert.ok(directCall(`import { createOpenAI } from "@ai-sdk/openai";`));
  assert.ok(!directCall(`import { tool, jsonSchema, type ToolSet } from "ai";`));
  assert.ok(!directCall(`import { generateText } from "@/lib/ai/model-call";`));
  assert.ok(
    !directCall(`fetch("https://ai-gateway.vercel.sh/v1/models/openai/gpt-5.4/endpoints")`),
  );
});
