import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { failedScreeningCosts, refusedWithoutUsage } from "./gateway-response.ts";

/** A fund-fit call that answered but failed (cut off, over budget) is paid for. */
test("a paid but failed fund-fit call is booked on its step and on the run", () => {
  assert.deepEqual(
    failedScreeningCosts({
      failedStep: "fund_screening",
      incurredUsd: 0.12,
      incurredChargeUsd: 0.12,
      callCostUsd: 0.3,
    }),
    { runUsd: 0.12 + 0.3, stepUsd: 0.3, chargedUsd: 0.12 + 0.3 },
  );
  // An unknown research price does not hide the call's known price: the run's price is unknown,
  // and the settlement (0114) books the call through what the run charged.
  assert.deepEqual(
    failedScreeningCosts({
      failedStep: "fund_screening",
      incurredUsd: null,
      incurredChargeUsd: null,
      callCostUsd: 0.3,
    }),
    { runUsd: null, stepUsd: 0.3, chargedUsd: 0.3 },
  );
});

test("a failure without a paid call keeps the price as before", () => {
  assert.deepEqual(
    failedScreeningCosts({
      failedStep: "fund_screening",
      incurredUsd: 0.12,
      incurredChargeUsd: 0.12,
      callCostUsd: null,
    }),
    { runUsd: 0.12, stepUsd: null, chargedUsd: 0.12 },
  );
  assert.deepEqual(
    failedScreeningCosts({
      failedStep: "screening_research",
      incurredUsd: 0.05,
      incurredChargeUsd: null,
      callCostUsd: null,
    }),
    { runUsd: 0.05, stepUsd: 0.05, chargedUsd: 0.05 },
  );
});

/**
 * A run whose price is unknown keeps what it charged against its budget (known prices plus
 * the maximum for calls without one), so the settlement (0114) books that, not 0 kr.
 */
test("a failed screening with an unknown price keeps what it charged", () => {
  // The research's price is unknown (a reflection failed after it was sent); its charge is known.
  assert.deepEqual(
    failedScreeningCosts({
      failedStep: "fund_screening",
      incurredUsd: null,
      incurredChargeUsd: 0.09,
      callCostUsd: null,
    }),
    { runUsd: null, stepUsd: null, chargedUsd: 0.09 },
  );
  assert.deepEqual(
    failedScreeningCosts({
      failedStep: "fund_screening",
      incurredUsd: null,
      incurredChargeUsd: 0.09,
      callCostUsd: 0.2,
    }),
    // The run's price is unknown, so the research is not dropped: both go through the bound.
    { runUsd: null, stepUsd: 0.2, chargedUsd: 0.09 + 0.2 },
  );
  assert.deepEqual(
    failedScreeningCosts({
      failedStep: "screening_research",
      incurredUsd: null,
      incurredChargeUsd: 0.07,
      callCostUsd: null,
    }),
    { runUsd: null, stepUsd: null, chargedUsd: 0.07 },
  );
  // Nothing known: nothing to book (the settlement books 0 kr. for a failed run, as before).
  assert.deepEqual(
    failedScreeningCosts({
      failedStep: "screening_research",
      incurredUsd: null,
      incurredChargeUsd: null,
      callCostUsd: null,
    }),
    { runUsd: null, stepUsd: null, chargedUsd: null },
  );
});

test("both screening phases book what was paid when they fail (T-721, T-730)", () => {
  const source = readFileSync(new URL("./screening.functions.ts", import.meta.url), "utf8");
  const analysisSource = readFileSync(
    new URL("./screening-analysis.server.ts", import.meta.url),
    "utf8",
  );
  // The call's charge (the loft when the price is unknown) is kept once it has answered.
  assert.match(
    analysisSource,
    /screeningCallCostUsd = budgetCharge\(\s*completion\.actualCostUsd,\s*completion\.estimatedMaximumUsd,?\s*\)/,
  );
  const failure = analysisSource.slice(
    analysisSource.indexOf("export async function failScreeningRun("),
  );
  const block = failure.slice(0, failure.indexOf("console.error(`Screening"));
  assert.match(block, /incurredUsd: input\.incurredUsd,/);
  assert.match(
    block,
    /input\.callCostUsd\s*\?\?\s*\(input\.cause instanceof ScreeningGatewayError/,
  );
  assert.match(block, /incurredChargeUsd: input\.incurredChargeUsd,/);
  assert.match(block, /chargedUsd: costs\.chargedUsd,/);
  assert.match(block, /actual_cost: costs\.runUsd,/);
  assert.match(block, /actual_cost: costs\.stepUsd,/);
  assert.doesNotMatch(block, /actual_cost: incurredActualCostUsd/);
  // The research phase books the research, also when the hand-off to the analysis fails.
  const research = source.slice(source.indexOf("const executeScreening = async"));
  assert.match(
    research.slice(0, research.indexOf("waitUntil(")),
    /incurredUsd:\s*activeStepKey === "fund_screening"\s*\?\s*researchCostUsd[^,]*,[\s\S]{0,120}incurredChargeUsd:\s*incurredChargeUsd \?\?\s*\(cause instanceof ResearchFailedError \? cause\.chargeUsd : null\),/,
  );
  assert.match(research, /incurredChargeUsd = publicResearch\.budgetChargeUsd;/);
  assert.match(research, /incurredChargeUsd = researchChargeUsd;/);
  // The analysis phase books the research and the call it made.
  const analysis = analysisSource.slice(
    analysisSource.indexOf("export async function runScreeningAnalysisPhase("),
  );
  assert.match(analysis, /researchChargeUsd = research\.chargeUsd;/);
  assert.match(
    analysis,
    /incurredUsd: researchCostUsd \?\? stored\?\.actualUsd \?\? null,\s*incurredChargeUsd: researchChargeUsd \?\? stored\?\.chargeUsd \?\? null,\s*callCostUsd: screeningCallCostUsd,/,
  );
});

test("a released run keeps what its steps reported they paid (T-741 e)", async () => {
  const { stepRunCosts } = await import("./gateway-response.ts");
  const rows = (costs: Array<number | string | null>) =>
    costs.map((cost) => ({ actual_cost: cost, charged_cost: null }));
  // Steps saved before 0116 (no charge): the known prices, as before.
  assert.deepEqual(stepRunCosts(rows([0.12, null, "0.03"])), {
    actualUsd: 0.15,
    chargedUsd: 0.15,
    everyStepKnown: false,
  });
  assert.deepEqual(stepRunCosts(rows([null, null])), {
    actualUsd: null,
    chargedUsd: null,
    everyStepKnown: false,
  });
  assert.deepEqual(stepRunCosts([]), { actualUsd: null, chargedUsd: null, everyStepKnown: true });
});

test("a step that charged without a price leaves the run's price unknown (T-784)", async () => {
  const { stepRunCosts } = await import("./gateway-response.ts");
  // Research known, a specialist timed out (its maximum), the synthesis never ran.
  const costs = stepRunCosts([
    { actual_cost: 0.4, charged_cost: 0.4 },
    { actual_cost: null, charged_cost: 0.55 },
    { actual_cost: null, charged_cost: null },
  ]);
  assert.equal(costs.actualUsd, null);
  assert.ok(Math.abs((costs.chargedUsd ?? 0) - 0.95) < 1e-9);
  assert.equal(costs.everyStepKnown, false);
  // The research lost a price (a failed reflection), but its charge is known: booked to that.
  assert.deepEqual(stepRunCosts([{ actual_cost: null, charged_cost: "0.247" }]), {
    actualUsd: null,
    chargedUsd: 0.247,
    everyStepKnown: true,
  });
  // A step that charged nothing (skipped sheet, reused specialist) hides no price.
  assert.deepEqual(
    stepRunCosts([
      { actual_cost: 0.3, charged_cost: 0.3 },
      { actual_cost: null, charged_cost: 0 },
    ]),
    { actualUsd: 0.3, chargedUsd: 0.3, everyStepKnown: true },
  );
  // A charge that is not a non-negative number counts as no charge.
  assert.deepEqual(stepRunCosts([{ actual_cost: 0.2, charged_cost: -1 }]), {
    actualUsd: 0.2,
    chargedUsd: 0.2,
    everyStepKnown: true,
  });
});

test("every deep step saves its charge, and the run books the sum (T-784)", () => {
  const worker = readFileSync(new URL("./deep-worker.server.ts", import.meta.url), "utf8");
  const deep = readFileSync(new URL("./deep.functions.ts", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("./evidence-sheet.server.ts", import.meta.url), "utf8");
  const release = readFileSync(new URL("./run-release.server.ts", import.meta.url), "utf8");
  // Research, reused and answered specialists, a failed specialist, the synthesis, the sheet.
  assert.match(
    worker,
    /actual_cost: research\.actualCostUsd,\s*charged_cost: research\.budgetChargeUsd,/,
  );
  assert.match(worker, /actual_cost: 0,\s*charged_cost: 0,\s*output_json: packet,/);
  assert.match(
    worker,
    /charged_cost: budgetCharge\(completion\.actualCostUsd, completion\.estimatedMaximumUsd\),\s*output_json: packet,/,
  );
  assert.match(
    worker,
    /const chargedUsd = failedStepChargeUsd\(cause, completion\);[\s\S]{0,400}charged_cost: chargedUsd/,
  );
  assert.match(worker, /charged_cost: chargedSynthesis,\s*output_json: output,/);
  assert.match(sheet, /charged_cost: outcome\.chargeUsd,/);
  // The run's error handling saves the failed step's charge (research or synthesis).
  assert.match(worker, /failedStepChargeUsd\(cause, completion\),\s*\);/);
  assert.match(
    worker,
    /\.\.\.\(stepChargeUsd === null \? \{\} : \{ charged_cost: stepChargeUsd \}\),/,
  );
  // Completion, failure and release write the sum where the settlement (0114) reads it.
  const persist = worker.slice(worker.indexOf("async function persistDeepAnalysis("));
  assert.match(
    persist,
    /const chargedUsd = stepCosts\.everyStepKnown \? stepCosts\.chargedUsd : null;/,
  );
  assert.match(
    persist,
    /customCap: context\.plan\.customCap,\s*chargedUsd,\s*actualUsd: totalCostUsd,/,
  );
  const fail = worker.slice(worker.indexOf("async function failDeepRun("));
  assert.match(fail, /const costs = stepRunCosts\(rows\);/);
  assert.match(fail, /actual_cost: costs\.actualUsd,/);
  assert.match(fail, /chargedUsd: costs\.chargedUsd,\s*actualUsd: costs\.actualUsd,/);
  assert.match(
    release,
    /select\("actual_cost, charged_cost, input_tokens, output_tokens, total_tokens"\)/,
  );
  assert.match(release, /actual_cost: costs\.actualUsd,/);
  assert.match(release, /chargedUsd: costs\.chargedUsd,/);
  // A failed step: the research's charge, else the call's (failedCallChargeUsd, tested below).
  const helper = deep.slice(deep.indexOf("export function failedStepChargeUsd("));
  assert.match(
    helper.slice(0, helper.indexOf("\n}\n")),
    /cause instanceof ResearchFailedError\) return cause\.chargeUsd;\s*return failedCallChargeUsd\(\s*completion,\s*cause instanceof DeepGatewayError \? cause\.callChargeUsd : null,?\s*\);/,
  );
  // A timed-out call carries its maximum; a call the gateway refused without usage charges 0.
  assert.match(deep, /maxOutputTokens: maxTokens,\s*\},\s*estimatedMaximumUsd\.maxCostUsd,\s*\);/);
  assert.match(deep, /const refused =\s*!response\.ok &&[\s\S]{0,700}refused \? 0 : null,/);
  // A failure after the deep research returned (basis, saving the step) carries its charge.
  assert.match(
    worker,
    /if \(reusable \|\| cause instanceof ResearchFailedError\) throw cause;\s*throw new ResearchFailedError\(cause, research\.budgetChargeUsd\);/,
  );
  assert.match(worker, /if \(stepSave\.error\) \{/);
});

test("a failed call is charged its price, else its maximum (T-784)", async () => {
  const { failedCallChargeUsd } = await import("./gateway-response.ts");
  const answered = (actualCostUsd: number | null) => ({
    actualCostUsd,
    estimatedMaximumUsd: { maxCostUsd: 0.5 },
  });
  assert.equal(failedCallChargeUsd(answered(0.12), null), 0.12);
  // Cut off without a price: its maximum.
  assert.equal(failedCallChargeUsd(answered(null), null), 0.5);
  // The error decides: a timeout carries the maximum, a refused call 0.
  assert.equal(failedCallChargeUsd(null, 0.5), 0.5);
  assert.equal(failedCallChargeUsd(answered(null), 0), 0);
  // Nothing sent, nothing known.
  assert.equal(failedCallChargeUsd(null, null), null);
});

test("work that charged before it failed throws its charge (T-784)", async () => {
  const { chargedOnFailure, ResearchFailedError } = await import("./gateway-response.ts");
  assert.equal(await chargedOnFailure(async () => "done"), "done");
  const original = new Error("Only 2 of 5 tracks answered.");
  await assert.rejects(
    chargedOnFailure(async (spent) => {
      spent.usd = 0.31;
      throw original;
    }),
    (error: unknown) => {
      assert.ok(error instanceof ResearchFailedError);
      assert.equal(error.chargeUsd, 0.31);
      assert.equal(error.message, original.message);
      assert.equal(error.cause, original);
      return true;
    },
  );
  // Nothing charged: the original error, unchanged.
  await assert.rejects(
    chargedOnFailure(async () => {
      throw original;
    }),
    (error: unknown) => error === original,
  );
});

test("a released run books what its steps charged and keeps its other fields (T-784)", async () => {
  const { releaseStalledRun } = await import("./run-release.server.ts");
  type Row = Record<string, unknown>;
  const run = async (steps: Row[], validation: Row | null) => {
    const updates: Array<{ table: string; values: Row }> = [];
    const query = (table: string) => {
      let values: Row | null = null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        update: (next: Row) => {
          values = next;
          updates.push({ table, values: next });
          return chain;
        },
        maybeSingle: async () =>
          table === "analysis_runs" && !values
            ? { data: { validation_result: validation }, error: null }
            : { data: { id: "run" }, error: null },
        then: (resolve: (value: unknown) => void) =>
          resolve(
            table === "analysis_run_steps" && !values
              ? { data: steps, error: null }
              : { data: null, error: null },
          ),
      };
      return chain;
    };
    const service = { from: query } as unknown as Parameters<typeof releaseStalledRun>[0];
    const released = await releaseStalledRun(service, {
      fundId: "fund",
      runId: "run",
      message: "released",
      logTag: "test",
    });
    assert.equal(released, true);
    return updates.find((update) => update.table === "analysis_runs")!.values;
  };
  // Research known, a specialist without a price but with its maximum: price unknown, charge kept.
  const charged = await run(
    [
      { actual_cost: 0.4, charged_cost: 0.4, input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      { actual_cost: null, charged_cost: 0.55, input_tokens: null, output_tokens: null },
    ],
    { aiTier: "middel", budget: { dkk: 35, usd: 5.4 } },
  );
  assert.equal(charged["actual_cost"], null);
  assert.deepEqual(charged["validation_result"], {
    aiTier: "middel",
    ok: false,
    costCurrency: "USD",
    budget: { dkk: 35, usd: 5.4, chargedUsd: 0.4 + 0.55, actualUsd: null },
  });
  // Steps from before 0116 without any price: nothing to book, the run's fields are left alone.
  const unknown = await run([{ actual_cost: null, charged_cost: null }], { aiTier: "middel" });
  assert.equal(unknown["actual_cost"], null);
  assert.equal("validation_result" in unknown, false);
});

test("a research that fails after paid calls carries what they charged (T-784)", () => {
  const source = readFileSync(new URL("./public-research.ts", import.meta.url), "utf8");
  const wrapper = source.slice(
    source.indexOf("export async function collectPublicCompanyResearch("),
  );
  assert.match(
    wrapper.slice(0, wrapper.indexOf("\n}\n")),
    /return chargedOnFailure\(\(spent\) => researchPublicCompany\(input, spent\)\);/,
  );
  // A call stopped by the data rules before it was sent charges nothing.
  assert.match(
    source,
    /if \(cause instanceof AiDataPolicyError\) throw cause;\s*throw new ResearchCallError\(cause, estimatedMaximumUsd\.maxCostUsd\);/,
  );
  // One running charge, so a failure after the follow-up rounds carries them too.
  assert.doesNotMatch(source, /chargedResearchUsd/);
  assert.match(source, /spent\.usd = extractionChargeUsd;/);
  assert.match(source, /budgetChargeUsd: spent\.usd,/);
  // A first-round track that failed after it was sent is charged its maximum and makes the
  // price unknown, as the follow-up rounds do.
  assert.match(source, /if \(attempt\.reason\.chargeUsd > 0\) unpricedSearches\.push\(null\);/);
  assert.match(source, /\.\.\.reflectionCosts,\s*\.\.\.unpricedSearches,/);
});

test("the analysis's model calls never retry unpaid (T-749 c)", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of [
    "public-research.ts",
    "research-followup.server.ts",
    "evidence-sheet.server.ts",
    "research-plan.server.ts",
    "identity-extraction.ts",
    "deck-ocr.ts",
    "search-topics.server.ts",
    "question-neutralizer.server.ts",
  ]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    const calls = source.split("await generateText({").slice(1);
    assert.ok(calls.length > 0, file);
    for (const call of calls) assert.match(call.slice(0, 200), /maxRetries: 0,/, file);
  }
});

/** A fund-fit call that timed out, answered empty or not as JSON is paid for. */
test("only a refusal without any usage is free; every other failed call is charged", () => {
  assert.equal(refusedWithoutUsage({ ok: false, actualCostUsd: null }), true);
  assert.equal(refusedWithoutUsage({ ok: false, actualCostUsd: null, usage: {} }), true);
  // An error status that still reports usage, and an empty 200 answer, were billed.
  assert.equal(
    refusedWithoutUsage({ ok: false, actualCostUsd: null, usage: { prompt_tokens: 900 } }),
    false,
  );
  assert.equal(refusedWithoutUsage({ ok: true, actualCostUsd: null }), false);
  assert.equal(refusedWithoutUsage({ ok: false, actualCostUsd: 0.01 }), false);

  const source = readFileSync(new URL("./screening.functions.ts", import.meta.url), "utf8");
  const call = source.slice(source.indexOf("export async function callGateway("));
  // A timeout, a network failure or an answer that is not JSON costs the call's maximum.
  assert.match(
    call,
    /catch \(cause\) \{[\s\S]*?throw new ScreeningGatewayError\([\s\S]*?estimate\.maxCostUsd,/,
  );
  // The cut-off check comes before the empty check: a cut-off answer can be empty.
  assert.ok(
    call.indexOf('finish_reason === "length"') <
      call.indexOf("!response.ok || !body.choices?.[0]?.message?.content"),
  );
});

/** The deep analysis reads its answer apart from the call, as the screening. */
test("a deep call's error page without JSON is free, a 200 without JSON costs its maximum", () => {
  const source = readFileSync(new URL("./deep.functions.ts", import.meta.url), "utf8");
  const call = source.slice(source.indexOf("export async function callDeepGateway("));
  const fetchTry = call.slice(call.indexOf("response = await postChatCompletion("));
  // The JSON is not parsed inside the call's own try, so a parse failure is never a timeout.
  assert.ok(
    fetchTry.indexOf("} catch (cause) {") < fetchTry.indexOf("await response.json()"),
    "response.json() has its own try",
  );
  assert.match(
    call,
    /await response\.json\(\)[\s\S]*?\} catch \{[\s\S]*?response\.ok \? estimatedMaximumUsd\.maxCostUsd : 0,/,
  );
});
