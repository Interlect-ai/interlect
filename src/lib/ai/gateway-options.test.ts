import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { AiDataPolicyError, aiGatewayOptions } from "./gateway-options.ts";

const FLAGS = ["AI_GATEWAY_ENFORCE_ZDR", "AI_GATEWAY_ENFORCE_EU_REGION"] as const;
const saved = new Map<string, string | undefined>();
let errorLog: typeof console.error;

beforeEach(() => {
  for (const flag of FLAGS) saved.set(flag, process.env[flag]);
  for (const flag of FLAGS) delete process.env[flag];
  errorLog = console.error;
  console.error = () => {};
});

afterEach(() => {
  for (const flag of FLAGS) {
    const value = saved.get(flag);
    if (value === undefined) delete process.env[flag];
    else process.env[flag] = value;
  }
  console.error = errorLog;
});

function enforce(flag: (typeof FLAGS)[number]) {
  process.env[flag] = "true";
}

function policyCode(fn: () => unknown): string {
  try {
    fn();
  } catch (cause) {
    assert.ok(cause instanceof AiDataPolicyError, "expected AiDataPolicyError");
    return cause.code;
  }
  assert.fail("expected the call to be stopped");
}

test("a Perplexity search never asks for ZDR, also when ZDR is enforced (the bug before R-17a)", () => {
  enforce("AI_GATEWAY_ENFORCE_ZDR");
  for (const model of ["perplexity/sonar", "perplexity/sonar-pro"]) {
    assert.deepEqual(aiGatewayOptions({ model, data: "public_search" }), {
      gateway: { disallowPromptTraining: true },
    });
  }
});

test("a confidential call gets ZDR and no training when ZDR is enforced", () => {
  enforce("AI_GATEWAY_ENFORCE_ZDR");
  for (const model of [
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4",
    "openai/gpt-5.5",
    "openai/text-embedding-3-small",
  ]) {
    assert.deepEqual(aiGatewayOptions({ model, data: "confidential" }), {
      gateway: { disallowPromptTraining: true, zeroDataRetention: true },
    });
  }
});

test("without the flag a confidential call keeps no-training only (today's behaviour)", () => {
  assert.deepEqual(aiGatewayOptions({ model: "openai/gpt-5.4", data: "confidential" }), {
    gateway: { disallowPromptTraining: true },
  });
});

test("confidential text can never go to a search model, enforced or not", () => {
  assert.equal(
    policyCode(() => aiGatewayOptions({ model: "perplexity/sonar", data: "confidential" })),
    "confidential_to_search",
  );
  enforce("AI_GATEWAY_ENFORCE_ZDR");
  assert.equal(
    policyCode(() => aiGatewayOptions({ model: "perplexity/sonar-pro", data: "confidential" })),
    "confidential_to_search",
  );
});

test("a language model cannot dodge ZDR by calling itself a public search", () => {
  enforce("AI_GATEWAY_ENFORCE_ZDR");
  assert.equal(
    policyCode(() => aiGatewayOptions({ model: "openai/gpt-5.4", data: "public_search" })),
    "search_model_required",
  );
});

test("a model missing from the ZDR table is stopped before anything is sent", () => {
  assert.equal(
    policyCode(() => aiGatewayOptions({ model: "anthropic/claude-fable-5", data: "confidential" })),
    "unknown_model",
  );
  assert.equal(
    policyCode(() => aiGatewayOptions({ model: "toString", data: "confidential" })),
    "unknown_model",
  );
});

test("the stop logs the model and the class, never a payload", () => {
  const lines: string[] = [];
  console.error = (line: string) => lines.push(line);
  policyCode(() => aiGatewayOptions({ model: "perplexity/sonar", data: "confidential" }));
  assert.deepEqual(JSON.parse(lines[0] ?? "{}"), {
    event: "ai_policy_blocked",
    code: "confidential_to_search",
    model: "perplexity/sonar",
    data: "confidential",
  });
});

test("EU is pinned only where an endpoint fits the call, so no call fails on region", () => {
  enforce("AI_GATEWAY_ENFORCE_EU_REGION");
  const eu = { scope: "zone", geoRegion: "eu" };
  // OpenAI's own embedding endpoint has EU, but no ZDR.
  assert.deepEqual(
    aiGatewayOptions({ model: "openai/text-embedding-3-small", data: "confidential" }).gateway
      .inferenceRegion,
    eu,
  );
  // With ZDR only Azure serves it, without a region: pinning EU would leave no provider.
  enforce("AI_GATEWAY_ENFORCE_ZDR");
  assert.equal(
    aiGatewayOptions({ model: "openai/text-embedding-3-small", data: "confidential" }).gateway
      .inferenceRegion,
    undefined,
  );
  // The language models and Perplexity have no EU endpoint today.
  assert.equal(
    aiGatewayOptions({ model: "openai/gpt-5.4", data: "confidential" }).gateway.inferenceRegion,
    undefined,
  );
  assert.equal(
    aiGatewayOptions({ model: "perplexity/sonar", data: "public_search" }).gateway.inferenceRegion,
    undefined,
  );
});
