/**
 * The committee memo's AI draft: the model call behind `runMemoDraft` (draft.ts), shared
 * by the server function (`draftMemoWithAi` in memo.functions.ts) and the paid proof
 * (`scripts/memo-draft-eval.ts`), so the proof runs exactly the product's code.
 *
 * The call goes the way every helper call goes (`callCheapGateway`): masked with the team's
 * dictionary before it leaves, written to the team's AI log as "committee_memo",
 * paid from the credit ledger with its maximum reserved first, and capped in price before
 * and after. Used-up credits or an AI that does not answer never stop the memo: the draft then holds
 * the proposer's own text (`runMemoDraft`).
 */
import { CreditsExhaustedError } from "@/lib/ai/credits.server";
import { AiUseLimitError } from "@/lib/ai/usage-limits.server";
import { callCheapGateway, knownHelperCost } from "@/lib/funds/cheap-gateway.server";
import type { Language } from "@/lib/i18n/language";
import type { MemoModel } from "./memo-model";
import {
  MEMO_DRAFT_BUDGET_USD,
  MEMO_DRAFT_MAX_OUTPUT_TOKENS,
  MEMO_DRAFT_MODEL,
  MEMO_DRAFT_SCHEMA,
  memoDraftSystemPrompt,
  runMemoDraft,
  type MemoDraftResult,
  type MemoDraftStop,
  type MemoDraftTrace,
} from "./draft";

/**
 * Used-up credits are "credits" (the reservation was refused); the person's or team's hourly AI
 * limit is "limit"; anything else is "unavailable".
 */
export function memoDraftStop(cause: unknown): MemoDraftStop {
  if (cause instanceof CreditsExhaustedError) return "credits";
  if (cause instanceof AiUseLimitError) return "limit";
  // Only our own message: the call's errors never carry the team's text.
  console.error("[memo-draft] no AI draft, the proposer's own text is used", {
    error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
  });
  return "unavailable";
}

export async function draftMemoProse(input: {
  fundId: string;
  /** Who pays: the person who makes the memo (credit ledger, scope chat). */
  credits: { userId: string } | "reserved_by_caller";
  /** The model with the proposer's stored input (`withProposerInput`). */
  model: MemoModel;
  /** The team's language. */
  language: Language;
  trace?: MemoDraftTrace;
}): Promise<MemoDraftResult> {
  return runMemoDraft({
    model: input.model,
    language: input.language,
    trace: input.trace,
    stopOf: memoDraftStop,
    call: async (user) => {
      try {
        const { content, costUsd } = await callCheapGateway({
          fundId: input.fundId,
          credits:
            input.credits === "reserved_by_caller"
              ? "reserved_by_caller"
              : { userId: input.credits.userId, loop: "case:committee_memo" },
          system: memoDraftSystemPrompt(input.language),
          user,
          schema: { name: "interlect_committee_memo_draft_v1", schema: MEMO_DRAFT_SCHEMA },
          maxOutputTokens: MEMO_DRAFT_MAX_OUTPUT_TOKENS,
          budgetUsd: MEMO_DRAFT_BUDGET_USD,
          model: MEMO_DRAFT_MODEL,
          // i18n-keep: the call's name in logs and budget messages, not shown to the person.
          label: "Komitémemo: udkast",
          flow: "committee_memo",
          language: input.language,
          timeoutMs: 60_000,
        });
        if (input.trace) input.trace.costUsd += costUsd ?? 0;
        return content;
      } catch (cause) {
        if (input.trace) input.trace.costUsd += knownHelperCost(cause) ?? 0;
        throw cause;
      }
    },
  });
}
