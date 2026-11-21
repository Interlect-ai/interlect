import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PUBLIC_RESEARCH_ANSWER_KEYS, publicResearchAnswer } from "./research-answer.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// What the research step keeps in its own output_json (server only) next to the answer.
const STEP_INTERNALS = [
  "persistedSources",
  "persistedEvidence",
  "reusedFromRunId",
  "researchLog",
  "researchPlan",
  "researchPlanStatus",
  "questionNeutralizer",
  "researchFollowUp",
  "caseMaterial",
  "identityExtraction",
  "deckOcr",
  "founderCheck",
];

test("T-1070: the run keeps only the research answer, never the step's model ids or errors", () => {
  const step = {
    schemaVersion: "interlect-public-research-v1",
    companyName: "Veo",
    findings: [{ claim: "x" }],
    gaps: ["y"],
    identityAmbiguity: null,
    companyProfile: null,
    persistedSources: 4,
    persistedEvidence: 9,
    reusedFromRunId: "run-1",
    researchLog: [{ moduleId: "market", error: "openai/gpt-5: rate limited" }],
    researchPlan: { model: "openai/gpt-5.4-mini", tracks: [] },
    researchPlanStatus: "ok",
    questionNeutralizer: { model: "openai/gpt-5.4-mini" },
    researchFollowUp: { model: "perplexity/sonar-pro" },
    caseMaterial: { deck: "..." },
    somethingNew: { model: "anthropic/claude" },
  };
  const answer = publicResearchAnswer(step);
  assert.deepEqual(Object.keys(answer).sort(), [...PUBLIC_RESEARCH_ANSWER_KEYS].sort());
  assert.doesNotMatch(JSON.stringify(answer), /openai|perplexity|anthropic|model/);
  for (const key of STEP_INTERNALS) assert.ok(!PUBLIC_RESEARCH_ANSWER_KEYS.includes(key as never));
});

test("T-1070: a key the answer lacks is left out, not set to undefined", () => {
  const answer = publicResearchAnswer({ schemaVersion: "interlect-public-research-v1", gaps: [] });
  assert.deepEqual(answer, { schemaVersion: "interlect-public-research-v1", gaps: [] });
});

test("T-1070: both deep paths store the answer through the allowlist", () => {
  const worker = read("./deep-worker.server.ts");
  const fn = worker.slice(worker.indexOf("function publicResearchPacket("));
  assert.match(fn.slice(0, fn.indexOf("\n}\n")), /return publicResearchAnswer\(value\);/);
  assert.match(worker, /publicResearch: publicPacket,/);
  assert.match(
    read("./deep.functions.ts"),
    /publicResearch: publicResearchAnswer\(publicResearch\.packet\),/,
  );
});

test("T-1070: migration 0130 cleans old rows to exactly the same keys", () => {
  const sql = read("../../../db/migrations/0130_run_ai_internals_cleanup.sql");
  const lists = [...sql.matchAll(/key (?:not )?in \(\s*([^)]*)\)/g)].map((match) =>
    [...match[1]!.matchAll(/'(\w+)'/g)].map((key) => key[1]).sort(),
  );
  assert.equal(lists.length, 2);
  for (const list of lists) assert.deepEqual(list, [...PUBLIC_RESEARCH_ANSWER_KEYS].sort());
  assert.match(sql, /revoke select \(error_message\) on public\.analysis_runs from authenticated;/);
  assert.match(
    sql,
    /revoke select \(error_message\) on public\.analysis_run_steps from authenticated;/,
  );
});

test("T-1070: a failed research call stores the server's sentence, not the provider's text", () => {
  const source = read("./public-research.ts");
  const cls = source.slice(source.indexOf("export class ResearchCallError"));
  const body = cls.slice(0, cls.indexOf("\n}\n"));
  assert.match(body, /super\(msg\("callFailed"\), \{ cause \}\);/);
  assert.doesNotMatch(body, /super\([^)]*cause\.message/);
  // The run's error is the bare sentence; the causes only go to the log.
  assert.doesNotMatch(source, /msg\("tracksSucceeded"[^`]*`[^`]*reasons/);
  assert.doesNotMatch(source, /\$\{reasons\.slice|\$\{packetErrors\.slice/);
});

test("T-1070: a rate-limited research call is stored as the server's own 'service limited' line", () => {
  const source = readFileSync(new URL("./public-research.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /this\.serviceLimited = \/RateLimit\|Free tier\|rate limit\/i\.test\(detail\);/,
  );
  assert.match(source, /\? msg\("serviceLimited"\)\s*: msg\("tracksSucceeded"/);
});
