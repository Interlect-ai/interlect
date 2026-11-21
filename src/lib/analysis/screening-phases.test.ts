/** The screening's two phases, the pure part of the hand-off. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readPromptFounders,
  readResearchHandOff,
  SCREENING_ANALYSIS_STALE_MS,
  screeningClaimDecision,
} from "./screening-phases.ts";
import { FUNCTION_MAX_DURATION_SECONDS } from "./deep-text-rules.ts";
import { EVIDENCE_SHEET_VERSION } from "./evidence-sheet.ts";

test("the analysis phase claims a queued step and never a live one", () => {
  const now = Date.parse("2026-10-09T10:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(
    screeningClaimDecision({ status: "queued", startedAt: null, attemptCount: 0 }, now),
    "claim",
  );
  // A second delivery while the first function still runs waits for the queue to come back.
  assert.equal(
    screeningClaimDecision({ status: "running", startedAt: ago(60_000), attemptCount: 1 }, now),
    "busy",
  );
  assert.equal(
    screeningClaimDecision(
      { status: "running", startedAt: ago(SCREENING_ANALYSIS_STALE_MS), attemptCount: 1 },
      now,
    ),
    "busy",
  );
  // After a crash no function can still have it: the next delivery takes over.
  assert.equal(
    screeningClaimDecision(
      { status: "running", startedAt: ago(SCREENING_ANALYSIS_STALE_MS + 1), attemptCount: 1 },
      now,
    ),
    "take_over",
  );
  assert.equal(
    screeningClaimDecision({ status: "running", startedAt: null, attemptCount: 1 }, now),
    "take_over",
  );
  for (const status of ["complete", "failed", "skipped", "cancelled"]) {
    assert.equal(
      screeningClaimDecision({ status, startedAt: ago(1), attemptCount: 1 }, now),
      "done",
    );
  }
  assert.equal(screeningClaimDecision(null, now), "done");
  // A crash loop does not pay again and again: after MAX_STEP_ATTEMPTS starts the run fails.
  assert.equal(
    screeningClaimDecision(
      { status: "running", startedAt: ago(SCREENING_ANALYSIS_STALE_MS + 1), attemptCount: 2 },
      now,
    ),
    "exhausted",
  );
  assert.equal(
    screeningClaimDecision({ status: "running", startedAt: ago(1_000), attemptCount: 2 }, now),
    "busy",
  );
  // A function lives at most FUNCTION_MAX_DURATION_SECONDS: the takeover never meets a live one.
  assert.ok(SCREENING_ANALYSIS_STALE_MS > FUNCTION_MAX_DURATION_SECONDS * 1_000);
});

test("the hand-off reads the research step and never counts an unknown charge as 0", () => {
  const sheet = {
    version: EVIDENCE_SHEET_VERSION,
    model: "openai/gpt-5.4-mini",
    items: [],
    citedEvidenceIds: [],
    droppedFacts: 0,
    brainText: "",
  };
  const handOff = readResearchHandOff(
    {
      output_json: {
        researchChargeUsd: 0.081,
        promptFounders: [
          { name: "Jeppe Rindom", role: "CEO", linkedinUrl: null },
          { name: "  ", role: "CTO" },
          { role: "uden navn" },
          "tekst",
        ],
        evidenceSheet: sheet,
        researchFollowUp: null,
        setupStage: { stage: "seed", caseStage: null, reason: "unknown", assumed: true },
      },
      actual_cost: "0.0712",
      input_tokens: 1200,
      output_tokens: null,
      total_tokens: 1500,
    },
    0.39,
  );
  assert.equal(handOff.chargeUsd, 0.081);
  assert.equal(handOff.actualCostUsd, 0.0712);
  assert.equal(handOff.outputTokens, null);
  assert.deepEqual(handOff.founders, [{ name: "Jeppe Rindom", role: "CEO", linkedinUrl: null }]);
  assert.equal(handOff.evidenceSheet?.version, EVIDENCE_SHEET_VERSION);
  assert.equal(handOff.followUp, null);
  // The stage the research was planned for, which the analysis phase scores.
  assert.deepEqual(handOff.setupStage, {
    stage: "seed",
    caseStage: null,
    reason: "unknown",
    assumed: true,
  });
  // Without a saved charge (or a broken one) the whole research budget counts.
  for (const charge of [undefined, null, "x", -1]) {
    const missing = readResearchHandOff(
      {
        output_json: { researchChargeUsd: charge },
        actual_cost: null,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
      },
      0.39,
    );
    assert.equal(missing.chargeUsd, 0.39, String(charge));
    assert.equal(missing.actualCostUsd, null);
    assert.equal(missing.setupStage, null);
  }
  assert.deepEqual(readPromptFounders(undefined), []);
});

test("the research phase saves what the analysis phase reads, and fails loudly if it cannot", () => {
  const source = readFileSync(new URL("./screening.functions.ts", import.meta.url), "utf8");
  const research = source.slice(source.indexOf("const executeScreening = async"));
  const phase = research.slice(0, research.indexOf("waitUntil("));
  // The fields readResearchHandOff reads are written on the research step.
  assert.match(phase, /researchChargeUsd,/);
  assert.match(phase, /promptFounders:/);
  assert.match(phase, /evidenceSheet,/);
  assert.match(phase, /setupStage: profile\.teamSetup\?\.stage \?\? null,/);
  // A failed save is not logged and ignored: the analysis would get a thinner basis silently.
  assert.match(phase, /if \(sheetSaveError\) \{[\s\S]*?throw new Error/);
  assert.match(phase, /if \(evidenceIdsSaved\.error\)[\s\S]*?throw new Error/);
  assert.match(phase, /if \(runStarted\.error\) throw new Error/);
  assert.match(phase, /if \(researchSaveError\)\s*throw new Error/);
  // The research phase hands over instead of calling the analysis itself.
  assert.match(phase, /await dispatchScreeningAnalysis\(runId\)/);
  assert.doesNotMatch(phase, /callGateway\(/);
  const analysisSource = readFileSync(
    new URL("./screening-analysis.server.ts", import.meta.url),
    "utf8",
  );
  const analysis = analysisSource.slice(
    analysisSource.indexOf("export async function runScreeningAnalysisPhase("),
  );
  assert.match(analysis, /readResearchHandOff\(/);
  // The result never brings a released run back, and an early failure still books the research.
  assert.match(analysis, /\.eq\("status", "running"\)\s*\.select\("id"\)/);
  assert.match(
    analysis,
    /await storedResearchCosts\(service, runId\)[\s\S]*?incurredUsd: researchCostUsd \?\? stored\?\.actualUsd/,
  );
  assert.match(
    analysis,
    /if \(claim === "exhausted"\) \{[\s\S]*?failScreeningRun[\s\S]*?enqueueBrainCapture/,
  );
  assert.match(analysis, /await enqueueBrainCapture\(fundId, caseId\)/);
});

test("the queue consumer and the config know the screening topic", () => {
  const config = readFileSync(new URL("../../../nitro.config.ts", import.meta.url), "utf8");
  assert.match(config, /"\.\/server\/plugins\/screening-queue\.ts"/);
  assert.match(config, /topic: "interlect-screening"/);
  const queue = readFileSync(new URL("./screening-queue.server.ts", import.meta.url), "utf8");
  assert.match(queue, /SCREENING_QUEUE_TOPIC = "interlect-screening"/);
  const plugin = readFileSync(
    new URL("../../../server/plugins/screening-queue.ts", import.meta.url),
    "utf8",
  );
  assert.match(plugin, /runScreeningAnalysisPhase\(payload\.runId\)/);
  assert.match(plugin, /from "\.\.\/\.\.\/src\/lib\/analysis\/screening-analysis\.server"/);
  // Server only: the client bundle imports screening.functions.ts, never the analysis phase.
  const functions = readFileSync(new URL("./screening.functions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(functions, /export async function runScreeningAnalysisPhase/);
  // A busy step is thrown back so the queue delivers again (never acknowledged and lost).
  assert.match(plugin, /if \(result === "busy"\) \{\s*throw new Error/);
});
