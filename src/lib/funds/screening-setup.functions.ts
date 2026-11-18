import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { fundConfigErrorText } from "./db-errors";
import { screeningSetupSchema, SCREENING_INSTRUCTION_MAX } from "./screening-setup";
import { LANGUAGE_TAGS } from "@/lib/i18n/language";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/**
 * The fund's own screening in a draft: the "sådan screener vi" instruction and the
 * extra screening cards. Criteria, weights, gates and risk posture are saved with the rest of the
 * draft (saveFundConfigDraft), the screening's research questions with saveResearchModuleOverride.
 * Reading goes through getFundConfigs (screeningInstruction, screeningCards). The AI help (draft,
 * quality check, trial run) builds on this; the page is.
 */
const inputSchema = z.object({
  fundId: z.guid(),
  configId: z.guid(),
  instruction: z.string(),
  cards: z.array(z.string()),
});

export const saveFundScreeningSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const base = inputSchema.parse(input);
    // The person sees one Danish sentence about the field, never zod's raw report.
    const parsed = screeningSetupSchema.safeParse({
      instruction: base.instruction,
      cards: base.cards,
    });
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues[0]?.path[0] === "instruction"
          ? serverText("fundServer.screening.instructionTooLong", {
              max: SCREENING_INSTRUCTION_MAX.toLocaleString(LANGUAGE_TAGS[requestLanguage()]),
            })
          : serverText("fundServer.screening.cardsInvalid"),
      );
    }
    return { fundId: base.fundId, configId: base.configId, ...parsed.data };
  })
  .handler(async ({ data, context }) => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const { data: version, error: versionError } = await context.supabase
      .from("fund_config_versions")
      .select("id, status")
      .eq("id", data.configId)
      .eq("fund_id", data.fundId)
      .maybeSingle();
    if (versionError) throw new Error(serverText("fundServer.common.setupNotLoaded"));
    if (!version || version["status"] !== "draft") {
      throw new Error(serverText("fundServer.common.draftOnlyEdit"));
    }
    const { error } = await context.supabase.rpc("save_fund_screening_setup", {
      _config_version_id: data.configId,
      _instruction: data.instruction,
      _cards: data.cards,
    });
    if (error) {
      if (error.code !== "P0001")
        console.error("[save_fund_screening_setup]", error.code, error.message);
      throw new Error(
        fundConfigErrorText(error, serverText("fundServer.screening.notSaved"), {
          duplicateNames: false,
          language: requestLanguage(),
        }),
      );
    }
    return { ok: true as const };
  });
