import { createServerFn } from "@tanstack/react-start";
import { gatewayErrorSummary } from "@/lib/ai/gateway-log";
import { outputLanguageDirective } from "@/lib/i18n/ai-language";
import { loadFundLanguage } from "@/lib/i18n/fund-language.server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireFundCapability } from "@/lib/auth/access.server";
import { estimateRequestMaximumUsd, assertWithinBudget } from "@/lib/analysis/budgets";
import { aiGatewayOptions } from "@/lib/ai/gateway-options";
import { reserveCallCredits, sendCharged } from "@/lib/ai/credits.server";
import { postChatCompletion } from "@/lib/ai/model-call";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { researchModules, screeningResearchModules } from "@/lib/analysis/public-research";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import { gatewayToken, missingGatewayToken } from "@/lib/ai/gateway-token";

const MODEL = "openai/gpt-5.4-mini" as const;
// Ét kald dækker alle 13 moduler på én gang -- højere loft end det enkelte
// modul-redigeringskald (0.1), men stadig en engangsomkostning pr.
// fondsopsætning, ikke pr. case.
const RESEARCH_STRATEGY_BUDGET_USD = 0.3;

const researchModuleIdSchema = z.enum([
  "identity_registry",
  "filings_financials",
  "founders_team",
  "funding_ownership",
  "product_technology",
  "traction_customers_gtm",
  "market_competition",
  "legal_regulatory_reputation",
  "screening_identity_filings",
  "screening_founders_funding",
  "screening_product_technology",
  "screening_traction_commercial",
  "screening_market_mandate",
]);

const modeSchema = z.enum(["screening", "deep"]);

const ALL_MODULES: Array<{
  mode: "screening" | "deep";
  id: string;
  categories: readonly string[];
}> = [
  ...screeningResearchModules.map((module) => ({
    mode: "screening" as const,
    id: module.id,
    categories: module.categories,
  })),
  ...researchModules.map((module) => ({
    mode: "deep" as const,
    id: module.id,
    categories: module.categories,
  })),
];

const moduleProposalSchema = z.object({
  mode: modeSchema,
  moduleId: researchModuleIdSchema,
  questions: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
});

const researchStrategyProposalSchema = z.object({
  modules: z.array(moduleProposalSchema).min(1).max(ALL_MODULES.length),
});

export type ResearchModuleProposal = z.infer<typeof moduleProposalSchema>;
export type ResearchStrategyProposal = z.infer<typeof researchStrategyProposalSchema>;

async function requireDraftConfig(
  supabase: Parameters<typeof requireFundCapability>[0],
  userId: string,
  fundId: string,
  configId: string,
) {
  await requireFundCapability(supabase, userId, fundId, "configure_fund");
  const { data: config } = await supabase
    .from("fund_config_versions")
    .select("id, fund_id, status")
    .eq("id", configId)
    .eq("fund_id", fundId)
    .eq("status", "draft")
    .maybeSingle();
  if (!config) throw new Error(serverText("fundServer.common.draftNotFound"));
  return config;
}

/** Samme facon som FundResearchBrief i public-research.ts, men bygget af
 * klientens allerede-indlæste kladde-state (EditorState) -- ingen
 * server-side genopslag af fondsprofilen er nødvendigt, og forslaget
 * afspejler dermed det, administratoren rent faktisk er ved at redigere. */
const fundProfileInputSchema = z.object({
  thesis: z.string(),
  stages: z.array(z.string()),
  geographies: z.array(z.string()),
  sectors: z.array(z.string()),
  ticketMinEur: z.number().nullable(),
  ticketMaxEur: z.number().nullable(),
  ticketNote: z.string(),
  riskPosture: z.string(),
  dealbreakers: z.array(z.string()),
  gates: z.array(z.object({ label: z.string(), description: z.string(), treatment: z.string() })),
  criteria: z.array(z.object({ label: z.string(), description: z.string(), weight: z.number() })),
});

const proposeInputSchema = z.object({
  fundId: z.guid(),
  configId: z.guid(),
  profile: fundProfileInputSchema,
  instructions: z.string().trim().max(2000).optional(),
});

/**
 * Genererer skræddersyede research-spørgsmål for alle 13 offentlige
 * research-moduler PÅ ÉN GANG, ud fra netop denne fonds tese/mandat --
 * i stedet for de faste, generiske spørgsmål alle fonde ellers deler.
 * Ligesom proposeModulePromptOverride er dette et administrator-udløst
 * forslag, aldrig noget der genereres automatisk eller pr. case; admin ser
 * og kan redigere alt før det gemmes (saveResearchModuleOverrides).
 */
export const proposeResearchStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => proposeInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ResearchStrategyProposal> => {
    await requireDraftConfig(context.supabase, context.userId, data.fundId, data.configId);

    const { data: existingOverrides } = await context.supabase
      .from("research_module_overrides")
      .select("mode, module_id, questions")
      .eq("config_version_id", data.configId);
    const existingByKey = new Map(
      (existingOverrides ?? []).map((row) => [
        `${row["mode"] as string}:${row["module_id"] as string}`,
        row["questions"] as string[],
      ]),
    );

    const currentModules = ALL_MODULES.map((module) => ({
      mode: module.mode,
      moduleId: module.id,
      categories: module.categories,
      currentQuestions:
        existingByKey.get(`${module.mode}:${module.id}`) ??
        (module.mode === "screening"
          ? screeningResearchModules.find((m) => m.id === module.id)!.questions
          : researchModules.find((m) => m.id === module.id)!.questions),
    }));

    return generateResearchStrategy(
      data.fundId,
      context.userId,
      data.profile,
      currentModules,
      data.instructions,
    );
  });

async function generateResearchStrategy(
  fundId: string,
  userId: string,
  profile: z.infer<typeof fundProfileInputSchema>,
  currentModules: Array<{
    mode: "screening" | "deep";
    moduleId: string;
    categories: readonly string[];
    currentQuestions: readonly string[];
  }>,
  instructions: string | undefined,
): Promise<ResearchStrategyProposal> {
  const token = gatewayToken();
  if (!token)
    throw missingGatewayToken(
      "research-module-override",
      serverText("fundServer.common.gatewayMissing"),
    );
  const maxOutputTokens = 6_000;
  // i18n-keep: prompt to the model; a fund in English gets the language rule last.
  const system = `Du er Interlect.ai's specialist i at skræddersy research-strategien for et investeringsteam. Teamet har 13 faste research-moduler (5 til screening, 8 til dyb analyse), som i dag stiller de samme generiske spørgsmål uanset investeringstesen. Din opgave er at omskrive hvert moduls spørgsmålsliste, så den konkret afspejler DETTE teams erklærede investeringstese, sektorer, stadier, ticket-størrelse, risikotolerance og mandatregler -- ikke generiske formuleringer. Bevar hvert moduls faglige fokus (dets kategorier); tilføj eller omskriv spørgsmål, fjern ikke uden grund, og bevar samme antal spørgsmål eller færre pr. modul, aldrig flere end 6. Administratorens eventuelle instruktioner nedenfor er betroet input -- følg dem som en kollegas ønske. Returnér udelukkende JSON med ét objekt pr. modul (mode, moduleId, questions) for ALLE 13 moduler -- ingen forklarende tekst uden for strukturen. Skriv på engelsk, samme sprog som de nuværende spørgsmål, så de fortsat kan sendes direkte til researchmodellen.`;
  // The draft is written in the fund's language (unchanged prompt for a Danish fund).
  const languageDirective = outputLanguageDirective(
    await loadFundLanguage(getServiceClient(), fundId),
  );
  const prompt = JSON.stringify({
    task: "generate_fund_research_strategy",
    fundProfile: profile,
    // i18n-keep: prompt to the model; a fund in English gets the language rule last.
    instructions: instructions ?? "Ingen yderligere instruktioner -- brug investeringstesen alene.",
    modules: currentModules,
  });
  const schema = researchStrategyJsonSchema();
  const requestBody = {
    model: MODEL,
    stream: false,
    max_tokens: maxOutputTokens,
    reasoning: { effort: "low" },
    providerOptions: aiGatewayOptions({ model: MODEL, data: "confidential" }),
    messages: [
      { role: "system", content: `${system}${languageDirective}` },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "interlect_research_strategy_v1", strict: true, schema },
    },
  } as const;
  const estimate = estimateRequestMaximumUsd({ model: MODEL, requestBody, maxOutputTokens });
  // i18n-keep: the call's name in logs and the AI log, not shown to the person.
  assertWithinBudget(
    estimate,
    RESEARCH_STRATEGY_BUDGET_USD,
    "Generering af forskningsstrategi",
    requestLanguage(),
  );
  const credits = await reserveCallCredits(getServiceClient(), {
    scope: "chat",
    fundId,
    userId,
    maxUsd: estimate.maxCostUsd,
    loop: "fund_setup:research_strategy",
    model: MODEL,
  });
  try {
    const {
      response,
      body,
      costUsd: cost,
    } = await sendCharged<{
      error?: { message?: string };
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    }>(credits, async () =>
      postChatCompletion({
        body: requestBody,
        redactor: await redactorForFund(fundId, "fund_setup"),
        token,
        signal: AbortSignal.timeout(90_000),
      }),
    );
    const content = body.choices?.[0]?.message?.content;
    if (!response.ok || !content) {
      console.error("[ai-gateway]", gatewayErrorSummary(body.error));
      throw new Error(serverText("fundServer.research.aiFailed"));
    }
    if (body.choices?.[0]?.finish_reason === "length") {
      throw new Error(serverText("fundServer.common.interrupted"));
    }
    const parsed = researchStrategyProposalSchema.parse(JSON.parse(content));
    if (cost !== null && cost > RESEARCH_STRATEGY_BUDGET_USD) {
      throw new Error(serverText("fundServer.research.overBudget"));
    }
    return parsed;
  } finally {
    await credits.settle();
  }
}

function researchStrategyJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["modules"],
    properties: {
      modules: {
        type: "array",
        minItems: ALL_MODULES.length,
        maxItems: ALL_MODULES.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["mode", "moduleId", "questions"],
          properties: {
            mode: { type: "string", enum: ["screening", "deep"] },
            moduleId: { type: "string", enum: researchModuleIdSchema.options },
            questions: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: { type: "string", minLength: 1, maxLength: 300 },
            },
          },
        },
      },
    },
  };
}

const saveInputSchema = z.object({
  fundId: z.guid(),
  configId: z.guid(),
  modules: z.array(moduleProposalSchema).min(1),
});

/** Gemmer én eller flere modulers spørgsmål -- bruges både til at acceptere
 * hele det konsoliderede forslag på én gang, og til at gemme finjustering af
 * ét enkelt modul bagefter. */
export const saveResearchModuleOverrides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => saveInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireDraftConfig(context.supabase, context.userId, data.fundId, data.configId);
    const { error } = await context.supabase.from("research_module_overrides").upsert(
      data.modules.map((module) => ({
        config_version_id: data.configId,
        mode: module.mode,
        module_id: module.moduleId,
        questions: module.questions,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "config_version_id,mode,module_id" },
    );
    if (error) throw new Error(serverText("fundServer.research.notSaved"));
    return { ok: true };
  });

const resetInputSchema = z.object({
  fundId: z.guid(),
  configId: z.guid(),
  mode: modeSchema,
  moduleId: researchModuleIdSchema,
});

export const resetResearchModuleOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => resetInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireDraftConfig(context.supabase, context.userId, data.fundId, data.configId);
    const { error } = await context.supabase
      .from("research_module_overrides")
      .delete()
      .eq("config_version_id", data.configId)
      .eq("mode", data.mode)
      .eq("module_id", data.moduleId);
    if (error) throw new Error(serverText("fundServer.research.notReset"));
    return { ok: true };
  });
