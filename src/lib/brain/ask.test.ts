/** Test af Spørg Interlect: sidens kontekst, tekster og det huskede skjul-valg. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK_ALL_CASES,
  ASK_HIDDEN_KEY,
  askBrainContext,
  askHeading,
  askKey,
  askKnows,
  askPlaceholder,
  askSuggestions,
  readAskHidden,
  readAskSession,
  writeAskHidden,
  writeAskSession,
  type AskContext,
} from "./ask.ts";
import { contextRequestFields } from "./chat-view.ts";

const pleo: AskContext = { kind: "case", id: "c1", name: "Pleo", phase: "dyb analyse" };

test("en case giver en case-tråd; alle andre sider spørger om alle cases", () => {
  assert.deepEqual(contextRequestFields(askBrainContext(pleo)), {
    caseId: "c1",
    entityIds: [],
    scope: "cases",
  });
  assert.deepEqual(contextRequestFields(askBrainContext(ASK_ALL_CASES)), {
    caseId: null,
    entityIds: [],
    scope: "cases",
  });
});

test("samme case i en anden fase er samme samtale; en anden case er en ny", () => {
  assert.equal(askKey(pleo), askKey({ ...pleo, phase: "screening" }));
  assert.notEqual(askKey(pleo), askKey({ kind: "case", id: "c2", name: "Pleo" }));
  assert.notEqual(askKey(pleo), askKey(ASK_ALL_CASES));
});

test("teksterne nævner casen og fasen, når de kendes", () => {
  assert.equal(askKnows(pleo), "Kender Pleo, dyb analyse");
  assert.equal(askKnows({ kind: "case", id: "c1", name: "Pleo" }), "Kender Pleo");
  assert.equal(askKnows(ASK_ALL_CASES), "Kender alle jeres cases");
  assert.equal(askHeading(pleo), "Hvad vil du vide om Pleo?");
  assert.equal(askPlaceholder(ASK_ALL_CASES), "Spørg om jeres cases");
});

test("fire faste forslag uden selskabsnavne", () => {
  for (const context of [pleo, ASK_ALL_CASES]) {
    const suggestions = askSuggestions(context);
    assert.equal(suggestions.length, 4);
    for (const suggestion of suggestions) assert.doesNotMatch(suggestion, /Pleo/);
  }
});

test("skjul-valget huskes, og blokeret lager giver aldrig en fejl", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  assert.equal(readAskHidden(storage), false);
  writeAskHidden(storage, true);
  assert.equal(values.get(ASK_HIDDEN_KEY), "1");
  assert.equal(readAskHidden(storage), true);
  writeAskHidden(storage, false);
  assert.equal(readAskHidden(storage), false);

  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(readAskHidden(blocked), false);
  assert.doesNotThrow(() => writeAskHidden(blocked, true));
  assert.equal(readAskHidden(undefined), false);
});

test("sessionen (T-601): åben-flag og seneste tråd pr. kontekst huskes pr. fond, kun id'er", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  assert.deepEqual(readAskSession(storage, "f1"), { open: false, threads: {} });
  writeAskSession(storage, "f1", { open: true });
  writeAskSession(storage, "f1", { thread: { key: askKey(pleo), id: "t1" } });
  writeAskSession(storage, "f1", { thread: { key: askKey(ASK_ALL_CASES), id: "t2" } });
  assert.deepEqual(readAskSession(storage, "f1"), {
    open: true,
    threads: { [askKey(pleo)]: "t1", [askKey(ASK_ALL_CASES)]: "t2" },
  });
  assert.deepEqual(readAskSession(storage, "f2"), { open: false, threads: {} });
  writeAskSession(storage, "f1", { thread: { key: askKey(pleo), id: null } });
  assert.deepEqual(readAskSession(storage, "f1").threads, { [askKey(ASK_ALL_CASES)]: "t2" });
});

test("sessionen: ødelagt eller blokeret lager giver en tom start, aldrig en fejl", () => {
  const broken = { getItem: () => "{ikke json", setItem: () => undefined };
  assert.deepEqual(readAskSession(broken, "f1"), { open: false, threads: {} });
  const odd = { getItem: () => JSON.stringify({ open: "ja", threads: { a: 1, b: "t" } }) };
  assert.deepEqual(readAskSession(odd, "f1"), { open: false, threads: { b: "t" } });
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readAskSession(blocked, "f1"), { open: false, threads: {} });
  writeAskSession(blocked, "f1", { open: true });
  assert.deepEqual(readAskSession(undefined, "f1"), { open: false, threads: {} });
});
