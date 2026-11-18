import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFundRunPlans, loadRunPlan } from "./run-plan.server.ts";

function fakeClient(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => result,
  };
  return { from: () => builder } as unknown as SupabaseClient;
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
