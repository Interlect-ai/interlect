import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planColumns, planFromStoredRun } from "./model-tiers.ts";
import {
  loadFundAiSettings,
  loadFundRunPlans,
  loadRunPlan,
  planNewRun,
  reservePlannedRun,
} from "./run-plan.server.ts";
import { MonthlyLimitError } from "../ai/credits.server.ts";

const PLATFORM_ROW = {
  usd_to_dkk: 6.46,
  platform_screening_cap_dkk: 100,
  platform_deep_cap_dkk: 500,
  platform_monthly_cap_dkk: 10000,
};

function fakeClient(
  result: { data: unknown; error: { code?: string; message: string } | null },
  platform: Record<string, unknown> | null = PLATFORM_ROW,
  month: { cap_dkk: number | null; used_dkk: number } = { cap_dkk: null, used_dkk: 0 },
) {
  const builder = (answer: unknown) => {
    const self = {
      select: () => self,
      eq: () => self,
      in: () => self,
      // The team's open runs (releaseStalledFundRuns): none stand still here.
      lt: async () => ({ data: [], error: null }),
      maybeSingle: async () => answer,
    };
    return self;
  };
  return {
    rpc: async () => ({ data: [month], error: null }),
    from: (table: string) =>
      table === "ai_settings" ? builder({ data: platform, error: null }) : builder(result),
  } as unknown as SupabaseClient;
}

test("the fund's tier, model and confirmed cap make the plan", async () => {
  const client = fakeClient({
    data: {
      screening_tier: "heavy",
      deep_tier: "light",
      screening_cap_dkk: 12,
      deep_cap_dkk: null,
    },
    error: null,
  });
  const screening = await loadRunPlan(client, "f", "screening");
  assert.equal(screening.tier, "heavy");
  assert.equal(screening.budget.dkk, 12);
  assert.equal(screening.customCap, true);
  assert.equal(screening.legacy, false);
  const deep = await loadRunPlan(client, "f", "deep");
  assert.equal(deep.tier, "light");
  assert.equal(deep.customCap, false);
});

test("a fund without the columns yet runs the pre-R-9b plan", async () => {
  const client = fakeClient({ data: null, error: { code: "42703", message: "no column" } });
  const plans = await loadFundRunPlans(client, "f");
  assert.equal(plans.screening.legacy, true);
  assert.equal(plans.screening.model, "openai/gpt-5.4-mini");
  assert.equal(plans.deep.model, "openai/gpt-5.4");
});

test("any other read error stops the run instead of guessing a plan", async () => {
  const client = fakeClient({ data: null, error: { code: "57014", message: "timeout" } });
  await assert.rejects(() => loadRunPlan(client, "f", "screening"), /kunne ikke læses/);
});

test("a missing fund stops the run", async () => {
  await assert.rejects(
    () => loadRunPlan(fakeClient({ data: null, error: null }), "f", "deep"),
    /ikke fundet/,
  );
});

test("a stored cap outside the hard limits and an unknown tier fall back safely", async () => {
  const client = fakeClient({
    data: { screening_tier: "ultra", deep_tier: null, screening_cap_dkk: 100000, deep_cap_dkk: -1 },
    error: null,
  });
  const screening = await loadRunPlan(client, "f", "screening");
  assert.equal(screening.tier, "medium");
  assert.equal(screening.customCap, false);
  assert.equal((await loadRunPlan(client, "f", "deep")).customCap, false);
});

test("a new run uses the installation's one rate, and keeps it on the run (T-1000)", async () => {
  const client = fakeClient(
    {
      data: {
        screening_tier: "medium",
        deep_tier: "medium",
        screening_cap_dkk: null,
        deep_cap_dkk: 35,
      },
      error: null,
    },
    { ...PLATFORM_ROW, usd_to_dkk: 6.9 },
  );
  const deep = await loadRunPlan(client, "f", "deep");
  assert.equal(deep.usdToDkk, 6.9);
  // 35 kr. is 35 kr. in the ledger: the dollars times the booking rate never pass the cap.
  assert.equal(deep.budget.dkk, 35);
  assert.ok(deep.budget.usd * 6.9 <= 35);
  assert.equal(planColumns(deep).usd_to_dkk, 6.9);
  const screening = await loadRunPlan(client, "f", "screening");
  assert.equal(screening.budget.dkk, 10);
  assert.ok(screening.budget.usd * 6.9 <= 10);
});

test("a stored run keeps the rate it started with; a run from before 0123 keeps 6.46", () => {
  const started = planFromStoredRun("screening", {
    ai_tier: "medium",
    cost_cap_dkk: 10,
    usd_to_dkk: 7.2,
  });
  assert.equal(started.usdToDkk, 7.2);
  assert.ok(started.budget.usd * 7.2 <= 10);
  const old = planFromStoredRun("screening", { ai_tier: "medium", cost_cap_dkk: 10 });
  assert.equal(old.usdToDkk, 6.46);
  assert.equal(old.budget.usd, 1.54);
});

test("a run never gets more than the installation's hard limit (T-1000)", async () => {
  const client = fakeClient(
    {
      data: {
        screening_tier: "medium",
        deep_tier: "heavy",
        screening_cap_dkk: 50,
        deep_cap_dkk: null,
      },
      error: null,
    },
    { ...PLATFORM_ROW, platform_screening_cap_dkk: 8, platform_deep_cap_dkk: 40 },
  );
  const screening = await loadRunPlan(client, "f", "screening");
  assert.equal(screening.budget.dkk, 8);
  const deep = await loadRunPlan(client, "f", "deep");
  // Tung's standard (60 kr.) is above the limit too.
  assert.equal(deep.budget.dkk, 40);
  assert.equal(deep.customCap, true);
});

test("the action at the limit and the monthly limit come with the fund's settings", async () => {
  const client = fakeClient({
    data: {
      screening_tier: "medium",
      deep_tier: "medium",
      screening_cap_dkk: null,
      deep_cap_dkk: null,
      analysis_limit_action: "ask",
      monthly_cap_dkk: "250.50",
    },
    error: null,
  });
  const settings = await loadFundAiSettings(client, "f");
  assert.equal(settings?.limitAction, "ask");
  assert.equal(settings?.monthlyCapDkk, 250.5);
  const plain = await loadFundAiSettings(
    fakeClient({
      data: {
        screening_tier: "light",
        deep_tier: "light",
        screening_cap_dkk: null,
        deep_cap_dkk: null,
      },
      error: null,
    }),
    "f",
  );
  assert.equal(plain?.limitAction, "shrink");
  assert.equal(plain?.monthlyCapDkk, null);
});

test("an unreadable installation row stops the run instead of guessing a rate", async () => {
  const client = fakeClient(
    { data: { screening_tier: "medium", deep_tier: "medium" }, error: null },
    null,
  );
  await assert.rejects(() => loadRunPlan(client, "f", "screening"), /kunne ikke læses/);
});

const FUND_ROW = {
  screening_tier: "medium",
  deep_tier: "medium",
  screening_cap_dkk: 3,
  deep_cap_dkk: null,
};

test("a limit that shrinks the run starts it when the team chose to make it smaller", async () => {
  const client = fakeClient({
    data: { ...FUND_ROW, analysis_limit_action: "shrink" },
    error: null,
  });
  const plan = await planNewRun(client, { fundId: "f", kind: "screening" });
  assert.equal(plan?.scope.status, "reduced");
  assert.equal(plan?.budget.dkk, 3);
});

test("a team that asks first gets the question, and its answer starts the run", async () => {
  const client = fakeClient({ data: { ...FUND_ROW, analysis_limit_action: "ask" }, error: null });
  assert.equal(await planNewRun(client, { fundId: "f", kind: "screening" }), null);
  const smaller = await planNewRun(client, { fundId: "f", kind: "screening", choice: "reduce" });
  assert.equal(smaller?.scope.status, "reduced");
  assert.equal(smaller?.budget.dkk, 3);
  const raised = await planNewRun(client, { fundId: "f", kind: "screening", choice: "raise_once" });
  assert.equal(raised?.scope.status, "full");
  assert.equal(raised?.budget.dkk, 10);
  // A full analysis needs no question.
  const full = fakeClient({
    data: { ...FUND_ROW, screening_cap_dkk: null, analysis_limit_action: "ask" },
    error: null,
  });
  assert.equal((await planNewRun(full, { fundId: "f", kind: "screening" }))?.scope.status, "full");
});

test("raising the limit one time stays inside the installation's hard limit", async () => {
  const client = fakeClient(
    { data: { ...FUND_ROW, analysis_limit_action: "ask" }, error: null },
    { ...PLATFORM_ROW, platform_screening_cap_dkk: 4 },
  );
  const raised = await planNewRun(client, { fundId: "f", kind: "screening", choice: "raise_once" });
  assert.equal(raised?.budget.dkk, 4);
});

test("under the bottom for the level no run starts, whatever the team chose", async () => {
  const client = fakeClient(
    { data: { ...FUND_ROW, screening_cap_dkk: 1, analysis_limit_action: "shrink" }, error: null },
    { ...PLATFORM_ROW, usd_to_dkk: 6.9 },
  );
  await assert.rejects(() => planNewRun(client, { fundId: "f", kind: "screening" }), /for lav/);
  await assert.rejects(
    () => planNewRun(client, { fundId: "f", kind: "screening", choice: "reduce" }),
    /for lav/,
  );
});

const MONTHLY = { ...FUND_ROW, screening_cap_dkk: null, monthly_cap_dkk: 100 };

test("a run gets what is left of the month, and shrinks to fit (T-1003)", async () => {
  const room = fakeClient({ data: MONTHLY, error: null }, PLATFORM_ROW, {
    cap_dkk: 100,
    used_dkk: 96.5,
  });
  const plan = await planNewRun(room, { fundId: "f", kind: "screening" });
  assert.equal(plan?.budget.dkk, 3.5);
  assert.notEqual(plan?.scope.status, "full");
  // Plenty left: the level's standard, untouched.
  const plenty = fakeClient({ data: MONTHLY, error: null }, PLATFORM_ROW, {
    cap_dkk: 100,
    used_dkk: 10,
  });
  const full = await planNewRun(plenty, { fundId: "f", kind: "screening" });
  assert.equal(full?.budget.dkk, 10);
  assert.equal(full?.scope.status, "full");
});

test("a month without room stops the run with its own sentence, before anything is reserved", async () => {
  for (const used of [100, 99.5, 98]) {
    const client = fakeClient({ data: MONTHLY, error: null }, PLATFORM_ROW, {
      cap_dkk: 100,
      used_dkk: used,
    });
    await assert.rejects(
      () => planNewRun(client, { fundId: "f", kind: "screening" }),
      /månedsgrænse/,
    );
  }
});

test("raising the limit one time cannot pass the month", async () => {
  const client = fakeClient(
    { data: { ...FUND_ROW, monthly_cap_dkk: 100, analysis_limit_action: "ask" }, error: null },
    PLATFORM_ROW,
    { cap_dkk: 100, used_dkk: 94 },
  );
  const raised = await planNewRun(client, { fundId: "f", kind: "screening", choice: "raise_once" });
  assert.equal(raised?.budget.dkk, 6);
});

/**
 * A fund with a monthly limit whose month changes between reads: `months` are the answers of
 * fund_analysis_month in turn, `reserves` the answers of ai_reserve (null = refused).
 */
function monthClient(input: {
  fund: Record<string, unknown>;
  months: Array<{ cap_dkk: number | null; used_dkk: number }>;
  reserves: Array<number | null>;
  openRuns?: unknown[];
}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const tables: string[] = [];
  let month = 0;
  let reserve = 0;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "ai_settle_now") return { data: { settled: 0, released: 0 }, error: null };
      if (name === "fund_analysis_month") {
        const answer = input.months[Math.min(month, input.months.length - 1)];
        month += 1;
        return { data: [answer], error: null };
      }
      if (name === "ai_reserve") return { data: input.reserves[reserve++] ?? null, error: null };
      if (name === "rate_limit_hit_all") return { data: 0, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from: (table: string) => {
      tables.push(table);
      const self = {
        select: () => self,
        eq: () => self,
        in: () => self,
        lt: async () => ({ data: input.openRuns ?? [], error: null }),
        maybeSingle: async () =>
          table === "ai_settings"
            ? { data: PLATFORM_ROW, error: null }
            : { data: input.fund, error: null },
      };
      return self;
    },
  } as unknown as SupabaseClient;
  return { client, calls, tables };
}

const SHRINK_MONTH = {
  ...FUND_ROW,
  screening_cap_dkk: null,
  monthly_cap_dkk: 100,
  analysis_limit_action: "shrink",
};
const RESERVE_INPUT = { fundId: "f", kind: "screening" as const, runId: "r", userId: "u" };

test("a run that lost the month to another run is made smaller, not refused (T-1072, C4-11)", async () => {
  // Planned with 10 kr. left; another run took 6 kr. before the row lock, so 4 kr. are left.
  const { client, calls } = monthClient({
    fund: SHRINK_MONTH,
    months: [
      { cap_dkk: 100, used_dkk: 90 },
      { cap_dkk: 100, used_dkk: 96 },
    ],
    reserves: [null, 41],
  });
  const planned = await planNewRun(client, { fundId: "f", kind: "screening" });
  assert.equal(planned?.budget.dkk, 10);
  const { plan, ledgerId } = await reservePlannedRun(client, planned!, RESERVE_INPUT);
  assert.equal(ledgerId, 41);
  assert.equal(plan.budget.dkk, 4);
  assert.equal(plan.model, planned!.model);
  assert.notEqual(plan.scope.status, "full");
  // The second reservation asks for the smaller plan's dollars.
  const reserves = calls.filter((call) => call.name === "ai_reserve");
  assert.equal(reserves.length, 2);
  assert.equal(reserves[1]?.args["_max_usd"], plan.budget.usd);
  assert.ok(Number(reserves[1]?.args["_max_usd"]) < Number(reserves[0]?.args["_max_usd"]));
});

test("a team that asks first is refused as before when the month shrank under it", async () => {
  const { client } = monthClient({
    fund: { ...SHRINK_MONTH, analysis_limit_action: "ask" },
    months: [
      { cap_dkk: 100, used_dkk: 90 },
      { cap_dkk: 100, used_dkk: 96 },
    ],
    reserves: [null, 41],
  });
  const planned = await planNewRun(client, { fundId: "f", kind: "screening" });
  assert.equal(planned?.scope.status, "full");
  await assert.rejects(
    () => reservePlannedRun(client, planned!, RESERVE_INPUT),
    (cause: unknown) => cause instanceof MonthlyLimitError,
  );
});

test("a month that is gone refuses with the month's sentence; re-planning stops after two tries", async () => {
  // Nothing left after the other run: planNewRun refuses with its own sentence.
  const gone = monthClient({
    fund: SHRINK_MONTH,
    months: [
      { cap_dkk: 100, used_dkk: 90 },
      { cap_dkk: 100, used_dkk: 100 },
    ],
    reserves: [null],
  });
  const planned = await planNewRun(gone.client, { fundId: "f", kind: "screening" });
  await assert.rejects(
    () => reservePlannedRun(gone.client, planned!, RESERVE_INPUT),
    /månedsgrænse/,
  );
  // Other runs keep taking the room: at most two new plans, then refused.
  const busy = monthClient({
    fund: SHRINK_MONTH,
    months: [
      { cap_dkk: 100, used_dkk: 90 },
      { cap_dkk: 100, used_dkk: 92 },
      { cap_dkk: 100, used_dkk: 92 },
      { cap_dkk: 100, used_dkk: 94 },
      { cap_dkk: 100, used_dkk: 94 },
      { cap_dkk: 100, used_dkk: 95 },
    ],
    reserves: [null, null, null, 7],
  });
  const first = await planNewRun(busy.client, { fundId: "f", kind: "screening" });
  await assert.rejects(
    () => reservePlannedRun(busy.client, first!, RESERVE_INPUT),
    (cause: unknown) => cause instanceof MonthlyLimitError,
  );
  assert.equal(busy.calls.filter((call) => call.name === "ai_reserve").length, 3);
});

test("a refusal that is not the month (the balance) is never re-planned", async () => {
  // Room in the month, but ai_reserve refuses: the balance stopped it.
  const { client, calls } = monthClient({
    fund: SHRINK_MONTH,
    months: [{ cap_dkk: 100, used_dkk: 10 }],
    reserves: [null],
  });
  const planned = await planNewRun(client, { fundId: "f", kind: "screening" });
  await assert.rejects(
    () => reservePlannedRun(client, planned!, RESERVE_INPUT),
    (cause: unknown) => cause instanceof Error && !(cause instanceof MonthlyLimitError),
  );
  assert.equal(calls.filter((call) => call.name === "ai_reserve").length, 1);
});

test("with a monthly limit the team's runs that stand still are closed first (T-1072, C4-8)", async () => {
  const withMonth = monthClient({
    fund: SHRINK_MONTH,
    months: [{ cap_dkk: 100, used_dkk: 10 }],
    reserves: [],
  });
  await planNewRun(withMonth.client, { fundId: "f", kind: "screening" });
  assert.ok(withMonth.tables.includes("analysis_runs"));
  // Without a monthly limit nothing is read or closed (only the month needs it).
  const without = monthClient({
    fund: { ...SHRINK_MONTH, monthly_cap_dkk: null },
    months: [{ cap_dkk: null, used_dkk: 0 }],
    reserves: [],
  });
  await planNewRun(without.client, { fundId: "f", kind: "screening" });
  assert.equal(without.tables.includes("analysis_runs"), false);
});

const DEEP_IDS = ["people_team", "product_market_gtm", "technology_risk", "fund_finance_deal"];
const ONLY_SYNTHESIS_LEFT = {
  model: "openai/gpt-5.4",
  specialistIds: DEEP_IDS,
  progress: { researchDone: true, evidenceSheetDone: true, specialistsDone: DEEP_IDS },
};
const DEEP_MONTH = { ...FUND_ROW, monthly_cap_dkk: 100, analysis_limit_action: "shrink" };
const DEEP_RESERVE_INPUT = { fundId: "f", kind: "deep" as const, runId: "r", userId: "u" };

test("a continuation where only the synthesis is missing starts on what is left of the month (T-1080, D61 b)", async () => {
  // 4.90 kr. left: under the bottom for a new deep run (5 kr.), enough for the synthesis' part.
  const month = { cap_dkk: 100, used_dkk: 95.1 };
  const { client, calls } = monthClient({ fund: DEEP_MONTH, months: [month], reserves: [77] });
  const deep = { fundId: "f", kind: "deep" as const, specialistCount: 4 };
  const planned = await planNewRun(client, { ...deep, stopped: ONLY_SYNTHESIS_LEFT });
  // Planned on the run's own limit, not shrunk by the month: the synthesis keeps its full share.
  assert.equal(planned?.budget.dkk, 35);
  assert.equal(planned?.scope.status, "full");
  assert.equal(planned?.reserve?.usd, planned?.budget.synthesisUsd);
  assert.ok((planned?.reserve?.dkk ?? 99) <= 4.9);
  const { plan, ledgerId } = await reservePlannedRun(client, planned!, {
    ...DEEP_RESERVE_INPUT,
    specialistCount: 4,
    stopped: ONLY_SYNTHESIS_LEFT,
  });
  assert.equal(ledgerId, 77);
  assert.equal(plan, planned);
  // The ledger is asked for the synthesis' dollars only, not the whole limit.
  const reserves = calls.filter((call) => call.name === "ai_reserve");
  assert.equal(reserves.length, 1);
  assert.equal(reserves[0]?.args["_max_usd"], planned?.budget.synthesisUsd);
  // A new run in the same month is refused, as before.
  const fresh = monthClient({ fund: DEEP_MONTH, months: [month], reserves: [] });
  await assert.rejects(() => planNewRun(fresh.client, deep), /månedsgrænse/);
});

test("a continuation where the research is missing reserves the whole run, shrunk by the month as before", async () => {
  const { client } = monthClient({
    fund: DEEP_MONTH,
    months: [{ cap_dkk: 100, used_dkk: 80 }],
    reserves: [],
  });
  const planned = await planNewRun(client, {
    fundId: "f",
    kind: "deep",
    specialistCount: 4,
    stopped: {
      ...ONLY_SYNTHESIS_LEFT,
      progress: { researchDone: false, evidenceSheetDone: false, specialistsDone: [] },
    },
  });
  assert.equal(planned?.budget.dkk, 20);
  assert.equal(planned?.reserve, undefined);
});

test("a continuation whose missing part does not fit the month is planned on the month as before", async () => {
  // 3 kr. left: not even the synthesis' part fits, and a new deep run cannot start.
  const { client } = monthClient({
    fund: DEEP_MONTH,
    months: [{ cap_dkk: 100, used_dkk: 97 }],
    reserves: [],
  });
  await assert.rejects(
    () =>
      planNewRun(client, {
        fundId: "f",
        kind: "deep",
        specialistCount: 4,
        stopped: ONLY_SYNTHESIS_LEFT,
      }),
    /månedsgrænse/,
  );
});

test("a stopped run on another model is no continuation: its steps cannot be taken over", async () => {
  const { client } = monthClient({
    fund: DEEP_MONTH,
    months: [{ cap_dkk: 100, used_dkk: 10 }],
    reserves: [],
  });
  const planned = await planNewRun(client, {
    fundId: "f",
    kind: "deep",
    specialistCount: 4,
    stopped: { ...ONLY_SYNTHESIS_LEFT, model: "openai/gpt-5.5" },
  });
  assert.equal(planned?.reserve, undefined);
  assert.equal(planned?.budget.dkk, 35);
});

test("without a monthly limit a continuation still reserves only what is missing from the balance", async () => {
  const client = fakeClient({ data: { ...FUND_ROW, monthly_cap_dkk: null }, error: null });
  const planned = await planNewRun(client, {
    fundId: "f",
    kind: "deep",
    specialistCount: 4,
    stopped: ONLY_SYNTHESIS_LEFT,
  });
  assert.equal(planned?.reserve?.usd, planned?.budget.synthesisUsd);
});
