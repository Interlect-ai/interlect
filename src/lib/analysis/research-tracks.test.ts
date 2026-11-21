/**
 * (spec B.4 test 2 and 3): a research that stops at the price limit after k of n tracks
 * keeps the k, and the next try ("Fortsæt") pays only for the n − k that are missing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWithinBudget, budgetCharge, BudgetExceededError, stopReasonOf } from "./budgets.ts";
import {
  deepTracksToReuse,
  finishedTracks,
  readStoredResearchTracks,
  runResearchTracks,
  type TrackCompletion,
} from "./research-tracks.ts";
import { stoppedTracksToReuse } from "./screening-phases.ts";

const MODULES = ["identity", "market", "team", "traction", "funding"].map((id) => ({ id }));
const TRACK_PRICE_USD = 0.1;

/** A stub gateway: each search has the same worst case; a track over what is left stops. */
function stubGateway(perTrackLimitUsd: (id: string) => number) {
  const searched: string[] = [];
  const search = async (module: { id: string }): Promise<TrackCompletion> => {
    const estimate = { maxCostUsd: TRACK_PRICE_USD, maxInputTokens: 100, maxOutputTokens: 100 };
    assertWithinBudget(estimate, perTrackLimitUsd(module.id), `Researchmodulet ${module.id}`, "da");
    searched.push(module.id);
    return {
      content: JSON.stringify({ track: module.id }),
      inputTokens: 100,
      outputTokens: 100,
      totalTokens: 200,
      actualCostUsd: TRACK_PRICE_USD,
      estimatedMaximumUsd: estimate,
      groundedUrls: new Set([`https://example.com/${module.id}`]),
    };
  };
  return { search, searched };
}

const charged = (attempts: Array<PromiseSettledResult<TrackCompletion>>) =>
  attempts.reduce(
    (sum, attempt) =>
      attempt.status === "fulfilled"
        ? sum + budgetCharge(attempt.value.actualCostUsd, attempt.value.estimatedMaximumUsd)
        : sum,
    0,
  );

test("a research stopped after 3 of 5 tracks keeps the 3, and the next try pays only for 2", async () => {
  // A small limit: the last two tracks do not fit.
  const first = stubGateway((id) => (id === "traction" || id === "funding" ? 0.05 : 1));
  const stopped = await runResearchTracks(MODULES, "screening", null, first.search);
  assert.deepEqual(first.searched, ["identity", "market", "team"]);
  const rejected = stopped.filter((attempt) => attempt.status === "rejected");
  assert.equal(rejected.length, 2);
  // Every missing track stopped at the limit: the run stops there (public-research's rule).
  for (const attempt of rejected) {
    assert.ok(attempt.reason instanceof BudgetExceededError);
    assert.equal(stopReasonOf(attempt.reason), "price_limit");
  }
  const kept = finishedTracks(MODULES, "screening", stopped);
  assert.deepEqual(
    kept.map((track) => track.moduleId),
    ["identity", "market", "team"],
  );
  // Kept as JSON on the step (jsonb), and read back as the next try sees it.
  const stored = readStoredResearchTracks(JSON.parse(JSON.stringify(kept)));
  assert.deepEqual(stored, kept);

  // "Fortsæt" on a raised limit: only the two missing tracks are searched and paid.
  const second = stubGateway(() => 1);
  const resumed = await runResearchTracks(MODULES, "screening", stored, second.search);
  assert.deepEqual(second.searched, ["traction", "funding"]);
  assert.ok(resumed.every((attempt) => attempt.status === "fulfilled"));
  assert.equal(charged(resumed), 2 * TRACK_PRICE_USD);
  // The taken-over tracks cost 0 and carry their own answer and grounded sources.
  const identity = resumed[0] as PromiseFulfilledResult<TrackCompletion>;
  assert.equal(identity.value.actualCostUsd, 0);
  assert.equal(budgetCharge(identity.value.actualCostUsd, identity.value.estimatedMaximumUsd), 0);
  assert.equal(identity.value.content, JSON.stringify({ track: "identity" }));
  assert.deepEqual([...identity.value.groundedUrls], ["https://example.com/identity"]);
});

test("a kept track is only taken over by the same kind of run, and malformed rows are ignored", async () => {
  const kept = [{ moduleId: "identity", mode: "deep" as const, content: "{}", groundedUrls: [] }];
  const gateway = stubGateway(() => 1);
  await runResearchTracks(MODULES, "screening", kept, gateway.search);
  assert.equal(gateway.searched.length, MODULES.length);
  assert.deepEqual(
    readStoredResearchTracks([
      null,
      "x",
      { moduleId: "a", mode: "other", content: "{}", groundedUrls: [] },
      { moduleId: "b", mode: "deep", content: 1, groundedUrls: [] },
      { moduleId: "c", mode: "deep", content: "{}", groundedUrls: ["u", 3] },
    ]),
    [{ moduleId: "c", mode: "deep", content: "{}", groundedUrls: ["u"] }],
  );
  assert.deepEqual(readStoredResearchTracks(undefined), []);
});

const NOW = Date.parse("2026-11-04T12:00:00Z");
const RUN = {
  status: "failed",
  stop_reason: "price_limit",
  config_version_id: "c1",
  prompt_template_version: "p1",
  input_evidence_ids: [],
  completed_at: "2026-11-04T11:00:00Z",
};
const TRACKS = [{ moduleId: "identity", mode: "screening", content: "{}", groundedUrls: [] }];
const RUNNING_STEP = {
  status: "failed",
  prompt_version: "r1",
  model_name: "m1",
  output_json: { researchTracks: TRACKS },
};
const CURRENT = {
  configVersionId: "c1",
  promptVersion: "p1",
  researchVersion: "r1",
  researchModel: "m1",
  newerMaterial: false,
  now: NOW,
};

test("a screening stopped inside its research hands its tracks to the next try on the same terms", () => {
  assert.deepEqual(stoppedTracksToReuse(RUN, RUNNING_STEP, CURRENT), TRACKS);
  // A finished research is taken over whole instead (stoppedResearchToReuse).
  assert.deepEqual(stoppedTracksToReuse(RUN, { ...RUNNING_STEP, status: "complete" }, CURRENT), []);
  // Not after a real error, another setup, new material, a new research version, or a week.
  assert.deepEqual(stoppedTracksToReuse({ ...RUN, stop_reason: null }, RUNNING_STEP, CURRENT), []);
  assert.deepEqual(
    stoppedTracksToReuse({ ...RUN, config_version_id: "c2" }, RUNNING_STEP, CURRENT),
    [],
  );
  assert.deepEqual(
    stoppedTracksToReuse(RUN, RUNNING_STEP, { ...CURRENT, newerMaterial: true }),
    [],
  );
  assert.deepEqual(
    stoppedTracksToReuse(RUN, RUNNING_STEP, { ...CURRENT, researchVersion: "r2" }),
    [],
  );
  assert.deepEqual(
    stoppedTracksToReuse(RUN, RUNNING_STEP, { ...CURRENT, now: NOW + 8 * 24 * 3600 * 1000 }),
    [],
  );
});

test("the research keeps its finished tracks before it decides to stop, on every path", () => {
  const read = (file: string) => readFileSync(resolve("src/lib/analysis", file), "utf8");
  const research = read("public-research.ts");
  const kept = research.indexOf("input.researchTracks.onTracks(finished)");
  assert.ok(kept > 0);
  assert.ok(kept < research.indexOf("throw new BudgetLimitError(message);"));
  assert.match(
    research,
    /runResearchTracks\(\s*modules,\s*trackMode,\s*input\.researchTracks\?\.reuse,/,
  );
  // Screening, the deep worker and the local deep path all keep and take over the tracks.
  assert.match(read("screening.functions.ts"), /reuse: stoppedTracks,/);
  assert.match(
    read("screening.functions.ts"),
    /saveResearchTracksOnStep\(service, runId, "screening_research", tracks\)/,
  );
  assert.match(
    read("deep-worker.server.ts"),
    /loadReusableTracksForRun\(service, runId, context\.priorFailedRunId\)/,
  );
  assert.match(read("deep.functions.ts"), /reuse: reusableResearchTracks,/);
});

test("only usable answers are kept, so a bad answer is searched again instead of failing every retry", async () => {
  const gateway = stubGateway(() => 1);
  const attempts = await runResearchTracks(MODULES, "deep", null, gateway.search);
  const kept = finishedTracks(MODULES, "deep", attempts, (module) => module.id !== "team");
  assert.deepEqual(
    kept.map((track) => track.moduleId),
    ["identity", "market", "traction", "funding"],
  );
  const research = readFileSync(resolve("src/lib/analysis/public-research.ts"), "utf8");
  const filter = research.slice(research.indexOf("const finished = finishedTracks("));
  assert.match(filter.slice(0, 500), /researchOutputSchema\.parse[\s\S]*groundPacket\(/);
});

test("a deep run takes over kept tracks only from the same research and a recent stop", () => {
  const step = {
    model_name: "m1",
    prompt_version: "v1",
    output_json: {
      researchTracks: [
        { moduleId: "market", mode: "deep", content: "{}", groundedUrls: [] },
        { moduleId: "team", mode: "screening", content: "{}", groundedUrls: [] },
      ],
    },
  };
  const current = { model: "m1", version: "v1", now: NOW };
  const stopped = { stop_reason: "price_limit", completed_at: "2026-11-04T11:00:00Z" };
  assert.deepEqual(
    deepTracksToReuse(step, stopped, current).map((track) => track.moduleId),
    ["market"],
  );
  // A retry of the run's own phase needs no stop.
  assert.equal(deepTracksToReuse(step, null, current).length, 1);
  assert.deepEqual(deepTracksToReuse(step, stopped, { ...current, version: "v2" }), []);
  assert.deepEqual(deepTracksToReuse(step, stopped, { ...current, model: "m2" }), []);
  assert.deepEqual(deepTracksToReuse(step, { ...stopped, stop_reason: null }, current), []);
  assert.deepEqual(
    deepTracksToReuse(step, stopped, { ...current, now: NOW + 8 * 24 * 3600 * 1000 }),
    [],
  );
  assert.deepEqual(deepTracksToReuse(null, stopped, current), []);
});
