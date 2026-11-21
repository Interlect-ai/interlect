import {
  assertWithinBudget,
  estimateRequestMaximumUsd,
  type PricedModel,
} from "@/lib/analysis/budgets";
import { gatewayErrorSummary } from "@/lib/ai/gateway-log";
import { reserveCallCredits, sendCharged, type CallCredits } from "@/lib/ai/credits.server";
import { AiDataPolicyError, aiGatewayOptions } from "@/lib/ai/gateway-options";
import { postChatCompletion } from "@/lib/ai/model-call";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { outputLanguageDirective } from "@/lib/i18n/ai-language";
import { loadFundLanguage } from "@/lib/i18n/fund-language.server";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import type { Language } from "@/lib/i18n/language";
import { gatewayToken, missingGatewayToken } from "@/lib/ai/gateway-token";

/**
 * A small, capped model call for the editing helpers of the fund setup (proposals, the thesis
 * chat) and the committee memo's draft. It uses the cheap fixed model unless a helper names a stronger one (the drafts of the fund's
 * own specialists): these are not analyses, so they do not follow the fund's level,
 * and each call has its own price cap that is checked before and after the call.
 * The call reserves its maximum in the credit ledger (scope chat), so an empty balance
 * stops it like any other AI call.
 */
const MODEL = "openai/gpt-5.4-mini" as const;

/**
 * A failure whose message is meant for the user as it stands. `costUsd` is what the call is known
 * to have cost, so a caller that reserved for it books that instead of 0.
 */
export class HelperRejected extends Error {
  readonly costUsd: number | null;
  constructor(message: string, costUsd: number | null = null) {
    super(message);
    this.costUsd = costUsd;
  }
}

/** A call that failed after the provider answered; carries its known price like HelperRejected. */
export class HelperCallFailed extends Error {
  readonly costUsd: number | null;
  constructor(message: string, costUsd: number | null) {
    super(message);
    this.costUsd = costUsd;
  }
}

/** What a failed helper call is known to have cost; null when nothing is known. */
export function knownHelperCost(cause: unknown): number | null {
  return cause instanceof HelperRejected || cause instanceof HelperCallFailed
    ? cause.costUsd
    : null;
}

/** The caller's own reservation pays (the specialist helper): nothing to book here. */
const RESERVED_BY_CALLER: CallCredits = {
  charge() {},
  async settle() {},
};

export async function callCheapGateway(input: {
  /** The fund whose dictionary masks the call and whose usage the ledger shows. */
  fundId: string;
  /**
   * Who pays: the call reserves its maximum in the credit ledger for this user under
   * `loop` (e.g. "fund_setup:thesis_chat"), unless the caller has reserved for it already.
   */
  credits: { userId: string; loop: string } | "reserved_by_caller" | CallCredits;
  system: string;
  user: string;
  /** A strict JSON schema for structured output; omit for a plain text answer. */
  schema?: { name: string; schema: unknown };
  maxOutputTokens: number;
  budgetUsd: number;
  /** Names the call in budget and log messages. */
  label: string;
  timeoutMs?: number;
  /** A stronger model than the cheap one; ZDR rules and price caps apply as always. */
  model?: PricedModel;
  /** The call's name in the team's AI log; default "fund_setup". */
  flow?: string;
  /** The language to write in; default the team's (the committee memo passes it). */
  language?: Language;
}): Promise<{ content: string; costUsd: number | null }> {
  const token = gatewayToken();
  if (!token)
    throw missingGatewayToken("fund-setup helper", serverText("fundServer.common.gatewayMissing"));
  const model = input.model ?? MODEL;
  // What the helpers write lands in the fund's setup and on its pages, so it is written
  // in the fund's language (the Danish prompts are unchanged for a Danish fund).
  const language = input.language ?? (await loadFundLanguage(getServiceClient(), input.fundId));
  const system = `${input.system}${outputLanguageDirective(language)}`;
  const requestBody = {
    model,
    stream: false,
    max_tokens: input.maxOutputTokens,
    reasoning: { effort: "low" },
    providerOptions: aiGatewayOptions({ model, data: "confidential" }),
    messages: [
      { role: "system", content: system },
      { role: "user", content: input.user },
    ],
    ...(input.schema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: input.schema.name, strict: true, schema: input.schema.schema },
          },
        }
      : {}),
  };
  const estimate = estimateRequestMaximumUsd({
    model,
    requestBody,
    maxOutputTokens: input.maxOutputTokens,
  });
  assertWithinBudget(estimate, input.budgetUsd, input.label, requestLanguage());
  const credits =
    input.credits === "reserved_by_caller"
      ? RESERVED_BY_CALLER
      : "charge" in input.credits
        ? // The caller's own reservation pays and learns what the call cost.
          input.credits
        : await reserveCallCredits(getServiceClient(), {
            scope: "chat",
            fundId: input.fundId,
            userId: input.credits.userId,
            maxUsd: estimate.maxCostUsd,
            loop: input.credits.loop,
            model,
          });
  try {
    const redactor = await redactorForFund(input.fundId, input.flow ?? "fund_setup");

    let status: number | null = null;
    let finishReason: string | undefined;
    let gatewayError: unknown;
    let cost: number | null = null;
    let content: string | undefined;
    try {
      const { response, body, costUsd } = await sendCharged<{
        error?: { message?: string };
        choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
      }>(credits, () =>
        postChatCompletion({
          body: requestBody,
          redactor,
          token,
          signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
        }),
      );
      status = response.status;
      gatewayError = body.error;
      finishReason = body.choices?.[0]?.finish_reason;
      cost = costUsd;
      content = body.choices?.[0]?.message?.content;
      if (!response.ok || !content) throw new Error("empty_or_failed_response");
      if (finishReason === "length") {
        throw new HelperRejected(serverText("fundServer.gateway.cutOff"), cost);
      }
    } catch (cause) {
      // HelperRejected and a data rules stop (nothing sent) carry a message for the user.
      if (cause instanceof HelperRejected || cause instanceof AiDataPolicyError) throw cause;
      console.error(`[ai-gateway] ${input.label} failed`, {
        status,
        finishReason,
        error: gatewayErrorSummary(gatewayError),
        cause: cause instanceof Error ? cause.message : cause,
      });
      throw new HelperCallFailed(serverText("fundServer.common.aiNoAnswer"), cost);
    }
    if (cost !== null && cost > input.budgetUsd) {
      console.error(`[ai-gateway] ${input.label} over budget`, {
        costUsd: cost,
        capUsd: input.budgetUsd,
      });
      throw new HelperRejected(serverText("fundServer.gateway.overBudget"), cost);
    }
    return { content, costUsd: cost };
  } finally {
    await credits.settle();
  }
}
