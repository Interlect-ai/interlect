/** Test af samtalemodellen, kildechips og HTTP-transporten. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStreamEvent,
  citationDisplayNumbers,
  citationTarget,
  answerIsActionable,
  failTurn,
  newAnswerTurn,
  stopTurn,
  turnsFromMessages,
  DELETED_SOURCE_LABEL,
} from "./chat-model.ts";
import { createHttpChatTransport } from "./chat-client.ts";
import type { ChatRequest, ChatStreamEvent } from "./chat-contract.ts";

const UUID = "11111111-2222-3333-4444-555555555555";

test("trin, tekst, kilder og slut bygger svaret op i rækkefølge", () => {
  let turn = newAnswerTurn("a");
  const events: ChatStreamEvent[] = [
    { type: "step", index: 0, text: "Leder i jeres cases og noter" },
    { type: "step", index: 1, text: "Holder det op mod jeres beslutninger" },
    { type: "delta", text: "Pleo " },
    { type: "step", index: 2, text: "Skriver svaret" },
    { type: "delta", text: "er screenet [1]." },
    { type: "sources", citations: [{ n: 1, kind: "case", id: UUID, label: "Pleo" }] },
    { type: "done", messageId: "m1", confidence: "medium", missing: ["Upload statusrapport"] },
  ];
  const seen: string[] = [];
  for (const event of events) {
    turn = applyStreamEvent(turn, event).turn;
    seen.push(turn.status);
  }
  assert.deepEqual(seen, [
    "thinking",
    "thinking",
    "streaming",
    "streaming",
    "streaming",
    "streaming",
    "done",
  ]);
  assert.equal(turn.text, "Pleo er screenet [1].");
  assert.equal(turn.steps.length, 3);
  assert.equal(turn.citations.length, 1);
  assert.equal(turn.messageId, "m1");
  assert.deepEqual(turn.missing, ["Upload statusrapport"]);
});

test("efter slut ændrer ingen hændelse svaret", () => {
  let turn = newAnswerTurn("a");
  turn = applyStreamEvent(turn, { type: "done", messageId: "m" }).turn;
  const after = applyStreamEvent(turn, { type: "delta", text: "for sent" }).turn;
  assert.equal(after.text, "");
  const errored = failTurn(newAnswerTurn("b"));
  assert.equal(applyStreamEvent(errored, { type: "done", messageId: "x" }).turn.status, "error");
});

test("thread-hændelsen giver trådens id uden at ændre svaret", () => {
  const result = applyStreamEvent(newAnswerTurn("a"), {
    type: "thread",
    threadId: "t1",
    title: "Titel",
  });
  assert.deepEqual(result.threadId, { id: "t1", title: "Titel" });
  assert.equal(result.turn.status, "thinking");
});

test("fejl og stop", () => {
  const failed = failTurn({ ...newAnswerTurn("a"), text: "delvist", status: "streaming" });
  assert.equal(failed.status, "error");
  assert.equal(failed.errorCode, "failed");
  const stopped = stopTurn({ ...newAnswerTurn("a"), text: "delvist", status: "streaming" });
  assert.equal(stopped.status, "done");
  assert.equal(stopped.stopped, true, "et stoppet svar ser aldrig færdigt ud");
  assert.equal(stopped.unsourcedClaims, true, "delsvar uden kilder markeres");
});

test("kun en afvisning før strømmen betyder, at intet er gemt", () => {
  const refused = applyStreamEvent(newAnswerTurn("a"), {
    type: "error",
    code: "rate_limited",
    beforeStream: true,
  });
  assert.equal(refused.turn.refused, true, "HTTP-afvisning: Prøv igen må erstatte parret");
  const failedEarly = applyStreamEvent(newAnswerTurn("b"), { type: "error", code: "failed" });
  assert.equal(failedEarly.turn.refused, false, "fejl i strømmen: spørgsmålet kan være gemt");
  let turn = applyStreamEvent(newAnswerTurn("c"), { type: "step", index: 0, text: "Leder" }).turn;
  turn = applyStreamEvent(turn, { type: "error", code: "failed" }).turn;
  assert.equal(turn.started, true);
  assert.equal(turn.refused, false);
});

test("handlinger kun på et helt, gemt svar; den bundne case følger med", () => {
  const loaded = turnsFromMessages(
    [
      {
        id: "a1",
        role: "assistant",
        content: "Svar",
        citations: [],
        usedWeb: false,
        createdAt: "x",
        myFeedback: "useful",
      },
    ],
    { id: UUID, name: "Pleo" },
  );
  const answer = loaded[0];
  assert.equal(answer?.kind, "answer");
  if (answer?.kind !== "answer") return;
  assert.equal(answer.feedback, "useful");
  assert.deepEqual(answer.noteCase, { id: UUID, name: "Pleo" });
  assert.equal(answerIsActionable(answer), true);
  assert.equal(answerIsActionable(newAnswerTurn("x")), false, "kører stadig");
  const stoppedEarly = stopTurn(newAnswerTurn("y"));
  assert.equal(answerIsActionable(stoppedEarly), false, "stoppet uden gemt svar");
});

test("gemte beskeder bliver spørgsmål og færdige svar", () => {
  const turns = turnsFromMessages([
    { id: "1", role: "user", content: "Hvorfor?", citations: [], usedWeb: false, createdAt: "x" },
    {
      id: "2",
      role: "assistant",
      content: "Fordi [1].",
      citations: [{ n: 1, kind: "case", id: UUID, label: "Pleo" }],
      usedWeb: false,
      createdAt: "y",
    },
  ]);
  assert.equal(turns[0]?.kind, "question");
  assert.equal(turns[1]?.kind === "answer" && turns[1].status, "done");
});

test("kildechips: case, note, mandat-uafhængige kort, web og slettede", () => {
  const caseChip = citationTarget({ n: 1, kind: "case", id: UUID, label: "Pleo" });
  assert.equal(caseChip.href, `/cases/${UUID}`);
  assert.equal(caseChip.card, false);

  const note = citationTarget({
    n: 2,
    kind: "event",
    id: "e1",
    label: "Note",
    caseId: UUID,
    ref: "case_notes:abc",
  });
  assert.equal(note.href, `/cases/${UUID}?fane=noter`);
  assert.equal(note.icon, "note");

  const fact = citationTarget({
    n: 3,
    kind: "fact",
    id: "f",
    label: "Fakta",
    quote: "ordret",
    trust: "company_claim",
  });
  assert.equal(fact.href, null);
  assert.equal(fact.card, true);

  const web = citationTarget({
    n: 4,
    kind: "web",
    id: "w",
    label: "Side",
    ref: "https://example.test/a",
    trust: "public_web",
  });
  assert.equal(web.href, "https://example.test/a");
  assert.equal(
    citationTarget({ n: 5, kind: "web", id: "w", label: "x", ref: "javascript:alert(1)" }).href,
    null,
  );

  const gone = citationTarget({
    n: 6,
    kind: "case",
    id: UUID,
    label: "Hemmeligt navn",
    deleted: true,
  });
  assert.equal(gone.label, DELETED_SOURCE_LABEL);
  assert.equal(gone.href, null);
  assert.doesNotMatch(JSON.stringify(gone), /Hemmeligt/);
});

test("kildechips: et id der ikke er et uuid kommer aldrig i en URL", () => {
  const chip = citationTarget({ n: 1, kind: "case", id: "../../admin", label: "x" });
  assert.equal(chip.href, null);
  const event = citationTarget({
    n: 2,
    kind: "event",
    id: "e",
    label: "x",
    caseId: "javascript:1",
  });
  assert.equal(event.href, null);
});

// --- HTTP transport -------------------------------------------------------------------

const request: ChatRequest = {
  fundId: UUID,
  threadId: null,
  caseId: null,
  entityIds: [],
  scope: "cases",
  question: "Hej",
  mode: "fast",
};

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "application/x-ndjson" } },
  );
}

async function collect(response: Response | Error) {
  const transport = createHttpChatTransport({
    getToken: async () => "tok",
    fetchImpl: (async () => {
      if (response instanceof Error) throw response;
      return response;
    }) as unknown as typeof fetch,
  });
  const out: ChatStreamEvent[] = [];
  for await (const event of transport(request, new AbortController().signal)) out.push(event);
  return out;
}

test("transport: linjer delt midt i en chunk og en ødelagt linje", async () => {
  const events = await collect(
    streamOf([
      '{"type":"step","index":0,"text":"Leder"}\n{"type":"del',
      'ta","text":"Hej"}\nikke json\n{"type":"done","messageId":"m1"}\n',
    ]),
  );
  assert.deepEqual(
    events.map((e) => e.type),
    ["step", "delta", "done"],
  );
});

test("transport: en strøm uden done bliver en fejl, ikke et stille hul", async () => {
  const events = await collect(streamOf(['{"type":"delta","text":"Hej"}\n']));
  assert.deepEqual(
    events.map((e) => e.type),
    ["delta", "error"],
  );
});

test("transport: HTTP-afvisning og netværksfejl giver faste koder", async () => {
  assert.deepEqual(await collect(new Response("nej", { status: 403 })), [
    { type: "error", code: "forbidden", beforeStream: true },
  ]);
  assert.deepEqual(await collect(new Response("pause", { status: 429 })), [
    { type: "error", code: "rate_limited", beforeStream: true },
  ]);
  assert.deepEqual(
    await collect(new Response("fejl", { status: 500 })),
    [{ type: "error", code: "failed" }],
    "en 5xx er ikke kendt som afvisning: spørgsmålet kan være gemt",
  );
  assert.deepEqual(await collect(new Error("offline")), [{ type: "error", code: "failed" }]);
});

test("transport: afbrudt strøm (Stop) afsluttes stille", async () => {
  const controller = new AbortController();
  controller.abort();
  const transport = createHttpChatTransport({
    getToken: async () => null,
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("afbrudt", "AbortError");
      return streamOf([]);
    }) as unknown as typeof fetch,
  });
  const out: ChatStreamEvent[] = [];
  for await (const event of transport(request, controller.signal)) out.push(event);
  assert.deepEqual(out, []);
});

test("kildenumrene vises fra 1 i den rækkefølge, de optræder i svaret (T-653 c)", () => {
  const cite = (n: number) => ({ n, kind: "case" as const, id: UUID, label: `Kilde ${n}` });
  const shown = citationDisplayNumbers("Først [5], så [7, 5] og til sidst [6].", [
    cite(5),
    cite(6),
    cite(7),
  ]);
  assert.deepEqual(
    [...shown],
    [
      [5, 1],
      [7, 2],
      [6, 3],
    ],
  );
});

test("kilder uden markør i teksten og ukendte markører får ikke et nummer i vejen", () => {
  const cite = (n: number) => ({ n, kind: "case" as const, id: UUID, label: `Kilde ${n}` });
  const shown = citationDisplayNumbers("Kun [9] og [2].", [cite(2), cite(4)]);
  assert.deepEqual(
    [...shown],
    [
      [2, 1],
      [4, 2],
    ],
  );
});
