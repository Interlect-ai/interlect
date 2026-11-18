/** The ZDR call behind the research plan. The rules and the filter are in research-plan.ts. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonSchema, Output } from "ai";
import { AiDataPolicyError, aiGatewayOptions } from "@/lib/ai/gateway-options";
import { generateText, maskedModel } from "@/lib/ai/model-call";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import {
  assertWithinBudget,
  budgetCharge,
  estimateRequestMaximumUsd,
  type RequestBudgetEstimate,
} from "@/lib/analysis/budgets";
import { extractGatewayCostUsd } from "@/lib/analysis/gateway-response";
import { outputLanguageTag } from "@/lib/i18n/ai-language";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/language";
import type { AiRunKind, AiTier } from "./model-tiers";
import type { PricedModel } from "./budgets";
import type { TopicsBrief } from "./search-topics";
import {
  confidentialFundTexts,
  PLAN_BUDGET_USD,
  PLAN_MAX_OUTPUT_TOKENS,
  PLAN_QUESTIONS_PER_MODULE,
  PLAN_RESEARCH_SHARE,
  PLAN_TIMEOUT_MS,
  RESEARCH_PLAN_MODELS,
  researchPlanPrompt,
  researchPlanSchema,
  researchPlanSystemPrompt,
  sanitizeResearchPlan,
  type PlanFundSetup,
  type RawResearchPlan,
  type ResearchPlan,
} from "./research-plan";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";

/** The case's own text the planner reads, per kind (deck, website, registry). */
const MATERIAL_MAX_CHARS = 8_000;
const MATERIAL_SCAN_LIMIT = 200;
/** Time for the material and the dictionary on top of the model call's own limit. */
const STEP_MARGIN_MS = 10_000;
/** Source types that carry registry data (Danish CVR and the other countries' registers). */
const REGISTRY_SOURCE_TYPES = ["cvr_stamdata", "cvr_regnskab", "registry", "registry_regnskab"];

export type ResearchPlanOutcome =
  | { status: "ok"; plan: ResearchPlan; actualCostUsd: number | null; chargeUsd: number }
  | { status: "reused"; plan: ResearchPlan; chargeUsd: 0 }
  | { status: "skipped" | "failed"; reason: string; plan: null; chargeUsd: number };

/** The case's own material as text: deck, website and registry data, each capped. */
async function loadPlanMaterial(service: SupabaseClient, fundId: string, caseId: string) {
  const [deck, website, registry] = await Promise.all([
    service
      .from("evidence_items")
      .select("claim, excerpt")
      .eq("case_id", caseId)
      .eq("fund_id", fundId)
      .not("document_id", "is", null)
      .limit(MATERIAL_SCAN_LIMIT),
    service
      .from("evidence_items")
      .select("claim, excerpt, sources!inner(source_type)")
      .eq("case_id", caseId)
      .eq("fund_id", fundId)
      .eq("sources.source_type", "company_website")
      .limit(MATERIAL_SCAN_LIMIT),
    service
      .from("evidence_items")
      .select("claim, sources!inner(source_type)")
      .eq("case_id", caseId)
      .eq("fund_id", fundId)
      .in("sources.source_type", REGISTRY_SOURCE_TYPES)
      .limit(MATERIAL_SCAN_LIMIT),
  ]);
  for (const [name, result] of [
    ["deck", deck],
    ["website", website],
    ["registry", registry],
  ] as const) {
    if (result.error)
      console.error(`[research-plan] ${name} text unavailable`, result.error.message);
  }
  const text = (rows: unknown, withExcerpt: boolean) =>
    ((rows as Array<Record<string, unknown>> | null) ?? [])
      .map((row) =>
        withExcerpt
          ? `${row["claim"] ?? ""} ${row["excerpt"] ?? ""}`.trim()
          : String(row["claim"] ?? ""),
      )
      .filter(Boolean)
      .join("\n")
      .slice(0, MATERIAL_MAX_CHARS);
  return {
    deck: text(deck.data, true),
    website: text(website.data, true),
    registry: text(registry.data, false),
  };
}

interface PlanInput {
  service: SupabaseClient;
  fundId: string;
  caseId: string;
  kind: AiRunKind;
  tier: AiTier;
  setup: PlanFundSetup;
  brief: TopicsBrief;
  company: { name: string; website: string | null; stage: string; identity: unknown };
  modules: ReadonlyArray<{ id: string; questions: readonly string[] }>;
  reuse?: ResearchPlan | null;
  /** The run's research budget; the plan takes at most PLAN_RESEARCH_SHARE of it. */
  researchBudgetUsd: number;
}

/**
 * Writes the plan with a ZDR model. Never throws: a failure means no plan, and the research runs
 * on its fixed questions. The data rules (aiGatewayOptions) stop a model without ZDR before
 * anything is sent. A plan stored by an earlier attempt with the same model is reused unpaid. The
 * whole step (material, dictionary and call) has one time limit, so it can never hold up the run.
 */
export async function generateResearchPlan(input: PlanInput): Promise<ResearchPlanOutcome> {
  const model = RESEARCH_PLAN_MODELS[input.kind][input.tier];
  if (input.reuse && input.reuse.model === model) {
    return { status: "reused", plan: input.reuse, chargeUsd: 0 };
  }
  const availableUsd = Math.min(
    PLAN_BUDGET_USD[input.kind],
    input.researchBudgetUsd * PLAN_RESEARCH_SHARE,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ResearchPlanOutcome>((resolve) => {
    timer = setTimeout(() => {
      console.error("[research-plan] the step passed its time limit");
      // The call may still be billed: charge the most it may cost.
      resolve({
        status: "failed",
        reason: serverText("analysisServer.plan.notInTime"),
        plan: null,
        chargeUsd: availableUsd,
      });
    }, PLAN_TIMEOUT_MS[input.kind] + STEP_MARGIN_MS);
  });
  try {
    return await Promise.race([writePlan(input, model, availableUsd), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function writePlan(
  input: PlanInput,
  model: PricedModel,
  availableUsd: number,
): Promise<ResearchPlanOutcome> {
  const { profile } = input.setup;
  if (profile.criteria.length === 0 && profile.gates.length === 0) {
    return {
      status: "skipped",
      reason: serverText("analysisServer.plan.noCriteriaOrGates"),
      plan: null,
      chargeUsd: 0,
    };
  }
  const maxOutputTokens = PLAN_MAX_OUTPUT_TOKENS[input.kind];
  const moduleIds = input.modules.map((module) => module.id);
  const schema = researchPlanSchema(moduleIds);
  const system = researchPlanSystemPrompt(input.kind);
  let estimate: RequestBudgetEstimate | null = null;
  try {
    const material = await loadPlanMaterial(input.service, input.fundId, input.caseId);
    const prompt = researchPlanPrompt(
      input.setup,
      {
        companyName: input.company.name,
        website: input.company.website,
        stage: input.company.stage,
        identity: input.company.identity,
        deck: material.deck,
        website_text: material.website,
        registry: material.registry,
      },
      input.modules,
      outputLanguageTag(profile.language ?? DEFAULT_LANGUAGE),
    );
    estimate = estimateRequestMaximumUsd({
      model,
      requestBody: { model, system, prompt, maxOutputTokens, schema },
      maxOutputTokens,
    });
    try {
      assertWithinBudget(estimate, availableUsd, "Researchplanen", requestLanguage());
    } catch {
      return {
        status: "skipped",
        reason: serverText("analysisServer.plan.tooLong"),
        plan: null,
        chargeUsd: 0,
      };
    }
    const redactor = await redactorForFund(input.fundId, "research_plan", input.service);
    const gatewayOptions = aiGatewayOptions({ model, data: "confidential" });
    const result = await generateText({
      // An SDK retry would be a second paid call the price check never counts.
      maxRetries: 0,
      // Questions go to a public search engine: placeholders stay placeholders here, and a
      // question with one is dropped. The brief and hypotheses are restored afterwards.
      model: maskedModel(model, redactor, { restore: false }),
      system,
      prompt,
      maxOutputTokens,
      providerOptions: { ...gatewayOptions, openai: { reasoningEffort: "low" } },
      abortSignal: AbortSignal.timeout(PLAN_TIMEOUT_MS[input.kind]),
      output: Output.object({
        name: "interlect_research_plan_v1",
        schema: jsonSchema<RawResearchPlan>(schema as unknown as Parameters<typeof jsonSchema>[0]),
      }),
    });
    const actualCostUsd = extractGatewayCostUsd({ providerMetadata: result.providerMetadata });
    const raw = result.output;
    if (!raw || typeof raw !== "object") throw new Error("Planen var tom.");
    const plan = sanitizeResearchPlan(raw, {
      profile,
      brief: input.brief,
      confidential: confidentialFundTexts(input.setup),
      moduleIds,
      perModule: PLAN_QUESTIONS_PER_MODULE[input.kind][input.tier],
      model,
      restore: (text) => redactor.restore(text),
    });
    return { status: "ok", plan, actualCostUsd, chargeUsd: budgetCharge(actualCostUsd, estimate) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof AiDataPolicyError) {
      console.error("[research-plan] blocked by the data rules", cause.code);
      return {
        status: "failed",
        reason: serverText("analysisServer.common.stoppedByDataRules"),
        plan: null,
        chargeUsd: 0,
      };
    }
    // A cut-off or unreadable answer says why (finish reason and tokens), never the text.
    const details = cause as { finishReason?: unknown; usage?: unknown } | null;
    console.error("[research-plan] failed", message, {
      finishReason: details?.finishReason ?? null,
      usage: details?.usage ?? null,
    });
    // The call may have been billed even if the answer was lost: charge the maximum.
    return {
      status: "failed",
      reason: serverText("analysisServer.plan.failed", { reason: message.slice(0, 160) }),
      plan: null,
      chargeUsd: estimate?.maxCostUsd ?? 0,
    };
  }
}
