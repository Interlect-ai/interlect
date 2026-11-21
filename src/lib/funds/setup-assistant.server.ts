import type { CallCredits } from "@/lib/ai/credits.server";
import { serverText } from "@/lib/i18n/server-text";
import { HelperRejected, callCheapGateway } from "./cheap-gateway.server";
import {
  ASSISTANT_OUTPUT_SCHEMA,
  ASSISTANT_SYSTEM,
  assistantUserPrompt,
  readAssistantOutput,
  type AssistantReply,
  type AssistantRequest,
} from "./setup-assistant";

/** Each answer has its own cap; the call reserves it in the credit ledger first. */
export const ASSISTANT_BUDGET_USD = 0.06;
const ASSISTANT_MAX_OUTPUT_TOKENS = 1_600;

/**
 * One answer from the Interlect-Assistent (the server function and the paid proof
 * `scripts/setup-assistant-eval.ts` use the same call). Words and at most one change, checked
 * against the page's snapshot; nothing is stored.
 */
export async function answerSetupAssistant(
  request: AssistantRequest,
  credits: { userId: string; loop: string } | CallCredits,
): Promise<AssistantReply & { costUsd: number | null }> {
  let content: string;
  let costUsd: number | null;
  try {
    ({ content, costUsd } = await callCheapGateway({
      fundId: request.fundId,
      credits,
      system: ASSISTANT_SYSTEM,
      user: assistantUserPrompt(request),
      schema: { name: "interlect_setup_assistant_v1", schema: ASSISTANT_OUTPUT_SCHEMA },
      maxOutputTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
      budgetUsd: ASSISTANT_BUDGET_USD,
      // i18n-keep: the call's name in logs and the AI log, not shown to the person.
      label: "Interlect-Assistent i Teamopsætning",
      timeoutMs: 45_000,
    }));
  } catch (cause) {
    if (cause instanceof HelperRejected) throw new Error(cause.message);
    throw cause;
  }
  try {
    return { ...readAssistantOutput(content, request.snapshot), costUsd };
  } catch (cause) {
    console.error(
      "[setup-assistant] unreadable answer",
      cause instanceof Error ? cause.message : cause,
    );
    throw new Error(serverText("fundServer.common.aiNoAnswer"));
  }
}
