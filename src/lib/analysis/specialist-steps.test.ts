/**
 * F2: the deep analysis's stop and "Fortsæt" with a stub gateway and a small limit, not as
 * regex over the source. Specialist 2 of 4 stops at the limit: the run stops at its limit, the
 * finished steps stay finished, and the next try pays only for the missing call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWithinBudget, BudgetLimitError, stopReasonOf } from "./budgets.ts";
import {
  runSpecialistSteps,
  type SpecialistCompletion,
  type SpecialistStepStore,
} from "./specialist-steps.ts";

type Packet = { specialist: string };
type Completion = SpecialistCompletion & { content: string };
type Step = { status: string; output_json?: unknown; charged_cost?: number };

const SPECIALISTS = ["market", "team", "product", "finance"].map((id) => ({ id }));
const CALL_PRICE_USD = 0.25;

/** The run's steps in memory, written as the worker writes them. */
function memoryStore(steps: Map<string, Step>): SpecialistStepStore<Packet, Completion> {
  return {
    takeOver: async (key, packet) => {
      steps.set(key, { status: "complete", output_json: packet, charged_cost: 0 });
    },
    load: async () => new Map(steps),
    claim: async (key) => {
      if (steps.get(key)?.status === "running") return false;
      steps.set(key, { status: "running" });
      return true;
    },
    complete: async (key, packet, completion) => {
      steps.set(key, {
        status: "complete",
        output_json: packet,
        charged_cost: completion.actualCostUsd ?? completion.estimatedMaximumUsd.maxCostUsd,
      });
    },
    fail: async (key, cause) => {
      steps.set(key, { status: "failed" });
      return cause instanceof Error ? cause.message : "failed";
    },
  };
}

/** A stub gateway: a call whose worst case passes what is left for it stops before it is sent. */
function stubGateway(limitFor: (id: string) => number) {
  const called: string[] = [];
  const call = async (module: { id: string }): Promise<Completion> => {
    const estimate = { maxCostUsd: CALL_PRICE_USD, maxInputTokens: 100, maxOutputTokens: 100 };
    assertWithinBudget(estimate, limitFor(module.id), `Specialist ${module.id}`, "da");
    called.push(module.id);
    return {
      content: JSON.stringify({ specialist: module.id }),
      actualCostUsd: CALL_PRICE_USD,
      estimatedMaximumUsd: estimate,
    };
  };
  return { call, called };
}

function phase(
  steps: Map<string, Step>,
  gateway: ReturnType<typeof stubGateway>,
  reusable: Map<string, Packet> = new Map(),
) {
  return runSpecialistSteps<{ id: string }, Packet, Completion>({
    specialists: SPECIALISTS,
    initialSteps: new Map(steps),
    reusable,
    store: memoryStore(steps),
    stored: (_module, output) => output as Packet,
    call: gateway.call,
    toPacket: (_module, completion) => JSON.parse(completion.content) as Packet,
    failedCompletion: () => null,
    specialistsUsd: 4 * CALL_PRICE_USD,
    language: "da",
    fallbackMessage: "failed",
  });
}

test("specialist 2 of 4 stops at the limit: a stop, the other three are kept", async () => {
  const steps = new Map<string, Step>();
  const gateway = stubGateway((id) => (id === "team" ? 0.1 : 1));
  const stop = await phase(steps, gateway).then(
    () => null,
    (cause: unknown) => cause,
  );
  assert.ok(stop instanceof BudgetLimitError, "the run stops at its limit, it does not fail");
  assert.equal(stopReasonOf(stop), "price_limit");
  assert.deepEqual(gateway.called, ["market", "product", "finance"]);
  assert.equal(steps.get("team")?.status, "failed");
  for (const id of ["market", "product", "finance"]) {
    assert.equal(steps.get(id)?.status, "complete");
    assert.deepEqual(steps.get(id)?.output_json, { specialist: id });
  }
});

test("a real error beside a stop is a real error, not a stop", async () => {
  const steps = new Map<string, Step>();
  const gateway = stubGateway((id) => (id === "team" ? 0.1 : 1));
  const failing = async (module: { id: string }) => {
    if (module.id === "finance") throw new Error("timeout");
    return gateway.call(module);
  };
  const cause = await runSpecialistSteps<{ id: string }, Packet, Completion>({
    specialists: SPECIALISTS,
    initialSteps: new Map(),
    reusable: new Map(),
    store: memoryStore(steps),
    stored: (_module, output) => output as Packet,
    call: failing,
    toPacket: (_module, completion) => JSON.parse(completion.content) as Packet,
    failedCompletion: () => null,
    specialistsUsd: 1,
    language: "da",
    fallbackMessage: "failed",
  }).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(cause instanceof Error);
  assert.equal(stopReasonOf(cause), null);
});

test("Fortsæt after the stop pays only for the missing specialist", async () => {
  // The stopped run's finished steps, as loadReusableSpecialists hands them to the next run.
  const stoppedSteps = new Map<string, Step>();
  await phase(
    stoppedSteps,
    stubGateway((id) => (id === "team" ? 0.1 : 1)),
  ).catch(() => {});
  const reusable = new Map(
    [...stoppedSteps]
      .filter(([, step]) => step.status === "complete")
      .map(([key, step]) => [key, step.output_json as Packet]),
  );
  assert.equal(reusable.size, 3);

  // The next run (a raised limit): three steps are taken over at 0, one call is made and paid.
  const steps = new Map<string, Step>();
  const gateway = stubGateway(() => 1);
  assert.equal(await phase(steps, gateway, reusable), true);
  assert.deepEqual(gateway.called, ["team"]);
  assert.ok([...steps.values()].every((step) => step.status === "complete"));
  const paid = [...steps.values()].reduce((sum, step) => sum + (step.charged_cost ?? 0), 0);
  assert.equal(paid, CALL_PRICE_USD);
  for (const id of ["market", "product", "finance"]) assert.equal(steps.get(id)?.charged_cost, 0);
});

test("another delivery still running a step leaves the phase waiting, never failed", async () => {
  const steps = new Map<string, Step>([["finance", { status: "running" }]]);
  const gateway = stubGateway(() => 1);
  assert.equal(await phase(steps, gateway), false);
  assert.deepEqual(gateway.called, ["market", "team", "product"]);
});
