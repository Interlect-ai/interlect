import { test } from "node:test";
import assert from "node:assert/strict";
import { CaseLoadTimeout, casePageState, withTimeout } from "./case-load.ts";

const base = {
  hasCase: false,
  sessionLoading: false,
  teamsLoading: false,
  teamsFailed: false,
  hasTeam: true,
  caseLoading: false,
  caseError: null as unknown,
  isRefusal: (error: unknown) => error === "refused",
};

test("T-882: a request that never answers ends as a timeout, a quick one passes", async () => {
  await assert.rejects(withTimeout(new Promise(() => undefined), 20), CaseLoadTimeout);
  assert.equal(await withTimeout(Promise.resolve("case"), 1000), "case");
});

test("T-882: the page waits (skeleton) until session, team and case are known, never 'not found' early", () => {
  assert.equal(casePageState({ ...base, sessionLoading: true, hasTeam: false }), "waiting");
  assert.equal(casePageState({ ...base, teamsLoading: true, hasTeam: false }), "waiting");
  assert.equal(casePageState({ ...base, caseLoading: true }), "waiting");
  assert.equal(casePageState({ ...base }), "notFound");
});

test("T-882: errors get their own state; a case on screen always wins", () => {
  assert.equal(casePageState({ ...base, caseError: new CaseLoadTimeout() }), "timeout");
  assert.equal(casePageState({ ...base, caseError: "refused" }), "refused");
  assert.equal(casePageState({ ...base, caseError: new Error("x") }), "error");
  assert.equal(casePageState({ ...base, teamsFailed: true, hasTeam: false }), "teamError");
  assert.equal(casePageState({ ...base, hasTeam: false }), "refused");
  assert.equal(casePageState({ ...base, hasCase: true, caseError: new Error("x") }), "case");
});
