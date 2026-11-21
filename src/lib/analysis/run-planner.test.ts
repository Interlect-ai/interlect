/**
 * (spor B3, spec B.1 and B.4 test 1): the planner keeps a run inside its limit for every
 * limit, the order is the same every time, and under the bottom for the level the answer is "do not
 * start". Pure: no model calls, no database.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestMaximumUsd } from "./budgets.ts";
import {
  AI_TIERS,
  buildRunPlan,
  lowestCapDkk,
  researchCovers,
  standardCapDkk,
} from "./model-tiers.ts";
import {
  MANDATORY_TRACK_COUNT,
  minSuccessfulTracks,
  STEP_LIMITS_USD,
  TRACK_MAX_OUTPUT_TOKENS,
  TRACK_MODELS,
  TRACK_PRIORITY,
} from "./run-planner.ts";

const KINDS = ["screening", "deep"] as const;
const RATES = [6.46, 6.9, 7.5];
const read = (file: string) => readFileSync(resolve("src/lib/analysis", file), "utf8");
/** The research and the deck reading import the app's aliases, so they are read as text here. */
const numberIn = (file: string, name: string) => {
  const match = new RegExp(`const ${name}\\b[^=]*= ([0-9.]+);`).exec(read(file));
  assert.ok(match, `${name} in ${file}`);
  return Number(match[1]);
};
const stringIn = (file: string, name: string) => {
  const match = new RegExp(`const ${name} = "([^"]+)";`).exec(read(file));
  assert.ok(match, `${name} in ${file}`);
  return match[1];
};
const trackIdsIn = (name: string) => {
  const source = read("public-research.ts");
  const start = source.indexOf(`export const ${name} = [`);
  assert.ok(start >= 0, name);
  const list = source.slice(start, source.indexOf("] as const", start));
  return [...list.matchAll(/^ {4}id: "([a-z_]+)",$/gm)].map((match) => match[1]);
};

test("grænse-sweep: the most a run can cost never passes the limit, at any limit from 1 to 100", () => {
  for (const kind of KINDS) {
    for (const tier of AI_TIERS) {
      for (const specialists of [1, 4, 7]) {
        for (const rate of RATES) {
          for (let cap = kind === "deep" ? 5 : 1; cap <= 100; cap += 1) {
            const { scope, budget } = buildRunPlan(kind, tier, cap, specialists, rate);
            if (scope.status === "too_low") continue;
            assert.ok(scope.maxUsd * rate <= cap, `${kind} ${tier} ${cap} kr. at ${rate}`);
            assert.ok(scope.maxUsd <= budget.usd);
            const parts =
              kind === "deep"
                ? budget.researchUsd + budget.specialistsUsd + budget.synthesisUsd
                : budget.researchUsd + budget.analysisUsd;
            assert.ok(parts <= budget.usd + 1e-9, `${kind} ${tier} ${cap}: parts ${parts}`);
          }
        }
      }
    }
  }
});

test("under the bottom the answer is do not start; from the bottom a run can run", () => {
  for (const kind of KINDS) {
    for (const tier of AI_TIERS) {
      for (const rate of RATES) {
        const lowest = lowestCapDkk(kind, tier, 4, rate);
        assert.notEqual(buildRunPlan(kind, tier, lowest, 4, rate).scope.status, "too_low");
        const below = lowest - 1;
        if (below >= (kind === "deep" ? 5 : 1)) {
          assert.equal(buildRunPlan(kind, tier, below, 4, rate).scope.status, "too_low");
        }
      }
    }
  }
});

test("the bottoms on Middel, at the installation's rate: 3 kr. and 17 kr.", () => {
  assert.equal(lowestCapDkk("screening", "medium", 4, 6.9), 3);
  assert.equal(lowestCapDkk("deep", "medium", 4, 6.9), 17);
  // More specialists need more room.
  assert.ok(lowestCapDkk("deep", "medium", 7, 6.9) > 17);
});

test("the standard limit of every level runs everything, on the shares it always had", () => {
  for (const kind of KINDS) {
    for (const tier of AI_TIERS) {
      for (const rate of RATES) {
        const plan = buildRunPlan(kind, tier, null, 4, rate);
        assert.equal(plan.budget.dkk, standardCapDkk(kind, tier));
        assert.equal(plan.scope.status, "full", `${kind} ${tier} at ${rate}`);
        assert.equal(plan.scope.tracks.length, TRACK_PRIORITY[kind].length);
        assert.equal(plan.scope.researchPlan && plan.scope.evidenceSheet, true);
      }
    }
  }
  // The table is unchanged at the rate it was worked out at.
  const table = buildRunPlan("deep", "medium", null).budget;
  assert.deepEqual(table, {
    dkk: 35,
    usd: 5.4,
    researchUsd: 1.9,
    analysisUsd: 3.5,
    specialistsUsd: 2.75,
    synthesisUsd: 0.75,
  });
  // The old thresholds hold for a full run.
  assert.equal(buildRunPlan("screening", "medium", null).scope.minSuccessfulTracks, 4);
  assert.equal(buildRunPlan("deep", "medium", null).scope.minSuccessfulTracks, 6);
});

test("the order is fixed: the same limit gives the same plan, and more money never fewer tracks", () => {
  for (const kind of KINDS) {
    for (const tier of AI_TIERS) {
      let previous = 0;
      const lowest = lowestCapDkk(kind, tier, 4, 6.9);
      for (let cap = lowest; cap <= 100; cap += 1) {
        const plan = buildRunPlan(kind, tier, cap, 4, 6.9);
        assert.deepEqual(plan, buildRunPlan(kind, tier, cap, 4, 6.9));
        const count = plan.scope.tracks.length;
        assert.ok(count >= previous, `${kind} ${tier} ${cap}: ${count} after ${previous}`);
        previous = count;
        // The kept tracks are always the first ones of the list, so the mandatory ones are kept.
        assert.deepEqual(plan.scope.tracks, TRACK_PRIORITY[kind].slice(0, count));
        assert.ok(count >= MANDATORY_TRACK_COUNT[kind]);
      }
    }
  }
});

test("the demands follow the chosen set: three quarters of the tracks must succeed", () => {
  const smallest = buildRunPlan("screening", "medium", 3, 4, 6.9).scope;
  assert.equal(smallest.status, "reduced");
  assert.equal(smallest.tracks.length, 3);
  // One track may fail even here: before the cut, 4 of 5 tolerated one failure too.
  assert.equal(smallest.minSuccessfulTracks, 2);
  assert.equal(smallest.researchPlan, false);
  assert.equal(smallest.evidenceSheet, false);
  const deep = buildRunPlan("deep", "medium", 17, 4, 6.9).scope;
  assert.equal(deep.status, "reduced");
  assert.ok(deep.tracks.length >= 5);
  assert.equal(deep.minSuccessfulTracks, minSuccessfulTracks(deep.tracks.length));
  assert.ok(deep.minSuccessfulTracks < deep.tracks.length);
});

test("every planned set tolerates one failed track, and full runs keep 4 of 5 and 6 of 8 (T-1077)", () => {
  assert.deepEqual([3, 4, 5, 6, 7, 8].map(minSuccessfulTracks), [2, 3, 4, 5, 6, 6]);
  for (const kind of KINDS) {
    for (const tier of AI_TIERS) {
      for (let cap = lowestCapDkk(kind, tier, 4, 6.9); cap <= 100; cap += 1) {
        const scope = buildRunPlan(kind, tier, cap, 4, 6.9).scope;
        assert.ok(
          scope.minSuccessfulTracks <= scope.tracks.length - 1,
          `${kind} ${tier} ${cap}: ${scope.minSuccessfulTracks} of ${scope.tracks.length}`,
        );
      }
    }
  }
});

test("a reduced run has room for every call it keeps, each at its worst case", () => {
  for (const kind of KINDS) {
    for (const tier of AI_TIERS) {
      const lowest = lowestCapDkk(kind, tier, 4, 6.9);
      for (let cap = lowest; cap <= lowest + 25; cap += 1) {
        const { scope, budget } = buildRunPlan(kind, tier, cap, 4, 6.9);
        const steps = STEP_LIMITS_USD[kind];
        const overhead =
          steps.identity +
          (scope.researchPlan ? steps.researchPlan : 0) +
          (scope.evidenceSheet ? steps.evidenceSheet : 0) +
          (scope.searchQuestions ? steps.searchQuestions : 0) +
          (scope.deckOcr ? steps.deckOcr : 0);
        const perTrack = (budget.researchUsd - overhead) / scope.tracks.length;
        // 3,000 assumed tokens leave room above the 1,650 a track's real prompt and schema measure.
        const worst = requestMaximumUsd(TRACK_MODELS[kind], 3_000, TRACK_MAX_OUTPUT_TOKENS[kind]);
        assert.ok(worst <= perTrack + 1e-9, `${kind} ${tier} ${cap}: ${worst} > ${perTrack}`);
      }
    }
  }
});

test("the planner's lists and limits are the ones the steps really use", () => {
  assert.deepEqual(
    [...TRACK_PRIORITY.screening].sort(),
    trackIdsIn("screeningResearchModules").sort(),
  );
  assert.deepEqual([...TRACK_PRIORITY.deep].sort(), trackIdsIn("researchModules").sort());
  assert.equal(
    TRACK_MODELS.screening,
    stringIn("public-research.ts", "SCREENING_PUBLIC_RESEARCH_MODEL"),
  );
  assert.equal(TRACK_MODELS.deep, stringIn("public-research.ts", "PUBLIC_RESEARCH_MODEL"));
  const identity = numberIn("public-research.ts", "IDENTITY_EXTRACTION_BUDGET_USD");
  const topics = numberIn("public-research.ts", "SEARCH_TOPICS_BUDGET_USD");
  const neutral = numberIn("question-neutralizer.ts", "NEUTRALIZER_BUDGET_USD");
  for (const kind of KINDS) {
    const steps = STEP_LIMITS_USD[kind];
    assert.equal(steps.identity, identity);
    assert.ok(Math.abs(steps.searchQuestions - (topics + neutral)) < 1e-9);
    assert.match(
      read("research-plan.ts"),
      new RegExp(`PLAN_BUDGET_USD[^=]*= \\{[^}]*${kind}: ${steps.researchPlan}\\b`),
    );
    assert.match(
      read("evidence-sheet.ts"),
      new RegExp(`EVIDENCE_SHEET_BUDGET_USD[^=]*= \\{[^}]*${kind}: ${steps.evidenceSheet}\\b`),
    );
  }
  assert.equal(STEP_LIMITS_USD.screening.deckOcr, numberIn("deck-ocr.ts", "DECK_OCR_BUDGET_USD"));
  // The worst cases count the same outputs as the calls ask for.
  assert.match(read("public-research.ts"), /TRACK_MAX_OUTPUT_TOKENS\[/);
  assert.match(read("screening.functions.ts"), /maxOutputTokens = SCREENING_MAX_OUTPUT_TOKENS;/);
});

test("both paths run what the planner kept, and the old fixed demand is gone", () => {
  for (const file of ["screening.functions.ts", "deep-worker.server.ts", "deep.functions.ts"]) {
    assert.match(read(file), /scope: (context\.)?plan\.scope,/, file);
    // The deep runners take the sheet's share from the run's shares (`deepRunShares`).
    assert.match(
      read(file),
      file === "screening.functions.ts"
        ? /plan\.scope\.evidenceSheet/
        : /availableUsd: (context\.)?shares\.evidenceSheetUsd/,
      file,
    );
    // The setup always reaches the research: the check of the fund's questions compares against it.
    assert.match(read(file), /\n\s+researchPlan: \{\n\s+tier: (context\.)?plan\.tier,/, file);
    assert.doesNotMatch(read(file), /\.\.\.\((context\.)?plan\.scope\.researchPlan/, file);
  }
  assert.match(
    read("run-continuation.ts"),
    /plan\.scope\.evidenceSheet \? EVIDENCE_SHEET_BUDGET_USD\.deep : 0/,
  );
  const research = read("public-research.ts");
  assert.match(research, /input\.scope\?\.minSuccessfulTracks \?\?/);
  assert.match(research, /input\.scope\?\.tracks\.includes\(module\.id\)/);
  assert.match(research, /input\.scope\?\.researchPlan !== false/);
  // Confidential texts reach the check of the fund's questions, also when the paid plan is left out.
  assert.match(research, /confidential: input\.researchPlan\s*\? confidentialFundTexts\(/);
  // A new run goes through the planner; nothing is reserved before its answer, and the run uses
  // the plan the month had room for.
  for (const file of ["screening.functions.ts", "deep.functions.ts"]) {
    const source = read(file);
    assert.ok(source.indexOf("planNewRun(") < source.indexOf("reservePlannedRun(service"));
    assert.match(source, /if \(!planned\) return \{ runId: null, status: "limit_choice_needed"/);
    assert.match(source, /const \{ plan, ledgerId: creditLedgerId \} = await reservePlannedRun\(/);
    assert.doesNotMatch(source, /reserveAnalysisCredits\(/);
  }
});

test("a smaller run's research is not reused for a run that would search more", () => {
  const small = buildRunPlan("deep", "medium", 17, 4, 6.9).scope;
  const full = buildRunPlan("deep", "medium", null, 4, 6.9).scope;
  assert.ok(small.tracks.length < full.tracks.length);
  assert.equal(researchCovers(small, full), false);
  assert.equal(researchCovers(full, small), true);
  assert.equal(researchCovers(full, full), true);
  assert.match(
    read("deep-worker.server.ts"),
    /researchCovers\(\s*planFromStoredRun\("deep", priorFailed/,
  );
  assert.match(
    read("deep.functions.ts"),
    /researchCovers\(\s*planFromStoredRun\("deep", latestFailedDeep/,
  );
});

test("the case page asks the team first, instead of treating it as started (T-1004)", () => {
  const page = readFileSync(resolve("src/routes/cases.$caseId.tsx"), "utf8");
  // Both starts (screening and deep analysis) go through the choice; a cancel starts nothing.
  assert.equal(page.match(/startWithLimitChoice\(fundId!, "(screening|deep)"/g)?.length, 2);
  const store = readFileSync(resolve("src/lib/analysis/limit-choice.ts"), "utf8");
  assert.match(store, /first\.status !== "limit_choice_needed"/);
});
