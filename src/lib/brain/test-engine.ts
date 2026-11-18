/**
 * MARKED TEST ENGINE for the Brain chat UI. Reachable ONLY from the Admin page
 * `/intern/brain-test`; no customer page imports it. Everything it says is invented to exercise
 * the contract (`chat-contract.ts`): steps, streaming text, citation markers, missing sources,
 * hostile model text, errors and a slow stream for the Stop button. It never touches the
 * database, a model or the network. It is replaced by session B's real route; delete it then.
 *
 * Trigger words in the question choose the scenario (see `TEST_SCENARIOS`).
 */
import type { ChatCitation, ChatRequest, ChatStreamEvent } from "./chat-contract.ts";

export const TEST_ENGINE_LABEL = "TESTMOTOR";

export interface TestScenario {
  word: string;
  what: string;
}

export const TEST_SCENARIOS: readonly TestScenario[] = [
  { word: "(ingen ord)", what: "Svar med trin, tekst og to kilder" },
  { word: "ved ikke", what: "Ærligt 'det ved Brain ikke endnu' med manglende materiale" },
  { word: "kilde", what: "Påstand med [n] uden kilde (markeres) og en slettet kilde" },
  { word: "html", what: "Fjendtlig modeltekst: script, billede og eksterne links" },
  { word: "fejl", what: "Månedsgrænsen er nået (fast tekst, ingen rå fejl)" },
  { word: "brud", what: "Strømmen slutter uden done (bliver en fejl)" },
  { word: "delvis", what: "Fejl efter delvis tekst (fejlen står under teksten)" },
  { word: "langsom", what: "Langsomt svar til Stop-knappen" },
];

const CASE_ID = "00000000-0000-4000-8000-000000000001";

const citations: ChatCitation[] = [
  { n: 1, kind: "case", id: CASE_ID, label: "Testcase A (opdigtet)" },
  {
    n: 2,
    kind: "fact",
    id: "fact-test-1",
    label: "Opdigtet faktum",
    quote: "Dette citat er opdigtet af testmotoren.",
    trust: "company_claim",
    at: "2026-09-01T10:00:00Z",
  },
];

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

function chunks(text: string, size = 14): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export async function* testEngine(
  request: ChatRequest,
  signal: AbortSignal,
  options: { delayMs?: number } = {},
): AsyncGenerator<ChatStreamEvent> {
  const delay = options.delayMs ?? 30;
  const q = request.question.toLowerCase();
  if (!request.threadId) {
    yield { type: "thread", threadId: "00000000-0000-4000-8000-0000000000aa", title: null };
  }
  if (q.includes("fejl")) {
    yield { type: "error", code: "budget_reached", message: "SQLSTATE 57014 raw database text" };
    return;
  }
  yield { type: "step", index: 0, text: "Leder i jeres cases og noter" };
  await wait(delay * 6, signal);
  yield { type: "step", index: 1, text: "Holder det op mod jeres beslutninger" };
  await wait(delay * 6, signal);
  yield { type: "step", index: 2, text: "Skriver svaret" };

  let text: string;
  let sources: ChatCitation[] = citations;
  let missing: string[] = [];
  let unsourced = false;
  if (q.includes("ved ikke")) {
    text =
      "Det ved Brain ikke endnu. Der er ingen gemte kilder, der besvarer spørgsmålet, så Brain gætter ikke.";
    sources = [];
    missing = ["Upload den seneste statusrapport for at svare præcist"];
  } else if (q.includes("kilde")) {
    text =
      "Den første påstand har en kilde [1]. Den næste har ingen kilde [9]. En tredje er en slettet kilde [3].";
    sources = [
      ...citations,
      { n: 3, kind: "case", id: CASE_ID, label: "Skjult navn", deleted: true },
    ];
    unsourced = true;
  } else if (q.includes("html")) {
    text =
      "<script>alert('x')</script>Se ![billede](https://evil.test/x.png) og [et link](https://evil.test/a) og [casen](/cases/" +
      CASE_ID +
      ") [1].\n\n- et punkt med **fed** tekst\n- et punkt [2]";
  } else {
    text =
      "Dette er et opdigtet svar fra testmotoren [1].\n\nDet bruges kun til at prøve, hvordan Brain ser ud, når svaret kommer i dele, med en kilde [2] og en lille liste:\n\n- første punkt\n- andet punkt";
  }
  const slow = q.includes("langsom");
  for (const part of chunks(text, slow ? 4 : 14)) {
    if (signal.aborted) return;
    yield { type: "delta", text: part };
    await wait(slow ? 120 : delay, signal);
  }
  if (q.includes("brud")) return;
  // The engine's agreed behaviour when every lookup failed: an error after some text, no answer.
  if (q.includes("delvis")) {
    yield { type: "error", code: "failed" };
    return;
  }
  if (signal.aborted) return;
  yield { type: "sources", citations: sources };
  yield {
    type: "done",
    messageId: "00000000-0000-4000-8000-0000000000bb",
    confidence: missing.length ? "low" : "medium",
    missing,
    unsourcedClaims: unsourced,
  };
}
