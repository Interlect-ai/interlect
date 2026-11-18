import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { requireFundCapability } from "@/lib/auth/access.server";
import { screeningResearchModules } from "@/lib/analysis/public-research";
import { checkConfigLimits } from "./config-limits";
import { loadDraftFields } from "./config.functions";
import { DEFAULT_SCREENING_CARDS } from "./screening-setup";
import {
  buildScreeningCheckPrompt,
  codeScreeningIssues,
  mergeScreeningIssues,
  parseScreeningAiCheck,
  SCREENING_CHECK_JSON_SCHEMA,
  type ScreeningIssue,
  type ScreeningSetupForCheck,
} from "./screening-check";
import { paidHelperCall } from "./assist-calls.server";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/**
 * The AI help for the fund's whole screening ("løst NU"). The draft
 * step is "Ret med AI" (proposeConfigChange), which now also writes the "sådan screener vi"
 * instruction and the extra cards, and proposeResearchStrategy for the research questions. This
 * file adds the quality check: code's certain findings plus a strong model's reading, on the draft
 * as it is saved. Nothing is changed here. The customer sees no prices (P13); the call is paid
 * from the credits, recorded in the audit log and limited per fund per hour like the specialist
 * help. The trial run on an existing case is; the page is.
 */

const CHECK_BUDGET_USD = 0.12;
const SCREENING_ASSIST_AUDIT_ACTION = "fund_screening_assist";

export interface ScreeningCheckResult {
  /** True when the model read it and nothing needs fixing before publishing (notes may remain). */
  ready: boolean;
  issues: ScreeningIssue[];
  /** False when only code's checks ran (the model's answer could not be read). */
  aiChecked: boolean;
}

export const checkScreeningSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: z.guid(), configId: z.guid() }).parse(input))
  .handler(async ({ data, context }): Promise<ScreeningCheckResult> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    const { data: version, error: versionError } = await context.supabase
      .from("fund_config_versions")
      .select("id, status")
      .eq("id", data.configId)
      .eq("fund_id", data.fundId)
      .maybeSingle();
    if (versionError) throw new Error(serverText("fundServer.common.setupNotLoaded"));
    if (!version || version["status"] !== "draft") {
      throw new Error(serverText("fundServer.screening.draftOnlyCheck"));
    }
    const [draft, overrides] = await Promise.all([
      loadDraftFields(context.supabase, data.configId),
      context.supabase
        .from("research_module_overrides")
        .select("module_id, questions")
        .eq("config_version_id", data.configId)
        .eq("mode", "screening"),
    ]);
    if (overrides.error) throw new Error(serverText("fundServer.screening.questionsNotLoaded"));
    const ownQuestions = new Map(
      (overrides.data ?? []).map((row) => [
        row["module_id"] as string,
        row["questions"] as string[],
      ]),
    );
    const setup: ScreeningSetupForCheck = {
      thesis: draft.thesis,
      riskPosture: draft.riskPosture,
      stages: draft.stages,
      geographies: draft.geographies,
      sectors: draft.sectors,
      ticket: { minEur: draft.ticketMinEur, maxEur: draft.ticketMaxEur },
      dealbreakers: draft.dealbreakers,
      criteria: draft.criteria.map(({ key, label, description, category, weight }) => ({
        key,
        label,
        description,
        category,
        weight,
      })),
      gates: draft.gates,
      instruction: draft.screeningInstruction ?? "",
      cards: draft.screeningCards ?? [...DEFAULT_SCREENING_CARDS],
      research: screeningResearchModules.map((module) => ({
        moduleId: module.id,
        questions: ownQuestions.get(module.id) ?? [...module.questions],
      })),
    };
    const code = codeScreeningIssues(
      setup,
      checkConfigLimits(draft, requestLanguage()),
      requestLanguage(),
    );
    const prompt = buildScreeningCheckPrompt(setup);
    const content = await paidHelperCall(
      {
        fundId: data.fundId,
        userId: context.userId,
        configId: data.configId,
        step: "check",
        action: SCREENING_ASSIST_AUDIT_ACTION,
        tooLong: serverText("fundServer.screening.tooLongForCheck"),
      },
      {
        system: prompt.system,
        user: prompt.user,
        // v2: the prompt says "teamet" and calls the instruction "Instruktion", as the screen does.
        schema: { name: "interlect_screening_check_v2", schema: SCREENING_CHECK_JSON_SCHEMA },
        maxOutputTokens: 4_000,
        budgetUsd: CHECK_BUDGET_USD,
        // i18n-keep: the call's name in logs and the AI log, not shown to the person.
        label: "Tjek af screeningen",
        timeoutMs: 120_000,
      },
    );
    const ai = parseScreeningAiCheck(content);
    if (!ai) console.error("[screening-assist] the model's check could not be read");
    const issues = mergeScreeningIssues(setup, code, ai);
    return {
      // Without the model's reading, code alone cannot call the screening ready.
      ready: ai !== null && !issues.some((issue) => issue.severity === "fix"),
      issues,
      aiChecked: ai !== null,
    };
  });
