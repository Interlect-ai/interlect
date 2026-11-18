import { isPermanentPolicyStop } from "@/lib/ai/model-call";
import type { LoopHandler } from "../worker.server";
import { captureKey } from "../capture";
import { entityResolverJsonSchema, parseEntityDecisions } from "../contracts/extract";
import { BrainBudgetReachedError, BrainModelOutputError } from "../errors";
import { brainModel, brainPrompt } from "../models.server";
import { duplicateResolverPrompt, runNightly, type ResolverAnswer } from "../nightly";
import { RESOLVER_PROMPT_KEY, RESOLVER_PROMPT_V1 } from "../prompts/resolver";
import { enqueueBrain } from "../queue.server";
import { refreshBrainPages } from "./pages";
import { embedFactsWithoutVector } from "./vectors";
import { callWithGateway, structuredWithBudget, type StructuredCaller } from "./shared";

/** 20 short decisions plus low reasoning; a cut-off answer leaves the rest "unsure". */
const RESOLVER_MAX_OUTPUT_TOKENS = 1_200;

/**
 * L4_nightly (06 L4, steps 1–5 and 7–9), one run per fund and night (cron key = the date). The
 * steps are SQL (0063, 0064); the resolver's recommendation on name twins and the page writer are
 * the model calls, reserved in the fund's "learning" budget. A night without them (budget, data
 * rules, an unusable answer) still writes the insights and runs the free steps.
 */
export function createNightlyLoop(call: StructuredCaller): LoopHandler {
  return async (ctx) => {
    const result = await runNightly({
      fundId: ctx.fundId,
      jobId: ctx.jobId,
      attempt: ctx.attempt,
      async doneSteps() {
        const { data, error } = await ctx.service
          .from("brain_job_steps")
          .select("step, output")
          .eq("job_id", ctx.jobId)
          .eq("fund_id", ctx.fundId);
        if (error) throw new Error(`brain_job_steps: ${error.message}`);
        return new Map((data ?? []).map((row) => [row["step"] as string, row["output"]]));
      },
      async rpc(name, args) {
        const { data, error } = await ctx.service.rpc(name, args);
        if (error) throw new Error(`${name}: ${error.message}`);
        return data;
      },
      recordStep: (step, output, costUsd) => ctx.recordStep(step, output, costUsd),
      async enqueueCapture(caseId, changedAt) {
        await enqueueBrain({
          fundId: ctx.fundId,
          loop: "L0_capture",
          key: captureKey(caseId, changedAt),
        });
      },
      async resolvePairs(pairs): Promise<ResolverAnswer> {
        const [model, prompt] = await Promise.all([
          brainModel(ctx.service, ctx.fundId, "resolver"),
          brainPrompt(ctx.service, ctx.fundId, RESOLVER_PROMPT_KEY, RESOLVER_PROMPT_V1),
        ]);
        try {
          const answer = await structuredWithBudget(
            ctx,
            call,
            {
              model,
              name: "interlect_brain_resolve_entities_v1",
              system: prompt.body,
              prompt: duplicateResolverPrompt(pairs),
              schema: entityResolverJsonSchema,
              maxOutputTokens: RESOLVER_MAX_OUTPUT_TOKENS,
            },
            ctx.jobId,
          );
          return { decisions: parseEntityDecisions(answer.output), costUsd: answer.costUsd };
        } catch (cause) {
          if (cause instanceof BrainBudgetReachedError) return { stopped: "budget", costUsd: 0 };
          // Stopped by the data rules; a masking dictionary that failed to load is
          // retried with the job instead.
          if (isPermanentPolicyStop(cause)) return { stopped: "policy", costUsd: 0 };
          if (cause instanceof BrainModelOutputError) {
            return { stopped: "output", costUsd: cause.bookedUsd };
          }
          throw cause;
        }
      },
      refreshPages: () => refreshBrainPages(ctx, call),
      embedFacts: () => embedFactsWithoutVector(ctx),
      async insertInsights(rows) {
        if (rows.length === 0) return 0;
        const { data, error } = await ctx.service
          .from("brain_insights")
          .upsert([...rows], { onConflict: "fund_id,dedupe_key", ignoreDuplicates: true })
          .select("id");
        if (error) throw new Error(`brain_insights: ${error.message}`);
        return data?.length ?? 0;
      },
    });
    return result;
  };
}

export const nightlyLoop = createNightlyLoop(callWithGateway);
