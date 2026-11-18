/** Test af @-kontekst, hilsen og testmotorens kontraktoverholdelse. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_CASES,
  brainSuggestions,
  contextLabel,
  contextRequestFields,
  CHAT_MODE_CHOICES,
  greetingFor,
  sameContext,
} from "./chat-view.ts";
import { parseChatStreamEvent, type ChatRequest, type ChatStreamEvent } from "./chat-contract.ts";
import { CHAT_MODES } from "./chat/prompt.ts";
import { TEST_SCENARIOS, testEngine } from "./test-engine.ts";
import { translate } from "../i18n/translate.ts";

test("kontekst: hvad hver valgmulighed betyder i forespørgslen", () => {
  assert.deepEqual(contextRequestFields(ALL_CASES), {
    caseId: null,
    entityIds: [],
    scope: "cases",
  });
  assert.deepEqual(contextRequestFields({ kind: "thesis" }), {
    caseId: null,
    entityIds: [],
    scope: "thesis",
  });
  assert.deepEqual(contextRequestFields({ kind: "case", id: "c1", label: "Pleo" }), {
    caseId: "c1",
    entityIds: [],
    scope: "cases",
  });
  assert.deepEqual(contextRequestFields({ kind: "entity", id: "e1", label: "Maja" }), {
    caseId: null,
    entityIds: ["e1"],
    scope: "cases",
  });
  assert.equal(contextLabel(ALL_CASES), "Alle cases");
  assert.equal(contextLabel({ kind: "thesis" }), "Tesen");
  assert.equal(contextLabel({ kind: "case", id: "c1", label: "Pleo" }), "Pleo");
  assert.equal(
    sameContext({ kind: "case", id: "a", label: "x" }, { kind: "case", id: "b", label: "x" }),
    false,
  );
  assert.equal(sameContext({ kind: "thesis" }, { kind: "thesis" }), true);
});

test("forslag: faste og uden opdigtede selskabsnavne", () => {
  assert.equal(brainSuggestions().length, 4);
  for (const suggestion of brainSuggestions()) {
    assert.ok(suggestion.title.endsWith("?"));
    assert.doesNotMatch(suggestion.title, /Havbrug|Kornkraft|Fjordgas|Pollen|Soltrådt/);
  }
});

test("hilsen følger dansk tid og tåler manglende navn", () => {
  assert.equal(greetingFor(new Date("2026-10-02T06:30:00Z"), "Maja"), "God morgen, Maja"); // 08:30
  assert.equal(greetingFor(new Date("2026-10-02T09:30:00Z"), null), "God formiddag"); // 11:30
  assert.equal(greetingFor(new Date("2026-10-02T12:00:00Z"), "Maja"), "God eftermiddag, Maja");
  assert.equal(greetingFor(new Date("2026-10-02T18:30:00Z"), "Maja"), "God aften, Maja"); // 20:30
  assert.equal(greetingFor(new Date("2026-10-02T22:30:00Z"), "Maja"), "Hej, Maja"); // 00:30
});

const request = (question: string, threadId: string | null = null): ChatRequest => ({
  fundId: "f",
  threadId,
  caseId: null,
  entityIds: [],
  scope: "cases",
  question,
  mode: "fast",
});

async function run(question: string, threadId: string | null = null) {
  const events: ChatStreamEvent[] = [];
  for await (const event of testEngine(request(question, threadId), new AbortController().signal, {
    delayMs: 0,
  })) {
    // The test engine must speak the contract: every event survives the guard.
    const parsed = parseChatStreamEvent(JSON.parse(JSON.stringify(event)));
    assert.equal(parsed?.type, event.type, JSON.stringify(event));
    events.push(event);
  }
  return events;
}

test("testmotoren: hvert scenarie følger kontrakten og slutter rigtigt", async () => {
  for (const scenario of TEST_SCENARIOS) {
    const word = scenario.word.startsWith("(") ? "hej" : scenario.word;
    const events = await run(word);
    const last = events.at(-1)!;
    if (word === "brud") assert.notEqual(last.type, "done", "brud: ingen done");
    else
      assert.ok(last.type === "done" || last.type === "error", `${word}: slutter med done/error`);
    assert.equal(events.filter((e) => e.type === "thread").length, 1, `${word}: ny tråd`);
  }
});

test("testmotoren: eksisterende tråd giver ingen thread-hændelse; fejl sender ingen delta", async () => {
  const again = await run("hej", "t-1");
  assert.equal(
    again.some((e) => e.type === "thread"),
    false,
  );
  const failed = await run("fejl", "t-1");
  assert.deepEqual(
    failed.map((e) => e.type),
    ["error"],
  );
});

test("testmotoren: Stop (abort) afbryder strømmen midt i svaret", async () => {
  const controller = new AbortController();
  const seen: string[] = [];
  for await (const event of testEngine(request("langsom", "t"), controller.signal, {
    delayMs: 0,
  })) {
    seen.push(event.type);
    if (event.type === "delta") controller.abort();
  }
  assert.ok(seen.includes("delta"));
  assert.ok(!seen.includes("done"));
});

test("Hurtig/Grundig: loftet i UI-data passer til engine-loftet (prisen vises ikke, T-612)", () => {
  for (const mode of ["fast", "deep"] as const) {
    assert.equal(CHAT_MODE_CHOICES[mode].capDkk, CHAT_MODES[mode].capDkk);
  }
});

test("web search: chippen viser ingen pris (T-612)", async () => {
  const { WEB_CHIP_KEY, WEB_EXTRA_DKK } = await import("./chat-view.ts");
  assert.equal(WEB_EXTRA_DKK, 1);
  for (const language of ["da", "en"] as const) {
    assert.doesNotMatch(translate(language, WEB_CHIP_KEY), /kr/, "ingen pris i UI (T-612)");
  }
});
