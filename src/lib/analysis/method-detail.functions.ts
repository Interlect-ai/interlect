import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shouldEnforceZdr } from "@/lib/ai/gateway-options";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { forbidden, loadAccessForFund } from "@/lib/auth/access.server";
import { canReadPrompts } from "./prompt-access";
import { mapProfile, type ConfigData } from "./screening.functions";
import { loadFundRunPlans } from "./run-plan.server";
import {
  buildScreeningPrompt,
  type ScreeningCaseInput,
  type DeepAnalysisPromptInput,
} from "./prompt";
import { specialistResearchQuestions } from "./specialist-research";
import { cardDataResearchQuestion } from "./card-data";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/language";
import {
  buildInvestmentCommitteeSynthesisPrompt,
  buildSpecialistPrompt,
  globalDeepInstruction,
} from "./specialist-prompts";
import { loadSpecialistSet } from "./specialist-set.server";
import {
  buildFundResearchBrief,
  buildResearchMessages,
  getResearchModuleOverrides,
  PUBLIC_RESEARCH_MODEL,
  researchModules,
  screeningResearchModules,
  SCREENING_PUBLIC_RESEARCH_MODEL,
} from "./public-research";
import type { FundProfile } from "@/lib/funds/profiles";
import type { ScoreCategory } from "@/lib/domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverText } from "@/lib/i18n/server-text";
import { internalPagesEnabled } from "@/lib/internal/internal-pages";

const fundIdSchema = z.guid();

/** Én repræsentativ, opdigtet case -- delt af screening-, specialist- og
 * synteseprompten nedenfor, udelukkende så de rigtige prompt-byggefunktioner
 * kan kaldes og vise en bogstavelig streng. Aldrig en rigtig case. */
function placeholderCaseInput(): ScreeningCaseInput {
  return {
    caseId: "00000000-0000-0000-0000-000000000000",
    companyName: "Eksempelvirksomhed ApS",
    website: "https://eksempel.dk",
    stage: "Seed",
    intakeSources: ["manual"],
    evidence: [],
    relatedPastCases: [],
  };
}

function placeholderPromptInput(): DeepAnalysisPromptInput {
  return {
    caseInput: placeholderCaseInput(),
    screening: {
      runId: "eksempel-screening",
      overallScore: null,
      recommendation: null,
      rationale: null,
      inputEvidenceIds: [],
      snapshot: null,
    },
  };
}

export interface AnalysisMethodResearchModule {
  mode: "screening" | "deep";
  moduleId: string;
  categories: string[];
  questions: string[];
  isCustomized: boolean;
  /** Den bogstavelige besked til Perplexity, med fondens rigtige brief og en eksempelcase. */
  system: string;
  user: string;
}

export interface AnalysisMethodSpecialistModule {
  /** A standard module id, or the fund's own key (`custom_…`). */
  id: string;
  kind: "standard" | "custom";
  title: string;
  categories: ScoreCategory[];
  isCustomized: boolean;
  system: string;
  user: string;
}

/** Admin only: the literal prompts the models receive. */
export interface AnalysisMethodDetail {
  profile: FundProfile;
  researchModel: { screening: string; deep: string };
  assessmentModel: { screening: string; deep: string };
  researchModules: AnalysisMethodResearchModule[];
  screeningPrompt: { system: string; user: string };
  globalDeepPreamble: string;
  specialistModules: AnalysisMethodSpecialistModule[];
  synthesisPrompt: { system: string; user: string };
}

async function loadActiveConfig(
  supabase: SupabaseClient,
  fundId: string,
): Promise<{ config: ConfigData; profile: FundProfile }> {
  const { data: configRow, error: configError } = await supabase
    .from("fund_config_versions")
    .select(
      `id, fund_id, profile_key, version, funds(name, language),
        fund_mandates(thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur, ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture, strategy_type, stage_expectations, dealbreakers, screening_instruction),
        mandate_gates(gate_key, label, description, treatment, sort_order),
        assessment_criteria(criterion_key, label, description, score_category, weight, sort_order, code_anchor)`,
    )
    .eq("fund_id", fundId)
    .eq("status", "active")
    .single();
  if (configError || !configRow)
    throw new Error(serverText("analysisServer.method.profileNotFound"));
  const config = configRow as unknown as ConfigData;
  return { config, profile: mapProfile(config) };
}

/**
 * Admin only (/intern/prompts): the literal text of the whole analysis chain, built by calling
 * the same prompt functions the analysis uses with the fund's own published profile and a
 * representative empty case. The role is checked on the server before any prompt is built.
 */
export const getAnalysisPromptDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ fundId: fundIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<AnalysisMethodDetail> => {
    const access = await loadAccessForFund(context.supabase, context.userId, data.fundId);
    if (!access) forbidden(serverText("analysisServer.method.noMembership"));
    if (!canReadPrompts(access.roles)) forbidden(serverText("analysisServer.method.adminOnly"));
    // The prompt chain belongs to /intern/prompts, which customers never get.
    if (!internalPagesEnabled(process.env))
      forbidden(serverText("analysisServer.method.adminOnly"));

    const { config, profile } = await loadActiveConfig(context.supabase, data.fundId);
    const [specialistSet, researchOverrides] = await Promise.all([
      loadSpecialistSet(context.supabase, config.id),
      getResearchModuleOverrides(context.supabase, config.id),
    ]);

    const plans = await loadFundRunPlans(context.supabase, data.fundId);
    const promptInput = placeholderPromptInput();
    const screeningPrompt = buildScreeningPrompt(profile, promptInput.caseInput);

    const fundResearchBrief = buildFundResearchBrief(profile);
    // The fund's own specialists' questions, as the deep research adds them.
    const specialistQuestions = specialistResearchQuestions(
      specialistSet.set,
      fundResearchBrief,
      profile.screeningInstruction,
    );
    // With ZDR on, the topics the last run stored for this setup (read with the service
    // role, after the admin check above); none stored yet = the placeholder.
    let storedTopics: string[] | null = null;
    if (shouldEnforceZdr()) {
      const [{ getServiceClient }, { loadStoredSearchTopics }, { searchTopicsKey }] =
        await Promise.all([
          import("@/lib/supabase/admin.server"),
          import("./search-topics.server"),
          import("./search-topics"),
        ]);
      storedTopics = await loadStoredSearchTopics(
        getServiceClient(),
        data.fundId,
        await searchTopicsKey(fundResearchBrief),
      );
    }
    const exampleCompany = promptInput.caseInput;
    const describeResearchModule = (
      mode: "screening" | "deep",
      module: { id: string; categories: readonly string[]; questions: readonly string[] },
    ): AnalysisMethodResearchModule => {
      const override = researchOverrides.get(`${mode}:${module.id}`);
      const own = mode === "deep" ? (specialistQuestions.get(module.id) ?? []) : [];
      // The card question stays next to the team's own text, as at a run.
      const cardQuestion = override && mode === "deep" ? cardDataResearchQuestion(module.id) : null;
      const base = override
        ? cardQuestion && !override.questions.includes(cardQuestion)
          ? [...override.questions, cardQuestion]
          : override.questions
        : module.questions;
      const questions = [...base, ...own.filter((question) => !base.includes(question))];
      const messages = buildResearchMessages(
        {
          companyName: exampleCompany.companyName,
          website: exampleCompany.website ?? null,
          stage: exampleCompany.stage ?? "Ukendt",
          mode,
          fundResearchBrief,
          language: profile.language ?? DEFAULT_LANGUAGE,
          // With ZDR on the brief is not sent; a ZDR step writes the topics at each run.
          searchTopics: shouldEnforceZdr()
            ? storedTopics?.length
              ? storedTopics
              : // i18n-keep: part of a prompt shown as it is sent (Danish prompts).
                [
                  "<neutrale søgeemner, skrives af et ZDR-trin ved første kørsel med denne opsætning>",
                ]
            : null,
        },
        { id: module.id, categories: module.categories, questions },
      );
      return {
        mode,
        moduleId: module.id,
        categories: [...module.categories],
        questions,
        isCustomized: Boolean(override) || own.length > 0,
        system: messages.system,
        user: prettyJson(messages.user),
      };
    };
    const orderedResearchModules: AnalysisMethodResearchModule[] = [
      ...screeningResearchModules.map((module) => describeResearchModule("screening", module)),
      ...researchModules.map((module) => describeResearchModule("deep", module)),
    ];

    const specialistDetails: AnalysisMethodSpecialistModule[] = specialistSet.set.map((module) => {
      const prompt = buildSpecialistPrompt(profile, promptInput, module);
      return {
        id: module.id,
        kind: module.kind ?? "standard",
        title: module.title,
        categories: module.categories,
        isCustomized: module.kind === "custom" || specialistSet.overrides.has(module.id),
        system: prompt.system,
        user: prettyJson(prompt.user),
      };
    });

    const synthesisPrompt = buildInvestmentCommitteeSynthesisPrompt(
      profile,
      promptInput,
      [],
      [],
      specialistSet.set,
    );

    return {
      profile,
      researchModel: { screening: SCREENING_PUBLIC_RESEARCH_MODEL, deep: PUBLIC_RESEARCH_MODEL },
      assessmentModel: { screening: plans.screening.model, deep: plans.deep.model },
      researchModules: orderedResearchModules,
      screeningPrompt: { ...screeningPrompt, user: prettyJson(screeningPrompt.user) },
      globalDeepPreamble: globalDeepInstruction(profile),
      specialistModules: specialistDetails,
      synthesisPrompt: { ...synthesisPrompt, user: prettyJson(synthesisPrompt.user) },
    };
  });

/** User-beskederne er kompakt JSON; på siden skal de kunne læses. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
