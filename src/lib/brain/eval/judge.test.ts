import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { aiGatewayOptions } from "../../ai/gateway-options.ts";
import { JUDGE_FALLBACK_MODEL, JUDGE_MODEL, judgeCostUsd, judgeProviderOptions } from "./judge.ts";

const FLAGS = ["AI_GATEWAY_ENFORCE_ZDR", "AI_GATEWAY_ENFORCE_EU_REGION"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const flag of FLAGS) saved.set(flag, process.env[flag]);
  for (const flag of FLAGS) delete process.env[flag];
});

afterEach(() => {
  for (const flag of FLAGS) {
    const value = saved.get(flag);
    if (value === undefined) delete process.env[flag];
    else process.env[flag] = value;
  }
});

test("the judge models pass the data rules as confidential calls with ZDR (T-502)", () => {
  process.env["AI_GATEWAY_ENFORCE_ZDR"] = "true";
  for (const model of [JUDGE_MODEL, JUDGE_FALLBACK_MODEL]) {
    const options = aiGatewayOptions({ model, data: "confidential" });
    assert.equal(options.gateway.zeroDataRetention, true, model);
    assert.equal(options.gateway.disallowPromptTraining, true, model);
  }
});

test("the judge always asks for ZDR, also before AI_GATEWAY_ENFORCE_ZDR is on", () => {
  const base = aiGatewayOptions({ model: JUDGE_MODEL, data: "confidential" });
  assert.equal(base.gateway.zeroDataRetention, undefined);
  const options = judgeProviderOptions(base);
  assert.equal(options.gateway.zeroDataRetention, true);
  assert.equal(options.gateway.disallowPromptTraining, true);
});

test("the judge keeps the EU pin the data rules chose", () => {
  process.env["AI_GATEWAY_ENFORCE_ZDR"] = "true";
  process.env["AI_GATEWAY_ENFORCE_EU_REGION"] = "true";
  const options = judgeProviderOptions(
    aiGatewayOptions({ model: JUDGE_MODEL, data: "confidential" }),
  );
  assert.deepEqual(options.gateway.inferenceRegion, { scope: "zone", geoRegion: "eu" });
});

test("the judge's cost uses the shared price list", () => {
  // Sonnet 5.5: $2 in, $10 out per million tokens (AI Gateway catalog, 6 Oct 2026).
  assert.equal(judgeCostUsd(JUDGE_MODEL, 1_000_000, 100_000), 3);
  assert.equal(judgeCostUsd(JUDGE_FALLBACK_MODEL, 1_000_000, 100_000), 6);
});
