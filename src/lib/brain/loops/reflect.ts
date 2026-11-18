import type { LoopContext, LoopHandler } from "../worker.server";
import { AiDataPolicyError } from "@/lib/ai/gateway-options";
import { BrainBudgetReachedError, BrainModelOutputError } from "../errors";
import { embedWithGateway, type BrainEmbedder } from "../embeddings.server";
import { writeBrainLog } from "../log.server";
import { brainModel, brainPrompt } from "../models.server";
import { outputLanguageDirective } from "../../i18n/ai-language";
import { loadFundLanguage } from "../../i18n/fund-language.server";
import { CURATOR_PROMPT_KEY, CURATOR_PROMPT_V1 } from "../prompts/curator";
import { REFLECTOR_PROMPT_KEY, REFLECTOR_PROMPT_V1 } from "../prompts/reflector";
import { enqueueBrain } from "../queue.server";
import {
  checkEvidence,
  CORROBORATE_MIN_COSINE,
  curatorJsonSchema,
  curatorPrompt,
  NEIGHBORS_PER_CANDIDATE,
  parseCuratorOps,
  parseNeighbors,
  parseReflection,
  parseReflectionInput,
  parseReflectKey,
  planReflectionOps,
  REFLECT_DELAY_SECONDS,
  REFLECT_WINDOW_DAYS,
  REFLECTED_KINDS,
  reflectionCapUsd,
  reflectionJsonSchema,
  reflectionRefs,
  reflectKey,
  reflectorPrompt,
  tagsFromFeedback,
  type CuratorOp,
  type PlannedOp,
  type Reflection,
  type RejectedOp,
} from "../reflect";
import { estimateEmbeddingUsd } from "../capture";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import {
  callWithGateway,
  embedWithBudget,
  loopFlow,
  structuredCallMaximumUsd,
  structuredWithBudget,
  type StructuredCall,
  type StructuredCaller,
} from "./shared";
import { serverText } from "@/lib/i18n/server-text";

const REFLECTOR_MAX_OUTPUT_TOKENS = 2_500;
const CURATOR_MAX_OUTPUT_TOKENS = 1_500;

type ReflectStats = {
  agreement?: string;
  candidates: number;
  added: number;
  corroborated: number;
  activated: number;
  tagged: number;
  rejected: number;
  curator: "called" | "not_needed" | "capped" | "unusable";
  costUsd: number;
  stopped?: "capped" | "unusable";
};

/**
 * L2 · Reflektér (06 L2), one run per decision (key "decision:<event id>"). The reflector reads
 * the decision, the analysis before it, the lessons in play and similar decisions, and proposes
 * up to three lessons; the curator compares them with the nearest existing lessons and returns
 * ADD / CORROBORATE / TAG. The code checks every operation (evidence rule, labels it showed) and
 * brain_apply_reflection (0075) merges them in one transaction. Both answers are stored as job
 * steps, so a retry never pays for a model call twice; the merge is idempotent. All calls go on
 * the fund's "learning" budget and stop at the installation's rate per decision (0,50 kr.).
 */
export function createReflectLoop(call: StructuredCaller, embed: BrainEmbedder): LoopHandler {
  return async (ctx) => {
    const eventId = parseReflectKey(ctx.key);
    if (!eventId) return { status: "skipped", stats: { reason: "invalid_key" } };

    const done = await doneSteps(ctx);
    // A run whose merge is stored is finished: nothing is paid for or merged again.
    const appliedStep = done.get("apply");
    if (appliedStep) {
      const stored = (appliedStep.output ?? {}) as { stats?: Record<string, unknown> };
      return { status: "done", stats: { ...(stored.stats ?? {}), resumed: true } };
    }

    const rawInput = await rpc(ctx, "brain_reflection_input", {
      _fund_id: ctx.fundId,
      _event_id: eventId,
    });
    const fresh = parseReflectionInput(rawInput);
    if (!fresh) return { status: "skipped", stats: { reason: "decision_gone" } };
    const { decision } = fresh;
    // An undo after L0 queued us (the 15 minutes' delay) means there is no decision to learn from.
    if (!decision.standing) return { status: "skipped", stats: { reason: "not_standing" } };
    if (decision.actorType !== "user" || !decision.actorId) {
      return { status: "skipped", stats: { reason: "not_human" } };
    }
    if (!(REFLECTED_KINDS as readonly string[]).includes(decision.kind)) {
      return { status: "skipped", stats: { reason: "not_a_decision" } };
    }

    const reflected = done.get("reflect");
    const reflectedOutput = (reflected?.output ?? {}) as {
      input?: unknown;
      output?: unknown;
      stopped?: string;
    };
    // A retry keeps the input the reflector saw, so its labels (D2, E3 …) still mean the same;
    // the decision itself is always read fresh.
    const stored = reflected ? parseReflectionInput(reflectedOutput.input) : null;
    const input = stored ? { ...stored, decision } : fresh;
    const refs = reflectionRefs(input);

    const capUsd = reflectionCapUsd(await capSettings(ctx));
    let spentUsd = [...done.values()].reduce((sum, step) => sum + step.costUsd, 0);
    const stats: ReflectStats = {
      candidates: 0,
      added: 0,
      corroborated: 0,
      activated: 0,
      tagged: 0,
      rejected: 0,
      curator: "not_needed",
      costUsd: 0,
    };
    const redactor = await redactorForFund(ctx.fundId, loopFlow(ctx), ctx.service);

    /**
     * One model call. A call that throws after it was sent is booked at its maximum by
     * structuredWithBudget; that is stored as a step too, so a retry counts it against the cap.
     */
    const ask = async (
      step: string,
      request: StructuredCall,
    ): Promise<{ output: unknown; costUsd: number } | { unusableUsd: number }> => {
      try {
        return await structuredWithBudget(ctx, call, request, eventId);
      } catch (cause) {
        // Cut off or not the schema: paid for, but not asked again for the same decision.
        if (cause instanceof BrainModelOutputError) return { unusableUsd: cause.bookedUsd };
        if (!(cause instanceof AiDataPolicyError) && !(cause instanceof BrainBudgetReachedError)) {
          await ctx
            .recordStep(
              `spent:${step}:${ctx.attempt}`,
              { error: true },
              structuredCallMaximumUsd(request),
            )
            .catch(() => {});
        }
        throw cause;
      }
    };

    // --- 1. Reflector -----------------------------------------------------------------------
    let reflection: Reflection | null;
    if (reflected) {
      if (reflectedOutput.stopped) {
        return finish(stats, spentUsd, reflectedOutput.stopped as ReflectStats["stopped"]);
      }
      reflection = parseReflection(reflectedOutput.output);
    } else {
      const [model, prompt, language] = await Promise.all([
        brainModel(ctx.service, ctx.fundId, "reflector"),
        brainPrompt(ctx.service, ctx.fundId, REFLECTOR_PROMPT_KEY, REFLECTOR_PROMPT_V1),
        loadFundLanguage(ctx.service, ctx.fundId),
      ]);
      const request: StructuredCall = {
        model,
        name: "interlect_brain_reflection_v1",
        // The lessons are shown in Lært, so they follow the fund's language.
        system: `${prompt.body}${outputLanguageDirective(language)}`,
        prompt: reflectorPrompt(input, refs),
        schema: reflectionJsonSchema,
        maxOutputTokens: REFLECTOR_MAX_OUTPUT_TOKENS,
        redactor,
      };
      if (spentUsd + structuredCallMaximumUsd(request) > capUsd) {
        await ctx.recordStep("reflect", { stopped: "capped" });
        return finish(stats, spentUsd, "capped");
      }
      const answer = await ask("reflect", request);
      if ("unusableUsd" in answer) {
        await ctx.recordStep("reflect", { stopped: "unusable" }, answer.unusableUsd);
        return finish(stats, spentUsd + answer.unusableUsd, "unusable");
      }
      spentUsd += answer.costUsd;
      reflection = parseReflection(answer.output);
      // The raw answer and the input are stored, so a retry parses them the same way.
      await ctx.recordStep(
        "reflect",
        reflection
          ? { input: rawInput, output: answer.output, model, prompt: prompt.version }
          : { stopped: "unusable", model, prompt: prompt.version },
        answer.costUsd,
      );
    }
    if (!reflection) return finish(stats, spentUsd, "unusable");
    stats.agreement = reflection.agreement;
    stats.candidates = reflection.candidateLessons.length;

    // --- 2. Curator (only for candidates that can pass the evidence rule) -------------------
    let ops: PlannedOp[] = [];
    const rejected: RejectedOp[] = [];
    const candidates = reflection.candidateLessons.filter((candidate, index) => {
      const check = checkEvidence(candidate.evidence, refs);
      if (!check.ok) rejected.push({ op: "candidate", ref: `C${index + 1}`, reason: check.reason });
      return check.ok;
    });
    if (candidates.length === 0) {
      // The reflector's verdicts on the lessons shown are the only operations then (06 L2 lets
      // the curator write them; without candidates it would only copy them).
      ops = tagsFromFeedback(reflection.bulletFeedback, refs.lessons);
    } else {
      const texts = candidates.map((candidate) => candidate.text);
      const curated = done.get("curate");
      const curatedOutput = (curated?.output ?? {}) as {
        ops?: unknown;
        candidates?: unknown;
        stopped?: string;
      };
      // A stored curator answer is only used for the same candidates it was given.
      const sameCandidates =
        JSON.stringify(curatedOutput.candidates ?? null) === JSON.stringify(texts);
      const reuse = !!curated && !curatedOutput.stopped && sameCandidates;
      // Without the vectors there is no duplicate check, so no curator either (and no ADD). A
      // stored curator answer was paid for with them, so they are fetched again in any case.
      let embeddings: (number[] | null)[] = candidates.map(() => null);
      let neighborsRaw: unknown = [];
      const embedded = reuse || spentUsd + estimateEmbeddingUsd(texts) <= capUsd;
      if (embedded) {
        const vectors = await embedWithBudget(ctx, texts, eventId, embed, "learning", redactor);
        spentUsd += vectors.costUsd;
        await ctx.recordStep(`embed:${ctx.attempt}`, { candidates: texts.length }, vectors.costUsd);
        embeddings = vectors.embeddings;
        neighborsRaw = await rpc(ctx, "brain_reflection_neighbors", {
          _fund_id: ctx.fundId,
          _embeddings: vectors.embeddings,
          _min_cosine: CORROBORATE_MIN_COSINE,
          _limit: NEIGHBORS_PER_CANDIDATE,
        });
      }
      const neighbors = parseNeighbors(neighborsRaw, candidates.length);

      let curatorOps: CuratorOp[] | null = null;
      if (curated) {
        stats.curator = curatedOutput.stopped
          ? (curatedOutput.stopped as "capped" | "unusable")
          : "called";
        curatorOps = reuse ? parseCuratorOps({ ops: curatedOutput.ops ?? [] }).ops : null;
      } else {
        const [model, prompt, language] = await Promise.all([
          brainModel(ctx.service, ctx.fundId, "curator"),
          brainPrompt(ctx.service, ctx.fundId, CURATOR_PROMPT_KEY, CURATOR_PROMPT_V1),
          loadFundLanguage(ctx.service, ctx.fundId),
        ]);
        const request: StructuredCall = {
          model,
          name: "interlect_brain_curator_v1",
          system: `${prompt.body}${outputLanguageDirective(language)}`,
          prompt: curatorPrompt({
            decision,
            candidates,
            neighbors,
            feedback: reflection.bulletFeedback,
            lessons: refs.lessons,
          }),
          schema: curatorJsonSchema,
          maxOutputTokens: CURATOR_MAX_OUTPUT_TOKENS,
          redactor,
        };
        if (!embedded || spentUsd + structuredCallMaximumUsd(request) > capUsd) {
          stats.curator = "capped";
          await ctx.recordStep("curate", { stopped: "capped" });
        } else {
          const answer = await ask("curate", request);
          if ("unusableUsd" in answer) {
            spentUsd += answer.unusableUsd;
            stats.curator = "unusable";
            await ctx.recordStep("curate", { stopped: "unusable" }, answer.unusableUsd);
          } else {
            spentUsd += answer.costUsd;
            curatorOps = parseCuratorOps(answer.output).ops;
            stats.curator = "called";
            await ctx.recordStep(
              "curate",
              { ops: curatorOps, candidates: texts, model, prompt: prompt.version },
              answer.costUsd,
            );
          }
        }
      }
      if (curatorOps) {
        const plan = planReflectionOps({
          eventId,
          candidates,
          embeddings,
          neighbors,
          curatorOps,
          refs,
        });
        ops = plan.ops;
        rejected.push(...plan.rejected);
      } else {
        // No curator answer: no new or confirmed lessons without the duplicate check.
        ops = tagsFromFeedback(reflection.bulletFeedback, refs.lessons);
      }
    }

    // --- 3. Merge (idempotent: fixed lesson ids, one event per decision and lesson) ----------
    const applied = (await rpc(ctx, "brain_apply_reflection", {
      _fund_id: ctx.fundId,
      _event_id: eventId,
      _job_id: ctx.jobId,
      _ops: ops,
    })) as Record<string, unknown> | null;
    const count = (key: string) => Number(applied?.[key] ?? 0) || 0;
    stats.added = count("added");
    stats.corroborated = count("corroborated");
    stats.activated = count("activated");
    stats.tagged = count("tagged");
    stats.rejected = rejected.length + count("ignored");
    const result = finish(stats, spentUsd);
    // Logged before the step is stored: a crash in between logs twice, never not at all.
    await writeBrainLog(ctx.service, [
      {
        fundId: ctx.fundId,
        actor: "L2_reflect",
        action: "insert",
        objectKind: "reflection",
        objectId: eventId,
        after: {
          decision: decision.kind,
          agreement: reflection.agreement,
          keyInsight: reflection.keyInsight,
          candidates: reflection.candidateLessons.map((candidate) => candidate.text),
          ops: ops.map((op) => op.op),
          applied,
          rejected,
        },
        reason: serverText("brainServer.lessons.reflectReason"),
        jobId: ctx.jobId,
      },
    ]);
    await ctx.recordStep("apply", { applied, rejected, stats: result.stats });
    return result;
  };
}

export const reflectLoop = createReflectLoop(callWithGateway, embedWithGateway);

/**
 * Called by L0 after a case changed: the case's standing human decisions of the last
 * REFLECT_WINDOW_DAYS without a reflection go to the queue, REFLECT_DELAY_SECONDS late, so an
 * undo in the meantime makes the reflection skip. The queue drops a repeated key; the job row's
 * unique key catches the rest.
 */
export async function enqueuePendingReflections(
  ctx: Pick<LoopContext, "service" | "fundId">,
  caseId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - REFLECT_WINDOW_DAYS * 86_400_000).toISOString();
  const ids = (await rpc(ctx, "brain_pending_reflections", {
    _fund_id: ctx.fundId,
    _case_id: caseId,
    _since: since,
  })) as unknown;
  const eventIds = Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
  for (const eventId of eventIds) {
    await enqueueBrain(
      { fundId: ctx.fundId, loop: "L2_reflect", key: reflectKey(eventId) },
      { delaySeconds: REFLECT_DELAY_SECONDS },
    );
  }
  return eventIds.length;
}

function finish(
  stats: ReflectStats,
  spentUsd: number,
  stopped?: ReflectStats["stopped"],
): { status: "done"; stats: Record<string, unknown> } {
  return {
    status: "done",
    stats: { ...stats, ...(stopped ? { stopped } : {}), costUsd: Number(spentUsd.toFixed(6)) },
  };
}

async function doneSteps(
  ctx: LoopContext,
): Promise<Map<string, { output: unknown; costUsd: number }>> {
  const { data, error } = await ctx.service
    .from("brain_job_steps")
    .select("step, output, cost_usd")
    .eq("job_id", ctx.jobId)
    .eq("fund_id", ctx.fundId);
  if (error) throw new Error(`brain_job_steps: ${error.message}`);
  return new Map(
    (data ?? []).map((row) => [
      row["step"] as string,
      { output: row["output"], costUsd: Number(row["cost_usd"] ?? 0) || 0 },
    ]),
  );
}

/** The installation's rate per decision (P11, ai_settings); the defaults when it cannot be read. */
async function capSettings(
  ctx: LoopContext,
): Promise<{ dkkPerDecision: number | null; usdToDkk: number | null } | null> {
  const { data, error } = await ctx.service
    .from("ai_settings")
    .select("brain_dkk_per_decision, usd_to_dkk")
    .maybeSingle();
  if (error) {
    console.error("[brain] L2 ai_settings", error.code, error.message);
    return null;
  }
  if (!data) return null;
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return { dkkPerDecision: num(data["brain_dkk_per_decision"]), usdToDkk: num(data["usd_to_dkk"]) };
}

async function rpc(
  ctx: Pick<LoopContext, "service">,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await ctx.service.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
