import { loadAnalysisMonth } from "./analysis-month.server.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CREDITS_EXHAUSTED_MESSAGE,
  CreditsExhaustedError,
  HELPER_CREDITS_EXHAUSTED_MESSAGE,
  releaseAnalysisCredits,
  reserveAnalysisCredits,
  reserveCallCredits,
  sendCharged,
} from "./credits.server.ts";
import { AiDataPolicyError } from "./gateway-options.ts";
import { AiUseLimitError } from "./usage-limits.server.ts";

type Call = { fn: string; args: Record<string, unknown> };

/** The hourly limits answer "allowed" and are left out of `calls`. */
function fakeService(result: { data: unknown; error: { message: string } | null }) {
  const calls: Call[] = [];
  const service = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "rate_limit_hit_all") return { data: 0, error: null };
      calls.push({ fn, args });
      return result;
    },
  } as unknown as SupabaseClient;
  return { service, calls };
}

const input = {
  fundId: "fund-1",
  runId: "run-1",
  capUsd: 2.5,
  capDkk: 5,
  userId: "user-1",
  model: "openai/gpt-5.4-mini",
  kind: "screening" as const,
};

test("a reservation passes the run id as ref_id and returns the ledger id", async () => {
  const { service, calls } = fakeService({ data: 42, error: null });
  assert.equal(await reserveAnalysisCredits(service, input), 42);
  assert.equal(calls[0]?.fn, "ai_reserve");
  assert.deepEqual(calls[0]?.args, {
    _scope: "analysis",
    _fund_id: "fund-1",
    _max_usd: 2.5,
    _loop: null,
    _ref_id: "run-1",
    _model: "openai/gpt-5.4-mini",
    _user_id: "user-1",
  });
});

test("an empty balance stops the analysis with the top-up message", async () => {
  const { service } = fakeService({ data: null, error: null });
  await assert.rejects(reserveAnalysisCredits(service, input), {
    message: CREDITS_EXHAUSTED_MESSAGE,
  });
});

test("a database error is not mistaken for an empty balance", async () => {
  const { service } = fakeService({ data: null, error: { message: "boom" } });
  // The database's own text is logged, never shown.
  await assert.rejects(reserveAnalysisCredits(service, input), (cause: unknown) => {
    assert.equal((cause as Error).message, "Kreditterne kunne ikke reserveres. Prøv igen om lidt.");
    return true;
  });
});

test("releasing hands the reservation back and never throws", async () => {
  const ok = fakeService({ data: true, error: null });
  await releaseAnalysisCredits(ok.service, 7);
  assert.deepEqual(ok.calls[0], { fn: "ai_release_usage", args: { _id: 7 } });
  const failing = fakeService({ data: null, error: { message: "down" } });
  await releaseAnalysisCredits(failing.service, 7);
});

/** A fake ledger: ai_reserve answers `reserve`, the rest answer ok, every call is recorded. */
function fakeLedger(reserve: { data: unknown; error: { message: string } | null }) {
  const calls: Call[] = [];
  const service = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "rate_limit_hit_all") return { data: 0, error: null };
      calls.push({ fn, args });
      return fn === "ai_reserve" ? reserve : { data: true, error: null };
    },
  } as unknown as SupabaseClient;
  return { service, calls };
}

const helper = {
  scope: "chat" as const,
  fundId: "fund-1",
  userId: "user-1",
  maxUsd: 0.05,
  loop: "fund_setup:criterion",
  model: "openai/gpt-5.4-mini",
};

test("a helper call reserves its maximum under its own name, without a run id", async () => {
  const { service, calls } = fakeLedger({ data: 9, error: null });
  await reserveCallCredits(service, helper);
  assert.deepEqual(calls[0], {
    fn: "ai_reserve",
    args: {
      _scope: "chat",
      _fund_id: "fund-1",
      _max_usd: 0.05,
      _loop: "fund_setup:criterion",
      _ref_id: null,
      _model: "openai/gpt-5.4-mini",
      _user_id: "user-1",
    },
  });
});

test("an empty balance stops a helper call before anything is sent", async () => {
  const { service } = fakeLedger({ data: null, error: null });
  await assert.rejects(reserveCallCredits(service, helper), (cause: unknown) => {
    assert.ok(cause instanceof CreditsExhaustedError);
    assert.equal(cause.message, HELPER_CREDITS_EXHAUSTED_MESSAGE);
    return true;
  });
});

test("a ledger error is not mistaken for an empty balance", async () => {
  const { service } = fakeLedger({ data: null, error: { message: "boom" } });
  await assert.rejects(reserveCallCredits(service, helper), (cause: unknown) => {
    assert.ok(!(cause instanceof CreditsExhaustedError));
    assert.doesNotMatch((cause as Error).message, /boom/);
    assert.match((cause as Error).message, /kunne ikke reserveres/);
    return true;
  });
});

test("an answered call books its price; settling twice books once", async () => {
  const { service, calls } = fakeLedger({ data: 9, error: null });
  const credits = await reserveCallCredits(service, helper);
  credits.charge(0.012);
  await credits.settle();
  await credits.settle();
  assert.deepEqual(calls.slice(1), [
    {
      fn: "ai_finalize_usage",
      args: { _id: 9, _cost_usd: 0.012, _model: "openai/gpt-5.4-mini" },
    },
  ]);
});

test("an answer without a price books the reservation, not 0", async () => {
  const { service, calls } = fakeLedger({ data: 9, error: null });
  const credits = await reserveCallCredits(service, helper);
  credits.charge(null);
  await credits.settle();
  assert.equal(calls[1]?.fn, "ai_finalize_usage");
  assert.equal(calls[1]?.args["_cost_usd"], 0.05);
});

test("a call that never got an answer gives the reservation back", async () => {
  const { service, calls } = fakeLedger({ data: 9, error: null });
  const credits = await reserveCallCredits(service, helper);
  await credits.settle();
  assert.deepEqual(calls[1], { fn: "ai_release_usage", args: { _id: 9 } });
});

test("settling never throws, even when the ledger is down", async () => {
  let reserved = false;
  const service = {
    rpc: async (fn: string) => {
      if (fn === "rate_limit_hit_all") return { data: 0, error: null };
      if (fn === "ai_reserve" && !reserved) {
        reserved = true;
        return { data: 9, error: null };
      }
      return { data: null, error: { message: "down" } };
    },
  } as unknown as SupabaseClient;
  const credits = await reserveCallCredits(service, helper);
  credits.charge(0.01);
  await credits.settle();
});

test("an unknown price never replaces a known one", async () => {
  const { service, calls } = fakeLedger({ data: 9, error: null });
  const credits = await reserveCallCredits(service, helper);
  credits.charge(0.01);
  credits.charge(null);
  await credits.settle();
  assert.equal(calls[1]?.args["_cost_usd"], 0.01);
});

async function sentWith(send: () => Promise<Response>) {
  const { service, calls } = fakeLedger({ data: 9, error: null });
  const credits = await reserveCallCredits(service, helper);
  const result = await sendCharged(credits, send).catch((cause: unknown) => cause);
  await credits.settle();
  return { result, settledWith: calls[1] };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("an answer books the gateway's price", async () => {
  const { settledWith } = await sentWith(async () => json({ usage: { cost: 0.004 }, choices: [] }));
  assert.equal(settledWith?.fn, "ai_finalize_usage");
  assert.equal(settledWith?.args["_cost_usd"], 0.004);
});

test("a timeout after the request left books the reservation", async () => {
  const { result, settledWith } = await sentWith(async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  assert.ok(result instanceof DOMException);
  assert.equal(settledWith?.fn, "ai_finalize_usage");
  assert.equal(settledWith?.args["_cost_usd"], 0.05);
});

test("an answer that is not JSON books the reservation and keeps its error", async () => {
  const { result, settledWith } = await sentWith(
    async () => new Response("<html>", { status: 200 }),
  );
  assert.ok(result instanceof SyntaxError);
  assert.equal(settledWith?.args["_cost_usd"], 0.05);
});

test("a data rules stop (nothing sent) and a gateway error give the reservation back", async () => {
  const stopped = await sentWith(async () => {
    throw new AiDataPolicyError("not_masked", "m", "stop");
  });
  assert.ok(stopped.result instanceof AiDataPolicyError);
  assert.deepEqual(stopped.settledWith, { fn: "ai_release_usage", args: { _id: 9 } });
  const failed = await sentWith(async () => json({ error: { message: "bad" } }, 502));
  assert.deepEqual(failed.settledWith, { fn: "ai_release_usage", args: { _id: 9 } });
});

/** A ledger whose hourly limits answer `refused` (0 = allowed, null = down); calls recorded. */
function limitedLedger(refused: number | null) {
  const calls: Call[] = [];
  const service = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "rate_limit_hit_all") {
        return refused === null
          ? { data: null, error: { message: "down" } }
          : { data: refused, error: null };
      }
      return { data: 9, error: null };
    },
  } as unknown as SupabaseClient;
  return { service, calls };
}

test("a person over their hourly limit gets the reservation back and the user message", async () => {
  const { service, calls } = limitedLedger(1);
  await assert.rejects(
    reserveAnalysisCredits(service, { ...input, kind: "deep_analysis" }),
    (cause: unknown) => {
      assert.ok(cause instanceof AiUseLimitError);
      assert.match(cause.message, /^Du har nået grænsen på 4 dybe analyser i timen/);
      return true;
    },
  );
  assert.deepEqual(
    calls.map((call) => call.fn),
    ["ai_reserve", "rate_limit_hit_all", "ai_release_usage"],
  );
  assert.deepEqual(calls[1]?.args, {
    _keys: ["ai:deep_analysis:user:user-1", "ai:deep_analysis:fund:fund-1"],
    _limits: [4, 10],
    _window_seconds: 3600,
  });
});

test("a team over its hourly limit stops a helper call and releases it", async () => {
  const { service, calls } = limitedLedger(2);
  await assert.rejects(reserveCallCredits(service, helper), (cause: unknown) => {
    assert.ok(cause instanceof AiUseLimitError);
    assert.match(cause.message, /^Teamet har nået grænsen på 200 kald til AI-hjælpen/);
    return true;
  });
  assert.deepEqual(calls.at(-1), { fn: "ai_release_usage", args: { _id: 9 } });
});

test("an empty balance uses no place in the hour", async () => {
  const fns: string[] = [];
  const service = {
    rpc: async (fn: string) => {
      fns.push(fn);
      return { data: fn === "rate_limit_hit_all" ? 0 : null, error: null };
    },
  } as unknown as SupabaseClient;
  await assert.rejects(reserveCallCredits(service, helper));
  assert.deepEqual(fns, ["ai_reserve"]);
});

test("a limit that cannot be counted stops the call; a call without a person is not limited", async () => {
  const down = limitedLedger(null);
  await assert.rejects(reserveAnalysisCredits(down.service, input), /kunne ikke tjekkes/);
  assert.equal(down.calls.at(-1)?.fn, "ai_release_usage");
  const background = limitedLedger(1);
  await reserveCallCredits(background.service, { ...helper, userId: null });
  assert.deepEqual(
    background.calls.map((call) => call.fn),
    ["ai_reserve"],
  );
});

test("a refusal says when the team's monthly limit stopped the run, not the balance (T-1003)", async () => {
  const refusal = (month: { cap_dkk: number | null; used_dkk: number }) =>
    ({
      rpc: async (fn: string) =>
        fn === "fund_analysis_month" ? { data: [month], error: null } : { data: null, error: null },
    }) as unknown as SupabaseClient;
  await assert.rejects(
    () => reserveAnalysisCredits(refusal({ cap_dkk: 10, used_dkk: 8 }), { ...input, capDkk: 5 }),
    /månedsgrænse/,
  );
  // Room in the month, or no limit at all: it was the balance.
  await assert.rejects(
    () => reserveAnalysisCredits(refusal({ cap_dkk: 10, used_dkk: 2 }), { ...input, capDkk: 5 }),
    /Fyld op/,
  );
  await assert.rejects(
    () =>
      reserveAnalysisCredits(refusal({ cap_dkk: null, used_dkk: 900 }), { ...input, capDkk: 5 }),
    /Fyld op/,
  );
});

test("the month is settled before it is read, and a failed settlement never reads as room", async () => {
  const calls: string[] = [];
  const service = {
    rpc: async (fn: string) => {
      calls.push(fn);
      return fn === "fund_analysis_month"
        ? { data: [{ cap_dkk: 20, used_dkk: 4 }], error: null }
        : { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  assert.deepEqual(await loadAnalysisMonth(service, "fund-1"), { capDkk: 20, usedDkk: 4 });
  assert.deepEqual(calls, ["ai_settle_now", "fund_analysis_month"]);
  const broken = {
    rpc: async () => ({ data: null, error: { message: "nede" } }),
  } as unknown as SupabaseClient;
  // The database's own text ("nede") never reaches the person, only the server's sentence.
  await assert.rejects(
    () => loadAnalysisMonth(broken, "fund-1"),
    (cause: unknown) =>
      cause instanceof Error &&
      /månedsforbrug kunne ikke læses|monthly usage could not be read/.test(cause.message) &&
      !cause.message.includes("nede"),
  );
});
