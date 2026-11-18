import { createServerFn } from "@tanstack/react-start";
import { gatewayErrorSummary } from "@/lib/ai/gateway-log";
import { outputLanguageDirective } from "@/lib/i18n/ai-language";
import { loadFundLanguage } from "@/lib/i18n/fund-language.server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { loadAccessForFund, requireFundCapability } from "@/lib/auth/access.server";
import { hasCapability } from "@/lib/domain/workflow";
import { estimateRequestMaximumUsd, assertWithinBudget } from "@/lib/analysis/budgets";
import { aiGatewayOptions } from "@/lib/ai/gateway-options";
import { reserveCallCredits, sendCharged } from "@/lib/ai/credits.server";
import { postChatCompletion } from "@/lib/ai/model-call";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { specialistModules, type SpecialistModuleId } from "@/lib/analysis/specialist-prompts";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import { gatewayToken, missingGatewayToken } from "@/lib/ai/gateway-token";

const MODEL = "openai/gpt-5.4-mini" as const;
const OVERRIDE_BUDGET_USD = 0.1;

const specialistModuleIdSchema = z.enum([
  "people_team",
  "product_market_gtm",
  "technology_risk",
  "fund_finance_deal",
]);

const moduleOverrideProposalSchema = z.object({
  mandate: z.array(z.string().trim().min(1).max(400)).min(1).max(12),
  evidenceTests: z.array(z.string().trim().min(1).max(400)).min(1).max(12),
  riskAreas: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
});

export type ModuleOverrideProposal = z.infer<typeof moduleOverrideProposalSchema>;

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

function effectiveDefaultText(moduleId: SpecialistModuleId) {
  const module = specialistModules.find((candidate) => candidate.id === moduleId);
  if (!module) throw new Error(serverText("fundServer.common.moduleNotFound"));
  return {
    mandate: module.mandate,
    evidenceTests: module.evidenceTests,
    riskAreas: module.riskAreas,
  };
}

const standardTextInputSchema = z.object({
  fundId: z.guid(),
  moduleId: specialistModuleIdSchema,
});

/**
 * The standard text of one standard specialist, for Team setup's "Tilpas". It used to be
 * bundled with the page, which put prompt text in a public file; now only holders of
 * `configure_fund` (Admin and Lead) get it, as with the fund's own texts (redactOverrides).
 * Everyone else gets empty lists, the same as a redacted override.
 */
export const loadStandardModuleText = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => standardTextInputSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ mandate: string[]; evidenceTests: string[]; riskAreas: string[] }> => {
      const access = await loadAccessForFund(context.supabase, context.userId, data.fundId);
      if (!access || !hasCapability(access.roles, "configure_fund", access.settings))
        return { mandate: [], evidenceTests: [], riskAreas: [] };
      return effectiveDefaultText(data.moduleId);
    },
  );

const proposeInputSchema = z.object({
  fundId: z.guid(),
  configId: z.guid(),
  moduleId: specialistModuleIdSchema,
  instructions: z.string().trim().min(1).max(4000),
  /**
   * The text in the editor, so a second request builds on the first answer and on the
   * user's own edits; without it the saved text (or the standard text) is rewritten.
   */
  current: moduleOverrideProposalSchema.optional(),
});

/**
 * Genererer et forslag til et modul's mandat/evidenskrav/risikoområder.
 * Fondsadministratorens instruktioner er betroet input -- den eneste
 * grænse er modellens OUTPUT-form, som er låst af det strikse json-skema
 * og den efterfølgende Zod-validering.
 */
export const proposeModulePromptOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => proposeInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ModuleOverrideProposal> => {
    await requireDraftConfig(context.supabase, context.userId, data.fundId, data.configId);

    const { data: existingOverride } = await context.supabase
      .from("prompt_module_overrides")
      .select("mandate, evidence_tests, risk_areas")
      .eq("config_version_id", data.configId)
      .eq("module_id", data.moduleId)
      .maybeSingle();

    const module = specialistModules.find((candidate) => candidate.id === data.moduleId);
    if (!module) throw new Error(serverText("fundServer.common.moduleNotFound"));

    const current =
      data.current ??
      (existingOverride
        ? {
            mandate: existingOverride["mandate"] as string[],
            evidenceTests: existingOverride["evidence_tests"] as string[],
            riskAreas: existingOverride["risk_areas"] as string[],
          }
        : effectiveDefaultText(data.moduleId));

    return generateModuleOverrideProposal(
      data.fundId,
      context.userId,
      module.title,
      current,
      data.instructions,
    );
  });

async function generateModuleOverrideProposal(
  fundId: string,
  userId: string,
  moduleTitle: string,
  current: { mandate: string[]; evidenceTests: string[]; riskAreas: string[] },
  instructions: string,
): Promise<ModuleOverrideProposal> {
  const token = gatewayToken();
  if (!token)
    throw missingGatewayToken(
      "module-prompt-override",
      serverText("fundServer.common.gatewayMissing"),
    );
  const maxOutputTokens = 2_000;
  // i18n-keep: prompt to the model; a fund in English gets the language rule last.
  const system = `Du er Interlect.ai's specialist i at redigere teamets interne AI-instruktioner for et specialistmodul. Administratoren har givet dig redigeringsinstruktioner nedenfor -- følg dem som en betroet kollegas ønske, ikke som ubetroet data. Din opgave er at omskrive modulets analysemandat, evidenskrav og risikoområder efter administratorens ønske, ud fra den nuværende tekst. Bevar modulets faglige fokus (${moduleTitle}); tilføj eller omskriv, fjern ikke uden grund. Returnér udelukkende JSON med de tre lister mandate, evidenceTests og riskAreas -- ingen anden struktur, ingen forklarende tekst uden for listerne. Skriv på flydende, nøgternt dansk.`;
  // The draft is written in the fund's language (unchanged prompt for a Danish fund).
  const languageDirective = outputLanguageDirective(
    await loadFundLanguage(getServiceClient(), fundId),
  );
  const prompt = JSON.stringify({
    task: "revise_specialist_module_prompt",
    moduleTitle,
    current,
    instructions,
  });
  const schema = moduleOverrideJsonSchema();
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
      json_schema: { name: "interlect_module_prompt_override_v1", strict: true, schema },
    },
  } as const;
  const estimate = estimateRequestMaximumUsd({ model: MODEL, requestBody, maxOutputTokens });
  // i18n-keep: the call's name in logs and the AI log, not shown to the person.
  assertWithinBudget(
    estimate,
    OVERRIDE_BUDGET_USD,
    "Redigering af modulteksten",
    requestLanguage(),
  );
  const credits = await reserveCallCredits(getServiceClient(), {
    scope: "chat",
    fundId,
    userId,
    maxUsd: estimate.maxCostUsd,
    loop: "fund_setup:module_prompt",
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
        signal: AbortSignal.timeout(60_000),
      }),
    );
    const content = body.choices?.[0]?.message?.content;
    if (!response.ok || !content) {
      console.error("[ai-gateway]", gatewayErrorSummary(body.error));
      throw new Error(serverText("fundServer.module.aiFailed"));
    }
    if (body.choices?.[0]?.finish_reason === "length") {
      throw new Error(serverText("fundServer.common.interrupted"));
    }
    const parsed = moduleOverrideProposalSchema.parse(JSON.parse(content));
    if (cost !== null && cost > OVERRIDE_BUDGET_USD) {
      throw new Error(serverText("fundServer.module.overBudget"));
    }
    return parsed;
  } finally {
    await credits.settle();
  }
}

function moduleOverrideJsonSchema() {
  const stringArray = (maxLength: number) => ({
    type: "array",
    maxItems: 12,
    items: { type: "string", minLength: 1, maxLength },
  });
  return {
    type: "object",
    additionalProperties: false,
    required: ["mandate", "evidenceTests", "riskAreas"],
    properties: {
      mandate: stringArray(400),
      evidenceTests: stringArray(400),
      riskAreas: stringArray(120),
    },
  };
}

const saveInputSchema = z.object({
  fundId: z.guid(),
  configId: z.guid(),
  moduleId: specialistModuleIdSchema,
  mandate: z.array(z.string().trim().min(1).max(400)).min(1).max(12),
  evidenceTests: z.array(z.string().trim().min(1).max(400)).min(1).max(12),
  riskAreas: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
});

export const saveModulePromptOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => saveInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireDraftConfig(context.supabase, context.userId, data.fundId, data.configId);
    const { error } = await context.supabase.from("prompt_module_overrides").upsert(
      {
        config_version_id: data.configId,
        module_id: data.moduleId,
        mandate: data.mandate,
        evidence_tests: data.evidenceTests,
        risk_areas: data.riskAreas,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "config_version_id,module_id" },
    );
    if (error) throw new Error(serverText("fundServer.module.notSaved"));
    return { ok: true };
  });

const resetInputSchema = z.object({
  fundId: z.guid(),
  configId: z.guid(),
  moduleId: specialistModuleIdSchema,
});

export const resetModulePromptOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => resetInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireDraftConfig(context.supabase, context.userId, data.fundId, data.configId);
    const { error } = await context.supabase
      .from("prompt_module_overrides")
      .delete()
      .eq("config_version_id", data.configId)
      .eq("module_id", data.moduleId);
    if (error) throw new Error(serverText("fundServer.module.notReset"));
    return { ok: true };
  });
