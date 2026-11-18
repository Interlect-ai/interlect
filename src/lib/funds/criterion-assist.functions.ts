import { createServerFn } from "@tanstack/react-start";
import { gatewayErrorSummary } from "@/lib/ai/gateway-log";
import { outputLanguageDirective } from "@/lib/i18n/ai-language";
import { loadFundLanguage } from "@/lib/i18n/fund-language.server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/supabase/auth-middleware";
import { getServiceClient } from "@/lib/supabase/admin.server";
import { requireFundCapability } from "@/lib/auth/access.server";
import { estimateRequestMaximumUsd, assertWithinBudget } from "@/lib/analysis/budgets";
import { AiDataPolicyError, aiGatewayOptions } from "@/lib/ai/gateway-options";
import { reserveCallCredits, sendCharged } from "@/lib/ai/credits.server";
import { postChatCompletion } from "@/lib/ai/model-call";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { scoreCategoryLabel } from "@/lib/domain/labels";
import { scoreCategorySchema } from "@/lib/funds/config.functions";
import { requestLanguage, serverText } from "@/lib/i18n/server-text";
import { gatewayToken, missingGatewayToken } from "@/lib/ai/gateway-token";

const MODEL = "openai/gpt-5.4-mini" as const;
const CRITERION_ASSIST_BUDGET_USD = 0.05;
// Samme loft som criterionSchema.description, så forslaget altid kan gemmes.
const MAX_DESCRIPTION_LENGTH = 1000;

const proposeInputSchema = z.object({
  fundId: z.guid(),
  label: z.string().trim().min(1).max(160),
  category: scoreCategorySchema,
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH),
  notes: z.string().trim().max(2000),
  thesis: z.string().trim().max(5000),
  // Samme grænser som fondsopsætningens gem-skema; lange lister skæres til
  // i stedet for at afvise hjælpen.
  stages: z.array(z.string().trim().max(80)).transform((items) => items.slice(0, 20)),
  sectors: z.array(z.string().trim().max(120)).transform((items) => items.slice(0, 40)),
  geographies: z.array(z.string().trim().max(120)).transform((items) => items.slice(0, 40)),
  riskPosture: z.string().trim().max(3000),
});

const proposalSchema = z.object({
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_LENGTH),
});

export type CriterionDescriptionProposal = z.infer<typeof proposalSchema>;

/**
 * Uddyber et analysekriteriums beskrivelse ud fra fondsadministratorens egne
 * stikord og fondens tese. Beskrivelsen er den tekst, der flettes ind i
 * screeningsprompten, specialistpromptene, IC-syntesen og research-briefet,
 * så forslaget skal være konkret om hvad der tæller som stærk og svag
 * evidens. Forslaget gemmes aldrig her -- det lander i editorens felt, og
 * mennesket gemmer og publicerer selv kladden.
 */
export const proposeCriterionDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => proposeInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<CriterionDescriptionProposal> => {
    await requireFundCapability(context.supabase, context.userId, data.fundId, "configure_fund");
    if (!data.description && !data.notes) {
      throw new Error(serverText("fundServer.criterion.needKeywords"));
    }
    return generateCriterionDescription(data, context.userId);
  });

async function generateCriterionDescription(
  input: z.infer<typeof proposeInputSchema>,
  userId: string,
): Promise<CriterionDescriptionProposal> {
  const token = gatewayToken();
  if (!token)
    throw missingGatewayToken("criterion-assist", serverText("fundServer.common.gatewayMissing"));
  const maxOutputTokens = 1_200;
  // i18n-keep: prompt to the model; a fund in English gets the language rule last.
  const system = `Du hjælper et investeringsteam med at formulere ét analysekriterium, som Interlect.ai's AI-analytiker bruger til at score nye cases. Administratorens stikord er betroet input -- følg dem som en kollegas ønske. Skriv en præcis beskrivelse (maks. ${MAX_DESCRIPTION_LENGTH} tegn) på nøgternt dansk i tre korte dele: 1) hvad teamet forstår ved kriteriet, 2) "Stærke tegn:" konkrete, efterprøvelige signaler og datakilder, 3) "Svage tegn / røde flag:". Tilpas til investeringstesen, stadierne og sektorerne. Tag højde for stadiet: manglende data i en tidlig case er usikkerhed, ikke et negativt resultat. Opfind ikke tal eller tærskler, som administratoren ikke har nævnt, medmindre de tydeligt er eksempler. Returnér kun JSON med feltet description.`;
  // The draft is written in the fund's language (unchanged prompt for a Danish fund).
  const languageDirective = outputLanguageDirective(
    await loadFundLanguage(getServiceClient(), input.fundId),
  );
  const prompt = JSON.stringify({
    task: "expand_assessment_criterion_description",
    criterion: {
      label: input.label,
      scoreCategory: scoreCategoryLabel[input.category],
      currentDescription: input.description,
    },
    administratorNotes: input.notes,
    fund: {
      thesis: input.thesis,
      stages: input.stages,
      sectors: input.sectors,
      geographies: input.geographies,
      riskPosture: input.riskPosture,
    },
  });
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
      json_schema: {
        name: "interlect_criterion_description_v1",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["description"],
          properties: {
            description: { type: "string", minLength: 1, maxLength: MAX_DESCRIPTION_LENGTH },
          },
        },
      },
    },
  } as const;
  const estimate = estimateRequestMaximumUsd({ model: MODEL, requestBody, maxOutputTokens });
  // i18n-keep: the call's name in logs and the AI log, not shown to the person.
  assertWithinBudget(
    estimate,
    CRITERION_ASSIST_BUDGET_USD,
    "Hjælp med AI til kriteriet",
    requestLanguage(),
  );
  const credits = await reserveCallCredits(getServiceClient(), {
    scope: "chat",
    fundId: input.fundId,
    userId,
    maxUsd: estimate.maxCostUsd,
    loop: "fund_setup:criterion",
    model: MODEL,
  });
  try {
    let status: number | null = null;
    let finishReason: string | undefined;
    let gatewayError: unknown;
    let cost: number | null = null;
    let parsed: CriterionDescriptionProposal;
    try {
      const { response, body, costUsd } = await sendCharged<{
        error?: { message?: string };
        choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
      }>(credits, async () =>
        postChatCompletion({
          body: requestBody,
          redactor: await redactorForFund(input.fundId, "fund_setup"),
          token,
          signal: AbortSignal.timeout(45_000),
        }),
      );
      status = response.status;
      gatewayError = body.error;
      finishReason = body.choices?.[0]?.finish_reason;
      cost = costUsd;
      const content = body.choices?.[0]?.message?.content;
      if (!response.ok || !content) throw new Error("empty_or_failed_response");
      if (finishReason === "length")
        throw new AssistRejected(serverText("fundServer.common.interrupted"));
      parsed = proposalSchema.parse(JSON.parse(content));
    } catch (cause) {
      if (cause instanceof AssistRejected) throw new Error(cause.message);
      // A data rules stop (nothing sent) carries a message for the user.
      if (cause instanceof AiDataPolicyError) throw cause;
      console.error("[ai-gateway] criterion assist failed", {
        status,
        finishReason,
        error: gatewayErrorSummary(gatewayError),
        cause: cause instanceof Error ? cause.message : cause,
      });
      throw new Error(serverText("fundServer.criterion.aiFailed"));
    }
    if (cost !== null && cost > CRITERION_ASSIST_BUDGET_USD) {
      console.error("[ai-gateway] criterion assist over budget", {
        costUsd: cost,
        capUsd: CRITERION_ASSIST_BUDGET_USD,
      });
      throw new Error(serverText("fundServer.criterion.overBudget"));
    }
    return parsed;
  } finally {
    await credits.settle();
  }
}

/** En bevidst afvisning, hvis danske besked skal nå brugeren uændret. */
class AssistRejected extends Error {}
