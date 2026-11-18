import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { callCheapGateway, HelperRejected } from "./cheap-gateway.server";
import { clipContext, THESIS_STEPS, thesisStepSystemPrompt } from "./thesis-steps";
import { serverText } from "@/lib/i18n/server-text";

/** One answer may cost at most this (about 0.15 kr). */
const THESIS_CHAT_BUDGET_USD = 0.03;

/**
 * "Spørg Interlect" på et trin i Ny investeringstese. Returnerer kun en tekst, som brugeren
 * selv kan kopiere; intet gemmes, og intet i kladden eller på skærmen ændres af svaret.
 * Admin og Lead (configure_fund), fordi tesen er fondens opsætning.
 */
export const askThesisStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fundId: z.guid(),
        step: z.enum(THESIS_STEPS),
        question: z
          .string()
          .trim()
          .min(2, serverText("fundServer.thesisChat.askSomething"))
          .max(2000),
        /** What the user has filled in so far, by step, to give the answer context. */
        context: z.record(z.string().max(40), z.string().max(4000)).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ answer: string }> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    try {
      const { content } = await callCheapGateway({
        fundId: data.fundId,
        credits: { userId: context.userId, loop: "fund_setup:thesis_chat" },
        system: thesisStepSystemPrompt(data.step),
        user: JSON.stringify({
          userQuestion: data.question,
          filledInSoFar: clipContext(data.context),
        }),
        maxOutputTokens: 900,
        budgetUsd: THESIS_CHAT_BUDGET_USD,
        // i18n-keep: the call's name in logs and the AI log, not shown to the person.
        label: "Hjælp til tesen",
        timeoutMs: 45_000,
      });
      const answer = content.trim();
      if (!answer) throw new Error(serverText("fundServer.common.aiNoAnswer"));
      return { answer };
    } catch (cause) {
      if (cause instanceof HelperRejected) throw new Error(cause.message);
      throw cause;
    }
  });
