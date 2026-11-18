import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { LANGUAGES, type Language } from "./language";

/**
 * "Sprog" in Fondsopsætning: one choice per fund, Dansk or English. Changed only by
 * the server after a rights check (the column cannot be written by users, 0085), and logged like
 * the fund's other settings. New runs are written in the new language; earlier texts stay as
 * they were written.
 */
export const setFundLanguage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ fundId: z.guid(), language: z.enum(LANGUAGES) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ language: Language }> => {
    const { requireFundCapability, writeAudit } = await import("@/lib/auth/access.server");
    const { getServiceClient } = await import("@/lib/supabase/admin.server");
    const access = await requireFundCapability(
      context.supabase,
      context.userId,
      data.fundId,
      "configure_fund",
    );
    if (access.language === data.language) return { language: data.language };
    const service = getServiceClient();
    // The audit row is written first: if it fails, nothing changes (writeAudit throws).
    await writeAudit(service, {
      fundId: access.fundId,
      actorType: "user",
      actorId: context.userId,
      action: "fund_language_changed",
      entity: "funds",
      entityId: access.fundId,
      payload: { before: access.language, after: data.language },
    });
    const { error } = await service
      .from("funds")
      .update({ language: data.language, updated_at: new Date().toISOString() })
      .eq("id", access.fundId);
    if (error) {
      console.error("[setFundLanguage]", error.message);
      try {
        await writeAudit(service, {
          fundId: access.fundId,
          actorType: "user",
          actorId: context.userId,
          action: "fund_language_not_saved",
          entity: "funds",
          entityId: access.fundId,
          payload: { after: data.language },
        });
      } catch (cause) {
        console.error("[setFundLanguage] not saved audit", cause);
      }
      throw new Error("Sproget kunne ikke gemmes. Prøv igen om lidt.");
    }
    return { language: data.language };
  });
