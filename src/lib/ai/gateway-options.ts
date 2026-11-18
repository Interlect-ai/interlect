import { aiModelPolicy, type AiModelPolicy } from "./zdr-models.ts";
import { serverText } from "../i18n/server-text.ts";

/**
 * Data rules for every AI Gateway call (plan, decision D4 5 Oct 2026).
 *
 * ZDR is only about what the AI provider may keep; we keep everything ourselves. Two kinds of
 * calls exist:
 * - "confidential": anything built from the customer's material (decks, notes, memos, decisions,
 *   financials, the fund's thesis, Brain). With AI_GATEWAY_ENFORCE_ZDR=true it is only sent with
 *   zeroDataRetention, and a model without a ZDR provider is stopped here, before anything leaves.
 * - "public_search": search terms for a search engine (Perplexity): public identity and short
 *   public claims only. Perplexity has no ZDR on the Gateway, so these calls never ask for it;
 *   they always set disallowPromptTraining. Only search models may be called this way, so a
 *   confidential call cannot dodge ZDR by calling itself a search.
 *
 * Team-wide ZDR in the AI Gateway dashboard must stay off: it applies to every request and would
 * make every Perplexity search fail. Per-request ZDR here is what enforces it.
 */
export type AiDataClass = "confidential" | "public_search";

/** Vercel Pro (bought 4 Oct 2026) allows per-request ZDR at no extra cost. Off until checked. */
export function shouldEnforceZdr(): boolean {
  return process.env["AI_GATEWAY_ENFORCE_ZDR"] === "true";
}

/**
 * Pins EU inference on the calls whose model has an EU endpoint that fits the call (with ZDR
 * when ZDR applies). Models without one keep the Gateway's routing instead of failing with 400.
 */
export function shouldEnforceEuRegion(): boolean {
  return process.env["AI_GATEWAY_ENFORCE_EU_REGION"] === "true";
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface GatewayOptions {
  [key: string]: JsonValue;
  disallowPromptTraining: true;
  zeroDataRetention?: true;
  inferenceRegion?: { scope: "zone"; geoRegion: "eu" };
}

export type AiPolicyCode =
  | "unknown_model"
  | "zdr_unavailable"
  | "training_not_excluded"
  | "search_model_required"
  | "confidential_to_search"
  /** The call went around the masking of personal data (model-call.ts). */
  | "not_masked";

/**
 * What a user sees when the data rules stopped a background job (Brain ingest, insights), in the
 * fund's language when the worker runs in it.
 */
export function aiPolicyBlockedText(): string {
  return serverText("appServer.ai.policyBlocked");
}

/** A call stopped before it was sent. The message is safe to show and to log (no payload). */
export class AiDataPolicyError extends Error {
  readonly code: AiPolicyCode;
  readonly model: string;

  constructor(code: AiPolicyCode, model: string, message: string) {
    super(message);
    this.name = "AiDataPolicyError";
    this.code = code;
    this.model = model;
  }
}

function blocked(code: AiPolicyCode, model: string, data: AiDataClass, message: string): never {
  console.error(JSON.stringify({ event: "ai_policy_blocked", code, model, data }));
  throw new AiDataPolicyError(code, model, message);
}

function requirePolicy(model: string, data: AiDataClass): AiModelPolicy {
  const policy = aiModelPolicy(model);
  if (!policy) {
    return blocked(
      "unknown_model",
      model,
      data,
      serverText("appServer.ai.unknownModel", { model }),
    );
  }
  if (!policy.noTraining) {
    return blocked(
      "training_not_excluded",
      model,
      data,
      serverText("appServer.ai.trainingNotExcluded", { model }),
    );
  }
  return policy;
}

/**
 * The `providerOptions` for one AI Gateway call. Spread provider-specific options next to it
 * (`{ ...aiGatewayOptions(...), openai: {...} }`); for the raw Chat Completions endpoint put the
 * result under `providerOptions` in the request body. Throws AiDataPolicyError instead of ever
 * sending a confidential call without ZDR while ZDR is enforced.
 */
export function aiGatewayOptions(call: { model: string; data: AiDataClass }): {
  gateway: GatewayOptions;
} {
  const { model, data } = call;
  const policy = requirePolicy(model, data);

  if (data === "public_search") {
    if (policy.kind !== "search") {
      return blocked(
        "search_model_required",
        model,
        data,
        serverText("appServer.ai.searchModelRequired", { model }),
      );
    }
    return {
      gateway: {
        disallowPromptTraining: true,
        ...(shouldEnforceEuRegion() && policy.eu ? { inferenceRegion: euRegion() } : {}),
      },
    };
  }

  if (policy.kind === "search") {
    return blocked(
      "confidential_to_search",
      model,
      data,
      serverText("appServer.ai.confidentialToSearch", { model }),
    );
  }
  const zdr = shouldEnforceZdr();
  if (zdr && !policy.zdr) {
    return blocked(
      "zdr_unavailable",
      model,
      data,
      serverText("appServer.ai.zdrUnavailable", { model }),
    );
  }
  const eu = shouldEnforceEuRegion() && (zdr ? policy.euWithZdr : policy.eu);
  return {
    gateway: {
      disallowPromptTraining: true,
      ...(zdr ? { zeroDataRetention: true as const } : {}),
      ...(eu ? { inferenceRegion: euRegion() } : {}),
    },
  };
}

function euRegion(): { scope: "zone"; geoRegion: "eu" } {
  return { scope: "zone", geoRegion: "eu" };
}
