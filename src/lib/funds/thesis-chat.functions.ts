import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFundCapability } from "@/lib/auth/access.server";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { HelperRejected } from "./cheap-gateway.server";
import { THESIS_STEPS } from "./thesis-steps";
import { suggestForStep, type ThesisStepAnswer } from "./thesis-suggest.server";
import { serverText } from "@/lib/i18n/server-text";

/**
 * "Spørg Interlect" på et trin i Ny investeringstese. Returnerer kun en tekst, som brugeren
 * selv kan kopiere; intet gemmes, og intet i kladden eller på skærmen ændres af svaret.
 * Admin og Lead (configure_fund), fordi tesen er fondens opsætning.
 * Kun med grundlag; ellers "ikke fundet" uden et modelkald (`suggestForStep`).
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
        /** What the user has written or chosen so far, by step (no starting values). */
        context: z.record(z.string().max(40), z.string().max(4000)).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ThesisStepAnswer> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    try {
      return await suggestForStep({
        fundId: data.fundId,
        credits: { userId: context.userId, loop: "fund_setup:thesis_chat" },
        step: data.step,
        question: data.question,
        context: data.context,
      });
    } catch (cause) {
      if (cause instanceof HelperRejected) throw new Error(cause.message);
      throw cause;
    }
  });
