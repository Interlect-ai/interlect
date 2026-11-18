import type { PricedModel } from "@/lib/analysis/budgets";
import type { BudgetScope } from "../jobs";
import type { LoopContext, LoopHandler } from "../worker.server";
import { captureExtracts, parseCaptureKey } from "../capture";
import {
  entityResolverJsonSchema,
  extractorJsonSchema,
  factResolverJsonSchema,
  FREE_TEXT_PREDICATES,
  parseEntityDecisions,
  parseInstructionEpisodes,
  parseMaskedExtraction,
  parseFactDecisions,
  STRUCTURAL_FACT_REJECTIONS,
  type EntityType,
  type ExtractedEntity,
  type ExtractedFact,
} from "../contracts/extract";
import { AiDataPolicyError } from "@/lib/ai/gateway-options";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import { embedWithGateway, type BrainEmbedder } from "../embeddings.server";
import { readForgetGeneration, storeVectorsChecked, type VectorRow } from "./forget-guard";
import { BrainBudgetReachedError, BrainLeaseLostError, BrainModelOutputError } from "../errors";
import {
  BATCH_UNITS,
  batchEpisodes,
  CASE_LEASE_SECONDS,
  decideEntity,
  entityKey,
  extractPartKey,
  FREE_TEXT_SIMILARITY,
  L1_BATCH_CAP_USD,
  MAX_BATCHES_PER_RUN,
  nameLabels,
  normalizeForQuote,
  parseExtractPartKey,
  RESOLVER_MIN_CONFIDENCE,
  RUN_BUDGET_MS,
  type EntityCandidate,
} from "../extract";
import { episodeInstructionFlag } from "../injection";
import { normalizeEntityName } from "../keys";
import { brainModel, brainPrompt } from "../models.server";
import { outputLanguageDirective } from "../../i18n/ai-language";
import { loadFundLanguage } from "../../i18n/fund-language.server";
import { EXTRACTOR_PROMPT_KEY, EXTRACTOR_PROMPT_V1 } from "../prompts/extractor";
import { RESOLVER_PROMPT_KEY, RESOLVER_PROMPT_V1 } from "../prompts/resolver";
import { enqueueBrain } from "../queue.server";
import {
  backfillStopped,
  callWithGateway,
  embedWithBudget,
  loopFlow,
  structuredCallMaximumUsd,
  structuredWithBudget,
  type StructuredCall,
  type StructuredCaller,
} from "./shared";
import { serverText } from "@/lib/i18n/server-text";

const EXTRACTOR_MAX_OUTPUT_TOKENS = 4_500;
const RESOLVER_MAX_OUTPUT_TOKENS = 600;
/** Known entities sent with each batch (the case company and case first). */
const MAX_KNOWN_ENTITIES = 40;
const LOOKUP_CONCURRENCY = 5;

export type ExtractDeps = { embed: BrainEmbedder; call: StructuredCaller };

type PendingEpisode = {
  episode_id: string;
  kind: string;
  trust_tier: string;
  occurred_at: string | null;
  title: string | null;
  content: string;
};

type KnownEntity = { id: string; type: string; name: string };

type CaseContext = {
  companyKey: string;
  /** "K1" -> entity; K1 is the case company, K2 the case. */
  known: Map<string, KnownEntity>;
};

/** What a batch belongs to: a case (L1, scope "learning") or an uploaded source (INGEST, scope "ingest"). */
type Target = { kind: "case" | "source"; id: string };

function targetScope(target: Target): BudgetScope {
  return target.kind === "source" ? "ingest" : "learning";
}

type BatchSettings = {
  target: Target;
  context: CaseContext;
  extractor: { model: PricedModel; prompt: string };
  resolver: { model: PricedModel; prompt: string };
  /** Read before the run's data: a batch is not saved after a "Glem" since. */
  forgetGeneration: number;
};

type BatchStats = {
  episodes: number;
  knownRepeated: number;
  failedEpisodes: number;
  extracted: number;
  rejected: Record<string, number>;
  entitiesMatched: number;
  resolverCalls: number;
  resolverUnanswered: number;
  resolverSkippedForCap: number;
  mergeCandidates: number;
  /** Contradiction insights for evidence the analysis marked contradictory (without a fact). */
  evidenceFlags: number;
  /** …that could not be written (the batch is already applied; counted, never retried here). */
  evidenceFlagsFailed: number;
  repaired: number;
  vectorsFailed: number;
  applied: Record<string, unknown>;
  /** The batch's episodes were already done (another run got there first); its cost was wasted. */
  wasted: boolean;
  caseGone: boolean;
  /** Something was forgotten since the run read its data: nothing was saved, the run stops. */
  forgotten: boolean;
  costUsd: number;
};

/** An extractor call whose maximum is over the per-batch cap: the batch is split first. */
class BatchOverCapError extends Error {}

/**
 * L1 · Forstå (06 L1), one case per message. Holds the case's L1 lease (one run per case), then
 * takes the case's unextracted episodes in batches (at most 6 long or 12 short, 0,20 kr. each),
 * lets the extractor propose entities and facts, keeps only facts whose quote is in their own
 * episode, resolves entities (key, trigram, vector, resolver) and free-text facts in doubt
 * (resolver), and applies each batch atomically with brain_apply_extraction (0045). An answer
 * that cannot be used splits the batch; an episode that still cannot be read is marked failed.
 * After 6 batches or 150 s the lease is released and a continuation "<key>+<part>" follows when
 * episodes are left (also ones that arrived while the lease was held).
 */
export function createExtractLoop(deps: ExtractDeps): LoopHandler {
  return async (ctx) => {
    const { baseKey, part } = parseExtractPartKey(ctx.key);
    const key = parseCaptureKey(baseKey);
    if (!key) return { status: "skipped", stats: { reason: "invalid_key" } };
    if (!captureExtracts(key.origin))
      return { status: "skipped", stats: { reason: "search_only" } };
    if (key.origin !== "change" && (await backfillStopped(ctx, key.origin, key.changedAt))) {
      return { status: "skipped", stats: { reason: "backfill_stopped" } };
    }
    const { caseId } = key;

    const forgetGeneration = await readForgetGeneration(ctx.service, ctx.fundId);
    const context = await loadCaseContext(ctx, caseId);
    if (!context) return { status: "skipped", stats: { reason: "case_gone" } };
    // Another L1 run holds the case: it re-reads the pending episodes before every batch and
    // checks again after it lets go, so nothing it has not seen is left behind.
    if (!(await claimCase(ctx, caseId))) {
      return { status: "skipped", stats: { reason: "case_busy" } };
    }

    const totals = {
      batches: 0,
      episodes: 0,
      failedEpisodes: 0,
      facts: 0,
      confirmed: 0,
      contradictions: 0,
      wastedBatches: 0,
      costUsd: 0,
    };
    let prompts: { extractor: number | "repo"; resolver: number | "repo" } | null = null;
    let forgotten = false;
    try {
      const [extractorModel, resolverModel, extractorPrompt, resolverPrompt, language] =
        await Promise.all([
          brainModel(ctx.service, ctx.fundId, "extractor"),
          brainModel(ctx.service, ctx.fundId, "resolver"),
          brainPrompt(ctx.service, ctx.fundId, EXTRACTOR_PROMPT_KEY, EXTRACTOR_PROMPT_V1),
          brainPrompt(ctx.service, ctx.fundId, RESOLVER_PROMPT_KEY, RESOLVER_PROMPT_V1),
          loadFundLanguage(ctx.service, ctx.fundId),
        ]);
      prompts = { extractor: extractorPrompt.version, resolver: resolverPrompt.version };
      const settings: BatchSettings = {
        target: { kind: "case", id: caseId },
        context,
        // The fact sentences are shown to the team, so they follow the fund's language.
        extractor: {
          model: extractorModel,
          prompt: `${extractorPrompt.body}${outputLanguageDirective(language)}`,
        },
        resolver: { model: resolverModel, prompt: resolverPrompt.body },
        forgetGeneration,
      };

      const started = Date.now();
      while (totals.batches < MAX_BATCHES_PER_RUN && Date.now() - started < RUN_BUDGET_MS) {
        // Re-read before every batch: another run's or L0's changes are always seen.
        const batch = batchEpisodes(await pendingEpisodes(ctx, caseId, BATCH_UNITS * 2))[0];
        if (!batch) break;
        await ctx.extendLease();
        if (!(await claimCase(ctx, caseId))) throw new Error("L1: the case lease was lost");
        const stats = await processBatch(ctx, deps, settings, batch);
        if (stats.caseGone) return { status: "skipped", stats: { reason: "case_gone", ...totals } };
        totals.batches += 1;
        totals.episodes += stats.episodes;
        totals.failedEpisodes += stats.failedEpisodes;
        totals.facts += Number(stats.applied["added"] ?? 0);
        totals.confirmed += Number(stats.applied["confirmed"] ?? 0);
        totals.contradictions += Number(stats.applied["contradictions"] ?? 0);
        totals.wastedBatches += stats.wasted ? 1 : 0;
        totals.costUsd += stats.costUsd;
        await ctx.recordStep(`batch:${batch[0]?.episode_id ?? "none"}`, stats, stats.costUsd);
        // The episodes are still pending; the next part reads them as the forgetting left them.
        if (stats.forgotten) {
          forgotten = true;
          break;
        }
      }
    } finally {
      await releaseCase(ctx, caseId);
    }

    const left = await pendingCount(ctx, caseId);
    if (left > 0) {
      await enqueueBrain({
        fundId: ctx.fundId,
        loop: "L1_extract",
        key: extractPartKey(baseKey, part + 1),
      });
    }
    return {
      status: "done",
      stats: {
        ...totals,
        costUsd: Number(totals.costUsd.toFixed(6)),
        part,
        left,
        ...(forgotten ? { forgotten: true } : {}),
        extractorPrompt: prompts?.extractor ?? null,
        resolverPrompt: prompts?.resolver ?? null,
      },
    };
  };
}

export interface SourceFactsResult {
  batches: number;
  episodes: number;
  failedEpisodes: number;
  facts: number;
  costUsd: number;
  /** Episodes are still waiting (a limit was reached): the caller continues in a new run. */
  left: boolean;
  /** The next batch could not be paid within the cap given by the caller. */
  capReached: boolean;
  sourceGone: boolean;
}

/**
 * The facts step of INGEST: the same extraction as L1, for the episodes of one source
 * (kind source_chunk), written by brain_apply_extraction_source (0054). The caller's job lease
 * covers the source, so there is no second lease. Stops after MAX_BATCHES_PER_RUN batches or
 * RUN_BUDGET_MS (`left`), or when the next batch could pass `maxCostUsd` (`capReached`). Every
 * call is booked on the "ingest" budget.
 */
export async function extractSourceFacts(
  ctx: LoopContext,
  deps: ExtractDeps,
  sourceId: string,
  options: { maxCostUsd: number; onBatchCost?: (usd: number) => Promise<void> },
): Promise<SourceFactsResult> {
  const forgetGeneration = await readForgetGeneration(ctx.service, ctx.fundId);
  const [extractorModel, resolverModel, extractorPrompt, resolverPrompt, language] =
    await Promise.all([
      brainModel(ctx.service, ctx.fundId, "extractor"),
      brainModel(ctx.service, ctx.fundId, "resolver"),
      brainPrompt(ctx.service, ctx.fundId, EXTRACTOR_PROMPT_KEY, EXTRACTOR_PROMPT_V1),
      brainPrompt(ctx.service, ctx.fundId, RESOLVER_PROMPT_KEY, RESOLVER_PROMPT_V1),
      loadFundLanguage(ctx.service, ctx.fundId),
    ]);
  const settings: BatchSettings = {
    target: { kind: "source", id: sourceId },
    // No case company: a person is keyed on this source, so two sources never merge people by name alone.
    context: { companyKey: `source:${sourceId}`, known: new Map() },
    // The fact sentences are shown to the team, so they follow the fund's language.
    extractor: {
      model: extractorModel,
      prompt: `${extractorPrompt.body}${outputLanguageDirective(language)}`,
    },
    resolver: { model: resolverModel, prompt: resolverPrompt.body },
    forgetGeneration,
  };
  const result: SourceFactsResult = {
    batches: 0,
    episodes: 0,
    failedEpisodes: 0,
    facts: 0,
    costUsd: 0,
    left: false,
    capReached: false,
    sourceGone: false,
  };
  const started = Date.now();
  for (;;) {
    const pending = await pendingSourceEpisodes(ctx, sourceId, BATCH_UNITS * 2);
    const batch = batchEpisodes(pending)[0];
    if (!batch) return result;
    if (result.batches >= MAX_BATCHES_PER_RUN || Date.now() - started >= RUN_BUDGET_MS) {
      return { ...result, left: true };
    }
    // A batch costs at most its cap; stop before one that could pass the document's cap.
    if (result.costUsd + L1_BATCH_CAP_USD > options.maxCostUsd + 1e-9) {
      return { ...result, capReached: true, left: true };
    }
    await ctx.extendLease();
    let stats: BatchStats;
    try {
      stats = await processBatch(ctx, deps, settings, batch);
    } catch (cause) {
      // A batch that fails after paying must still count against the document's cap: the exact
      // price is in the ledger only, so the batch's cap (its upper bound) is booked on the source.
      // One stopped by the data rules was never sent.
      if (
        !(cause instanceof BrainBudgetReachedError) &&
        !(cause instanceof BrainLeaseLostError) &&
        !(cause instanceof AiDataPolicyError)
      ) {
        await options.onBatchCost?.(L1_BATCH_CAP_USD).catch(() => {});
      }
      throw cause;
    }
    if (stats.caseGone) return { ...result, sourceGone: true };
    result.batches += 1;
    result.episodes += stats.episodes;
    result.failedEpisodes += stats.failedEpisodes;
    result.facts += Number(stats.applied["added"] ?? 0);
    result.costUsd += stats.costUsd;
    await ctx.recordStep(`batch:${batch[0]?.episode_id ?? "none"}`, stats, stats.costUsd);
    // What is paid is booked on the source at once, so a later failure never hides it.
    await options.onBatchCost?.(stats.costUsd);
    // Forgotten since this run read its data: a new run continues from the masked text.
    if (stats.forgotten) return { ...result, left: true };
  }
}

async function pendingSourceEpisodes(
  ctx: LoopContext,
  sourceId: string,
  limit: number,
): Promise<PendingEpisode[]> {
  const { data, error } = await ctx.service.rpc("brain_source_pending_episodes", {
    _fund_id: ctx.fundId,
    _source_id: sourceId,
    _limit: limit,
  });
  if (error) throw new Error(`brain_source_pending_episodes: ${error.message}`);
  return (data ?? []) as PendingEpisode[];
}

export const extractLoop = createExtractLoop({ embed: embedWithGateway, call: callWithGateway });

async function claimCase(ctx: LoopContext, caseId: string): Promise<boolean> {
  const { data, error } = await ctx.service.rpc("brain_claim_case_extraction", {
    _fund_id: ctx.fundId,
    _case_id: caseId,
    _job_id: ctx.jobId,
    _attempt: ctx.attempt,
    _lease_seconds: CASE_LEASE_SECONDS,
  });
  if (error) throw new Error(`brain_claim_case_extraction: ${error.message}`);
  return data === true;
}

async function releaseCase(ctx: LoopContext, caseId: string): Promise<void> {
  const { error } = await ctx.service.rpc("brain_release_case_extraction", {
    _fund_id: ctx.fundId,
    _case_id: caseId,
    _job_id: ctx.jobId,
    _attempt: ctx.attempt,
  });
  // The lease runs out by itself after 5 minutes; a failed release only delays the next run.
  if (error) console.error("[brain] L1 case lease not released", error.code, error.message);
}

async function pendingEpisodes(
  ctx: LoopContext,
  caseId: string,
  limit: number,
): Promise<PendingEpisode[]> {
  const { data, error } = await ctx.service.rpc("brain_case_pending_episodes", {
    _fund_id: ctx.fundId,
    _case_id: caseId,
    _limit: limit,
  });
  if (error) throw new Error(`brain_case_pending_episodes: ${error.message}`);
  return (data ?? []) as PendingEpisode[];
}

async function pendingCount(ctx: LoopContext, caseId: string): Promise<number> {
  const { count, error } = await ctx.service
    .from("brain_episodes")
    .select("id", { count: "exact", head: true })
    .eq("fund_id", ctx.fundId)
    .eq("case_id", caseId)
    .eq("extraction_status", "pending");
  if (error) throw new Error(`L1 pending count: ${error.message}`);
  return count ?? 0;
}

/**
 * The instruction flag of each episode in the batch: the patterns over the whole
 * text plus the extractor's verdict ("E1" ...). A clean episode is cleared, so a re-extracted
 * text (masking, forget) loses an old flag. A failed write is logged and the batch goes on: the
 * chat still checks every text it shows by pattern.
 */
async function storeInstructionFlags(
  ctx: LoopContext,
  batch: readonly PendingEpisode[],
  modelFlagged: ReadonlySet<string>,
): Promise<void> {
  const flagged = batch.flatMap((episode, index) => {
    const reasons = episodeInstructionFlag(episode.content, modelFlagged.has(`E${index + 1}`));
    return reasons ? [{ id: episode.episode_id, reasons }] : [];
  });
  for (const { id, reasons } of flagged) {
    const { error } = await ctx.service
      .from("brain_episodes")
      .update({ instruction_flag: reasons })
      .eq("fund_id", ctx.fundId)
      .eq("id", id);
    if (error) console.warn(`[brain] L1 instruction flag ${id}: ${error.message}`);
  }
  const flaggedIds = new Set(flagged.map((episode) => episode.id));
  const clean = batch.map((episode) => episode.episode_id).filter((id) => !flaggedIds.has(id));
  if (clean.length === 0) return;
  const { error } = await ctx.service
    .from("brain_episodes")
    .update({ instruction_flag: null })
    .eq("fund_id", ctx.fundId)
    .in("id", clean)
    .not("instruction_flag", "is", null);
  if (error) console.warn(`[brain] L1 instruction flag clear: ${error.message}`);
}

/**
 * One batch. An unusable answer or a batch over the cap is split in halves; a single episode
 * that still cannot be read is marked failed, so it never blocks the case or is paid for again.
 */
async function processBatch(
  ctx: LoopContext,
  deps: ExtractDeps,
  settings: BatchSettings,
  batch: PendingEpisode[],
): Promise<BatchStats> {
  try {
    return await extractBatch(ctx, deps, settings, batch);
  } catch (cause) {
    const unusable = cause instanceof BrainModelOutputError;
    if (!unusable && !(cause instanceof BatchOverCapError)) throw cause;
    const booked = unusable ? cause.bookedUsd : 0;
    if (batch.length === 1) {
      const episodeId = batch[0]?.episode_id as string;
      console.warn(`[brain] L1 episode ${episodeId} unreadable: ${(cause as Error).message}`);
      // An unreadable episode still gets the pattern check; it costs no call.
      await storeInstructionFlags(ctx, batch, new Set());
      const applied = await applyToDatabase(ctx, settings, {
        episodes: [],
        failed: [episodeId],
        entities: [],
        facts: [],
      });
      // The evidence's status does not depend on the model: flag it even when unreadable.
      const flags = await contradictoryEvidenceInsights(ctx, batch);
      if (applied["skipped"] === "forgotten") {
        return { ...emptyStats(), forgotten: true, costUsd: booked };
      }
      return {
        ...emptyStats(),
        failedEpisodes: 1,
        evidenceFlags: flags.written,
        evidenceFlagsFailed: flags.failed,
        applied: summary(applied),
        costUsd: booked,
      };
    }
    const half = Math.ceil(batch.length / 2);
    const first = await processBatch(ctx, deps, settings, batch.slice(0, half));
    if (first.caseGone || first.forgotten) return first;
    const second = await processBatch(ctx, deps, settings, batch.slice(half));
    return mergeStats(first, second, booked);
  }
}

async function extractBatch(
  ctx: LoopContext,
  deps: ExtractDeps,
  settings: BatchSettings,
  batch: PendingEpisode[],
): Promise<BatchStats> {
  const { context } = settings;
  const episodes = new Map(
    batch.map((episode, index) => [
      `E${index + 1}`,
      { id: episode.episode_id, content: episode.content },
    ]),
  );
  const knownIds = new Map([...context.known].map(([label, entity]) => [label, entity.id]));
  // One masking for the batch's calls, so a person keeps one placeholder throughout.
  const redactor = await redactorForFund(ctx.fundId, loopFlow(ctx), ctx.service);
  const extractorCall: StructuredCall = {
    model: settings.extractor.model,
    name: "interlect_brain_extract_v1",
    system: settings.extractor.prompt,
    prompt: extractorPromptText(context, batch, settings.target),
    schema: extractorJsonSchema,
    maxOutputTokens: EXTRACTOR_MAX_OUTPUT_TOKENS,
    redactor,
    // The quotes are checked against the masked episodes before the names come back.
    restore: false,
  };
  // 0,20 kr. per batch covers every call of the batch, counted at their reserved maxima.
  let reservedUsd = structuredCallMaximumUsd(extractorCall);
  if (reservedUsd > L1_BATCH_CAP_USD && batch.length > 1) {
    throw new BatchOverCapError(`L1 batch of ${batch.length} over the cap`);
  }
  const extracted = await structuredWithBudget(
    ctx,
    deps.call,
    extractorCall,
    settings.target.id,
    targetScope(settings.target),
  );
  let costUsd = extracted.costUsd;
  const parsedRaw = parseMaskedExtraction(
    extracted.output,
    { episodes, known: knownIds },
    redactor,
  );
  const labelNames = new Map<string, string>([
    ...[...context.known].map(([label, entity]) => [label, entity.name] as [string, string]),
    ...parsedRaw.entities.map((entity) => [entity.ref, entity.name] as [string, string]),
  ]);
  const parsed = {
    ...parsedRaw,
    facts: parsedRaw.facts.map((fact) => ({
      ...fact,
      statement: nameLabels(fact.statement, labelNames),
    })),
  };
  // Only fact-level structure counts: repeated known entities or one bad entity are not a
  // broken answer, and an episode without facts must not be marked failed for them.
  const structural = STRUCTURAL_FACT_REJECTIONS.reduce(
    (sum, reason) => sum + (parsed.rejected[reason] ?? 0),
    0,
  );
  if (!parsed.shapeOk || (parsed.facts.length === 0 && structural >= 3)) {
    // Not an empty episode but a broken answer: never close the episodes on it.
    const error = new BrainModelOutputError(
      `unusable extractor answer (${JSON.stringify(parsed.rejected)})`,
    );
    error.bookedUsd = costUsd;
    throw error;
  }
  await storeInstructionFlags(
    ctx,
    batch,
    new Set(parseInstructionEpisodes(extracted.output, new Set(episodes.keys()))),
  );

  // Keys first (rule 1), then candidates by name and vector for the rest.
  const keyed = parsed.entities
    .map((entity) => ({ entity, key: entityKey(entity, context.companyKey) }))
    .filter((item): item is { entity: ExtractedEntity; key: string } => item.key !== null);
  const unkeyed = parsed.entities.length - keyed.length;
  const exact = await exactMatches(ctx, keyed);
  const unresolved = keyed.filter((item) => !exact.has(`${item.entity.type}|${item.key}`));

  // A name the masking hides would embed as "person: [Person 1]", the same vector for every
  // private person, and rule 3 would merge them: such an entity gets no vector and is matched by
  // its name only.
  const entityTexts = unresolved.map((item) => {
    const text = `${item.entity.type}: ${item.entity.name}`;
    return redactor.redact(text) === text ? text : null;
  });
  const namedTexts = entityTexts.filter((text): text is string => text !== null);
  const embedTexts = [...namedTexts, ...parsed.facts.map((fact) => fact.statement)];
  let vectors: number[][] = [];
  if (embedTexts.length > 0) {
    const embedded = await embedWithBudget(
      ctx,
      embedTexts,
      settings.target.id,
      deps.embed,
      targetScope(settings.target),
      redactor,
    );
    vectors = embedded.embeddings;
    costUsd += embedded.costUsd;
  }
  let named = 0;
  const entityVectors = entityTexts.map((text) =>
    text === null ? null : (vectors[named++] ?? null),
  );
  const factVectors = vectors.slice(namedTexts.length);

  // Decide each new entity: a match, a question for the resolver, or new.
  const resolved = new Map<string, string>();
  for (const item of keyed) {
    const id = exact.get(`${item.entity.type}|${item.key}`);
    if (id) resolved.set(item.entity.ref, id);
  }
  const decisions = await mapLimited(unresolved, LOOKUP_CONCURRENCY, async (item, index) => {
    const candidates = await entityCandidates(ctx, item.entity, entityVectors[index] ?? null);
    return {
      item,
      decision: decideEntity({
        type: item.entity.type,
        exactId: null,
        candidates,
        companyKey: context.companyKey,
      }),
    };
  });
  const ambiguous: Array<{ item: (typeof unresolved)[number]; candidates: EntityCandidate[] }> = [];
  for (const { item, decision } of decisions) {
    if (decision.kind === "match") resolved.set(item.entity.ref, decision.id);
    else if (decision.kind === "ambiguous")
      ambiguous.push({ item, candidates: decision.candidates });
  }

  let resolverCalls = 0;
  let resolverUnanswered = 0;
  let resolverSkippedForCap = 0;
  const mergeCandidates: Array<{ ref: string; name: string; candidate: EntityCandidate }> = [];
  if (ambiguous.length > 0) {
    const call: StructuredCall = {
      model: settings.resolver.model,
      name: "interlect_brain_resolve_entities_v1",
      system: settings.resolver.prompt,
      prompt: entityResolverPrompt(ambiguous),
      schema: entityResolverJsonSchema,
      maxOutputTokens: RESOLVER_MAX_OUTPUT_TOKENS,
      redactor,
    };
    const maxUsd = structuredCallMaximumUsd(call);
    if (reservedUsd + maxUsd > L1_BATCH_CAP_USD) {
      // Over the cap: no resolver, so each stays new and a human is asked (merge_candidate).
      resolverSkippedForCap += ambiguous.length;
      for (const { item, candidates } of ambiguous) {
        if (candidates[0]) {
          mergeCandidates.push({
            ref: item.entity.ref,
            name: item.entity.name,
            candidate: candidates[0],
          });
        }
      }
    } else {
      reservedUsd += maxUsd;
      resolverCalls += 1;
      const answer = await structuredWithBudget(
        ctx,
        deps.call,
        call,
        settings.target.id,
        targetScope(settings.target),
      );
      costUsd += answer.costUsd;
      const byItem = parseEntityDecisions(answer.output);
      for (const [index, { item, candidates }] of ambiguous.entries()) {
        const decision = byItem.get(`I${index + 1}`);
        if (!decision) resolverUnanswered += 1;
        const confident = decision !== undefined && decision.confidence >= RESOLVER_MIN_CONFIDENCE;
        const chosen =
          decision && decision.match !== "new"
            ? candidates[Number(decision.match.replace(/^C/, "")) - 1]
            : undefined;
        if (chosen && confident) {
          resolved.set(item.entity.ref, chosen.id);
        } else if (!(decision?.match === "new" && confident)) {
          // Unsure (or unanswered): a new entity, and a human decides whether to merge.
          const candidate = chosen ?? candidates[0];
          if (candidate) {
            mergeCandidates.push({ ref: item.entity.ref, name: item.entity.name, candidate });
          }
        }
      }
    }
  }

  // Free-text facts close to an active fact about the same, already known subject.
  const subjectId = (ref: string) => knownIds.get(ref) ?? resolved.get(ref) ?? null;
  const relations = new Map<number, { kind: "supersedes" | "contradicts"; factId: string }>();
  const candidatePairs = await mapLimited(
    parsed.facts.map((fact, index) => ({ fact, index })),
    LOOKUP_CONCURRENCY,
    async ({ fact, index }) => {
      if (!FREE_TEXT_PREDICATES.includes(fact.predicate)) return null;
      const subject = subjectId(fact.subject);
      const vector = factVectors[index];
      if (!subject || !vector) return null;
      const similar = await similarActiveFact(ctx, subject, fact, vector);
      return similar ? { index, newStatement: fact.statement, old: similar } : null;
    },
  );
  const pairs = candidatePairs.filter((pair): pair is NonNullable<typeof pair> => pair !== null);
  if (pairs.length > 0) {
    const call: StructuredCall = {
      model: settings.resolver.model,
      name: "interlect_brain_resolve_facts_v1",
      system: settings.resolver.prompt,
      prompt: factResolverPrompt(pairs),
      schema: factResolverJsonSchema,
      maxOutputTokens: RESOLVER_MAX_OUTPUT_TOKENS,
      redactor,
    };
    const maxUsd = structuredCallMaximumUsd(call);
    if (reservedUsd + maxUsd > L1_BATCH_CAP_USD) {
      resolverSkippedForCap += pairs.length;
    } else {
      reservedUsd += maxUsd;
      resolverCalls += 1;
      const answer = await structuredWithBudget(
        ctx,
        deps.call,
        call,
        settings.target.id,
        targetScope(settings.target),
      );
      costUsd += answer.costUsd;
      const byItem = parseFactDecisions(answer.output);
      for (const [position, pair] of pairs.entries()) {
        const relation = byItem.get(`I${position + 1}`);
        if (!relation) resolverUnanswered += 1;
        if (relation === "supersedes" || relation === "contradicts") {
          relations.set(pair.index, { kind: relation, factId: pair.old.id });
        }
      }
    }
  }

  const applied = await applyToDatabase(
    ctx,
    settings,
    buildPayload(batch, parsed, knownIds, keyed, resolved, relations),
  );
  if (applied["skipped"] === "case_gone" || applied["skipped"] === "source_gone") {
    return { ...emptyStats(), caseGone: true, costUsd };
  }
  if (applied["skipped"] === "forgotten") return { ...emptyStats(), forgotten: true, costUsd };
  const wasted = applied["skipped"] === "already_extracted";
  const vectorsFailed = wasted
    ? 0
    : await storeVectors(ctx, settings, factVectors, applied, unresolved, entityVectors);
  // The merge insights name the extracted people: brain_insert_merge_candidates checks the forget
  // counter and writes under the same lock, so none is written after a "Glem" since the run read
  // its data.
  const mergeInserted = wasted
    ? 0
    : await mergeCandidateInsights(ctx, settings, mergeCandidates, applied);
  const flags = wasted
    ? { written: 0, failed: 0 }
    : await contradictoryEvidenceInsights(ctx, batch);

  return {
    episodes: wasted ? 0 : batch.length,
    failedEpisodes: 0,
    extracted: parsed.facts.length,
    rejected: { ...parsed.rejected, ...(unkeyed > 0 ? { unkeyed_entity: unkeyed } : {}) },
    knownRepeated: parsed.knownRepeated,
    entitiesMatched: resolved.size,
    resolverCalls,
    resolverUnanswered,
    resolverSkippedForCap,
    mergeCandidates: mergeInserted,
    evidenceFlags: flags.written,
    evidenceFlagsFailed: flags.failed,
    repaired: parsed.repaired,
    vectorsFailed,
    applied: summary(applied),
    wasted,
    caseGone: false,
    forgotten: false,
    costUsd: Number(costUsd.toFixed(6)),
  };
}

function emptyStats(): BatchStats {
  return {
    episodes: 0,
    knownRepeated: 0,
    failedEpisodes: 0,
    extracted: 0,
    rejected: {},
    entitiesMatched: 0,
    resolverCalls: 0,
    resolverUnanswered: 0,
    resolverSkippedForCap: 0,
    mergeCandidates: 0,
    evidenceFlags: 0,
    evidenceFlagsFailed: 0,
    repaired: 0,
    vectorsFailed: 0,
    applied: {},
    wasted: false,
    caseGone: false,
    forgotten: false,
    costUsd: 0,
  };
}

function mergeStats(a: BatchStats, b: BatchStats, extraCostUsd: number): BatchStats {
  const sum = (x: Record<string, unknown>, y: Record<string, unknown>) => {
    const out: Record<string, number> = {};
    for (const source of [x, y]) {
      for (const [name, value] of Object.entries(source)) {
        if (typeof value === "number") out[name] = (out[name] ?? 0) + value;
      }
    }
    return out;
  };
  return {
    episodes: a.episodes + b.episodes,
    knownRepeated: a.knownRepeated + b.knownRepeated,
    failedEpisodes: a.failedEpisodes + b.failedEpisodes,
    extracted: a.extracted + b.extracted,
    rejected: sum(a.rejected, b.rejected),
    entitiesMatched: a.entitiesMatched + b.entitiesMatched,
    resolverCalls: a.resolverCalls + b.resolverCalls,
    resolverUnanswered: a.resolverUnanswered + b.resolverUnanswered,
    resolverSkippedForCap: a.resolverSkippedForCap + b.resolverSkippedForCap,
    mergeCandidates: a.mergeCandidates + b.mergeCandidates,
    evidenceFlags: a.evidenceFlags + b.evidenceFlags,
    evidenceFlagsFailed: a.evidenceFlagsFailed + b.evidenceFlagsFailed,
    repaired: a.repaired + b.repaired,
    vectorsFailed: a.vectorsFailed + b.vectorsFailed,
    applied: sum(a.applied, b.applied),
    wasted: a.wasted && b.wasted,
    caseGone: a.caseGone || b.caseGone,
    forgotten: a.forgotten || b.forgotten,
    costUsd: Number((a.costUsd + b.costUsd + extraCostUsd).toFixed(6)),
  };
}

/** The numbers of an apply result (ids stay out of the step log). */
function summary(applied: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(applied).filter(([name]) => name !== "entityIds" && name !== "factIds"),
  );
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += limit) {
    const slice = items.slice(start, start + limit);
    out.push(...(await Promise.all(slice.map((item, offset) => run(item, start + offset)))));
  }
  return out;
}

/** The case company (K1), the case (K2) and the entities one fact away from them. */
async function loadCaseContext(ctx: LoopContext, caseId: string): Promise<CaseContext | null> {
  const { data: caseRow, error: caseError } = await ctx.service
    .from("cases")
    .select("company_id")
    .eq("id", caseId)
    .eq("fund_id", ctx.fundId)
    .maybeSingle();
  if (caseError) throw new Error(`L1 case lookup: ${caseError.message}`);
  if (!caseRow) return null;

  const findRef = async (table: "companies" | "cases", id: string) => {
    const { data, error } = await ctx.service
      .from("brain_entities")
      .select("id, type, name, normalized_key")
      .eq("fund_id", ctx.fundId)
      .eq("ref_table", table)
      .eq("ref_id", id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw new Error(`L1 ${table} entity: ${error.message}`);
    return data as { id: string; type: string; name: string; normalized_key: string } | null;
  };
  let company = await findRef("companies", caseRow["company_id"] as string);
  let caseEntity = await findRef("cases", caseId);
  if (!company || !caseEntity) {
    // L0 projects before it hands over; run it here too, so L1 never works without the anchors.
    const { error } = await ctx.service.rpc("brain_project_db_entities_checked", {
      _fund_id: ctx.fundId,
      _case_id: caseId,
    });
    if (error) throw new Error(`brain_project_db_entities_checked: ${error.message}`);
    company = await findRef("companies", caseRow["company_id"] as string);
    caseEntity = await findRef("cases", caseId);
  }
  if (!company || !caseEntity) throw new Error("L1: the case has no company or case entity");

  const known = new Map<string, KnownEntity>([
    ["K1", { id: company.id, type: company.type, name: company.name }],
    ["K2", { id: caseEntity.id, type: caseEntity.type, name: caseEntity.name }],
  ]);
  const anchors = [company.id, caseEntity.id];
  const { data: facts, error: factsError } = await ctx.service
    .from("brain_facts")
    .select("subject_id, object_id")
    .eq("fund_id", ctx.fundId)
    .is("expired_at", null)
    .or(`subject_id.in.(${anchors.join(",")}),object_id.in.(${anchors.join(",")})`)
    .limit(200);
  if (factsError) throw new Error(`L1 neighbours: ${factsError.message}`);
  const neighbourIds = new Set<string>();
  for (const fact of facts ?? []) {
    for (const id of [fact["subject_id"], fact["object_id"]] as Array<string | null>) {
      if (id && !anchors.includes(id)) neighbourIds.add(id);
    }
  }
  if (neighbourIds.size > 0) {
    const { data: neighbours, error: neighboursError } = await ctx.service
      .from("brain_entities")
      .select("id, type, name")
      .eq("fund_id", ctx.fundId)
      .eq("status", "active")
      .in("id", [...neighbourIds].slice(0, 200))
      .order("last_seen_at", { ascending: false })
      .limit(MAX_KNOWN_ENTITIES - known.size);
    if (neighboursError) throw new Error(`L1 neighbour entities: ${neighboursError.message}`);
    for (const entity of neighbours ?? []) {
      known.set(`K${known.size + 1}`, {
        id: entity["id"] as string,
        type: entity["type"] as string,
        name: entity["name"] as string,
      });
    }
  }
  return { companyKey: company.normalized_key, known };
}

function extractorPromptText(
  context: CaseContext,
  batch: PendingEpisode[],
  target: Target,
): string {
  const known = [...context.known]
    .map(([label, entity]) => `${label} · ${entity.type} · ${entity.name}`)
    .join("\n");
  const episodes = batch
    .map((episode, index) => {
      const date = episode.occurred_at ? episode.occurred_at.slice(0, 10) : "ukendt";
      // The quotes end the title, so a name at its end never runs into the content when the
      // prompt is masked (the quote check masks each episode on its own).
      const title = episode.title ? ` · "${episode.title}"` : "";
      return `[E${index + 1}] ${episode.kind} · kilde: ${episode.trust_tier} · dato: ${date}${title}\n${episode.content}`;
    })
    .join("\n\n");
  if (target.kind === "source") {
    return `Source document, not a case: there is no case company. Name every company and person the text itself names.\n\nEpisodes:\n${episodes}`;
  }
  return `Known entities (K1 is the case company, K2 the case):\n${known}\n\nEpisodes:\n${episodes}`;
}

async function exactMatches(
  ctx: LoopContext,
  keyed: Array<{ entity: ExtractedEntity; key: string }>,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const keys = [...new Set(keyed.map((item) => item.key))];
  if (keys.length === 0) return found;
  const { data, error } = await ctx.service
    .from("brain_entities")
    .select("id, type, normalized_key, status, merged_into")
    .eq("fund_id", ctx.fundId)
    .in("normalized_key", keys)
    .neq("status", "deleted");
  if (error) throw new Error(`L1 entity keys: ${error.message}`);
  for (const row of data ?? []) {
    const id = (row["status"] === "merged" ? row["merged_into"] : row["id"]) as string | null;
    if (id) found.set(`${row["type"] as string}|${row["normalized_key"] as string}`, id);
  }
  return found;
}

/** Candidates by name (trigram; an equal normalised name counts as 1) and by vector. */
async function entityCandidates(
  ctx: LoopContext,
  entity: ExtractedEntity,
  vector: number[] | null,
): Promise<EntityCandidate[]> {
  const search = async (args: { _query?: string; _query_embedding?: string }) => {
    const { data, error } = await ctx.service.rpc("brain_search_entities", {
      _fund_id: ctx.fundId,
      _query: args._query ?? null,
      _query_embedding: args._query_embedding ?? null,
      _types: [entity.type satisfies EntityType],
      _limit: 5,
    });
    if (error) throw new Error(`brain_search_entities: ${error.message}`);
    return (data ?? []) as Array<{ entity_id: string; list: string; score: number }>;
  };
  const [byName, byVector] = await Promise.all([
    search({ _query: entity.name }),
    vector ? search({ _query_embedding: JSON.stringify(vector) }) : Promise.resolve([]),
  ]);
  const ids = [...new Set([...byName, ...byVector].map((row) => row.entity_id))];
  if (ids.length === 0) return [];
  const { data, error } = await ctx.service
    .from("brain_entities")
    .select("id, name, normalized_key")
    .eq("fund_id", ctx.fundId)
    .in("id", ids);
  if (error) throw new Error(`L1 candidates: ${error.message}`);
  const own = normalizeEntityName(entity.name);
  return (data ?? []).map((row) => {
    const name = row["name"] as string;
    const trigram = byName.find((hit) => hit.entity_id === row["id"])?.score ?? null;
    const sameName = own !== null && normalizeEntityName(name) === own;
    return {
      id: row["id"] as string,
      name,
      normalizedKey: row["normalized_key"] as string,
      trigram: sameName ? 1 : trigram,
      cosine: byVector.find((hit) => hit.entity_id === row["id"])?.score ?? null,
    };
  });
}

/** The closest active fact about the subject, when it is similar but not the same text. */
async function similarActiveFact(
  ctx: LoopContext,
  subject: string,
  fact: ExtractedFact,
  vector: number[],
): Promise<{ id: string; statement: string } | null> {
  const { data, error } = await ctx.service.rpc("brain_search_facts", {
    _fund_id: ctx.fundId,
    _query: null,
    _query_embedding: JSON.stringify(vector),
    _valid_at: null,
    _subject_ids: [subject],
    _limit: 3,
  });
  if (error) throw new Error(`brain_search_facts: ${error.message}`);
  const hits = ((data ?? []) as Array<{ fact_id: string; score: number }>).filter(
    (hit) => hit.score >= FREE_TEXT_SIMILARITY,
  );
  if (hits.length === 0) return null;
  const { data: rows, error: rowsError } = await ctx.service
    .from("brain_facts")
    .select("id, statement, predicate")
    .eq("fund_id", ctx.fundId)
    .in(
      "id",
      hits.map((hit) => hit.fact_id),
    );
  if (rowsError) throw new Error(`L1 similar facts: ${rowsError.message}`);
  const own = normalizeForQuote(fact.statement);
  for (const hit of hits) {
    const row = (rows ?? []).find((candidate) => candidate["id"] === hit.fact_id);
    if (!row || row["predicate"] !== fact.predicate) continue;
    // The same text is a duplicate, which brain_apply_extraction handles itself.
    if (normalizeForQuote(row["statement"] as string) === own) continue;
    return { id: row["id"] as string, statement: row["statement"] as string };
  }
  return null;
}

function entityResolverPrompt(
  ambiguous: Array<{ item: { entity: ExtractedEntity }; candidates: EntityCandidate[] }>,
): string {
  const items = ambiguous
    .map(({ item, candidates }, index) => {
      const options = candidates
        .map(
          (candidate, position) =>
            `  C${position + 1}: ${candidate.name} (${candidate.normalizedKey})`,
        )
        .join("\n");
      return `I${index + 1}: ${item.entity.type} "${item.entity.name}"\n${options}`;
    })
    .join("\n\n");
  return `Task: entities\n\n${items}`;
}

function factResolverPrompt(
  pairs: Array<{ newStatement: string; old: { statement: string } }>,
): string {
  const items = pairs
    .map(
      (pair, index) => `I${index + 1}:\n  NEW: ${pair.newStatement}\n  OLD: ${pair.old.statement}`,
    )
    .join("\n\n");
  return `Task: facts\n\n${items}`;
}

type Payload = {
  episodes: string[];
  failed?: string[];
  entities: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
};

/** Every ref a fact uses (known by id, resolved by id, or new with its key) and the facts. */
function buildPayload(
  batch: PendingEpisode[],
  parsed: { facts: ExtractedFact[] },
  knownIds: Map<string, string>,
  keyed: Array<{ entity: ExtractedEntity; key: string }>,
  resolved: Map<string, string>,
  relations: Map<number, { kind: "supersedes" | "contradicts"; factId: string }>,
): Payload {
  const usedRefs = new Set(parsed.facts.flatMap((fact) => [fact.subject, fact.object ?? ""]));
  // Only a source that may create active facts may add an alias (a note or a web page could
  // otherwise steer later entity matching);.
  const proposalTiers = new Set(["user_note", "public_web"]);
  const tierOf = new Map(batch.map((episode) => [episode.episode_id, episode.trust_tier]));
  const aliasRefs = new Set(
    parsed.facts
      .filter((fact) => !proposalTiers.has(tierOf.get(fact.episodeId) ?? "public_web"))
      .flatMap((fact) => [fact.subject, fact.object ?? ""]),
  );
  const entities: Array<Record<string, unknown>> = [];
  for (const [label, id] of knownIds) {
    if (usedRefs.has(label)) entities.push({ ref: label, id });
  }
  for (const { entity, key } of keyed) {
    if (!usedRefs.has(entity.ref)) continue;
    const id = resolved.get(entity.ref);
    // A found entity keeps its name; the spelling in this episode becomes an alias.
    entities.push(
      id
        ? { ref: entity.ref, id, aliases: aliasRefs.has(entity.ref) ? [entity.name] : [] }
        : { ref: entity.ref, type: entity.type, name: entity.name, key, aliases: [] },
    );
  }
  return {
    episodes: batch.map((episode) => episode.episode_id),
    entities,
    facts: parsed.facts.map((fact, index) => ({ ...fact, relation: relations.get(index) ?? null })),
  };
}

type Applied = Record<string, unknown> & {
  entityIds?: Record<string, string>;
  factIds?: Array<string | null>;
};

async function applyToDatabase(
  ctx: LoopContext,
  settings: Pick<BatchSettings, "target" | "forgetGeneration">,
  payload: Payload,
): Promise<Applied> {
  const { target } = settings;
  // _checked: nothing is saved when something was forgotten since the run read its data.
  const fn =
    target.kind === "source"
      ? "brain_apply_extraction_source_checked"
      : "brain_apply_extraction_checked";
  const { data, error } = await ctx.service.rpc(fn, {
    _fund_id: ctx.fundId,
    ...(target.kind === "source" ? { _source_id: target.id } : { _case_id: target.id }),
    _job_id: ctx.jobId,
    _batch: payload,
    _forget_generation: settings.forgetGeneration,
  });
  if (error) throw new Error(`${fn}: ${error.message}`);
  if (!data || typeof data !== "object") throw new Error(`${fn}: no result`);
  return data as Applied;
}

/** Stores the vectors of new facts and entities; returns how many could not be stored. */
async function storeVectors(
  ctx: LoopContext,
  settings: Pick<BatchSettings, "forgetGeneration">,
  factVectors: number[][],
  applied: Applied,
  unresolved: Array<{ entity: ExtractedEntity }>,
  entityVectors: Array<number[] | null>,
): Promise<number> {
  const rows: VectorRow[] = [];
  for (const [index, id] of (applied.factIds ?? []).entries()) {
    const embedding = factVectors[index];
    if (id && embedding) rows.push({ table: "fact", id, embedding, onlyIfNull: true });
  }
  for (const [index, item] of unresolved.entries()) {
    const id = applied.entityIds?.[item.entity.ref];
    const embedding = entityVectors[index];
    if (id && embedding) {
      rows.push({ table: "entity", id, embedding, onlyIfNull: true, notCase: true });
    }
  }
  if (rows.length === 0) return 0;
  // A "Glem" since the run read its data stores nothing: the rows keep no vector (searches skip
  // them), which is what the forgetting leaves for a masked text too.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await storeVectorsChecked(ctx.service, ctx.fundId, settings.forgetGeneration, rows);
      return 0;
    } catch (cause) {
      // The vectors are paid for: one more try before they are counted as missing.
      if (attempt === 1) {
        console.error(
          "[brain] L1 vectors not stored",
          cause instanceof Error ? cause.message : cause,
        );
      }
    }
  }
  return rows.length;
}

/** One merge_candidate insight per unsure pair; returns how many were written. */
async function mergeCandidateInsights(
  ctx: LoopContext,
  settings: Pick<BatchSettings, "forgetGeneration">,
  candidates: Array<{ ref: string; name: string; candidate: EntityCandidate }>,
  applied: Applied,
): Promise<number> {
  const rows: Array<{ title: string; body_md: string; refs: unknown[]; dedupe_key: string }> = [];
  for (const { ref, name, candidate } of candidates) {
    const created = applied.entityIds?.[ref];
    if (!created || created === candidate.id) continue;
    const [first, second] = [created, candidate.id].sort();
    rows.push({
      title: serverText("brainServer.merge.question", { a: name, b: candidate.name }).slice(0, 300),
      body_md: serverText("brainServer.merge.unsure", { a: name, b: candidate.name }),
      refs: [
        { kind: "entity", id: created },
        { kind: "entity", id: candidate.id },
      ],
      dedupe_key: `merge_candidate:${first}:${second}`,
    });
  }
  if (rows.length === 0) return 0;
  const { data, error } = await ctx.service.rpc("brain_insert_merge_candidates", {
    _fund_id: ctx.fundId,
    _forget_generation: settings.forgetGeneration,
    _rows: rows,
  });
  if (error) {
    // The insights are a hint, not the batch: a failed write is logged and the batch goes on.
    console.error("[brain] merge_candidate insights", error.code, error.message);
    return 0;
  }
  return Number((data as { written?: unknown } | null)?.written ?? 0);
}

/**
 * The known contradiction: evidence the analysis itself marked contradictory gets one
 * insight whether or not the model found a fact in it (brain_apply_extraction adds the fact
 * when there is one; the dedupe key is the same, so there is never a second insight). Runs after
 * the batch is applied, so it never throws: a failure is logged and counted in the step.
 */
async function contradictoryEvidenceInsights(
  ctx: LoopContext,
  batch: PendingEpisode[],
): Promise<{ written: number; failed: number }> {
  const candidates = batch.filter(
    (episode) =>
      episode.kind === "evidence" &&
      episode.trust_tier !== "public_web" &&
      episode.trust_tier !== "user_note",
  );
  if (candidates.length === 0) return { written: 0, failed: 0 };
  try {
    const { data: episodes, error } = await ctx.service
      .from("brain_episodes")
      .select("id, ref_id")
      .eq("fund_id", ctx.fundId)
      .eq("ref_table", "evidence_items")
      .in(
        "id",
        candidates.map((episode) => episode.episode_id),
      );
    if (error) throw new Error(`evidence episodes: ${error.message}`);
    const episodeOf = new Map(
      (episodes ?? []).map((row) => [row["ref_id"] as string, row["id"] as string]),
    );
    if (episodeOf.size === 0) return { written: 0, failed: 0 };
    const { data: flagged, error: evidenceError } = await ctx.service
      .from("evidence_items")
      .select("id, claim")
      .eq("fund_id", ctx.fundId)
      .eq("status", "contradictory")
      .in("id", [...episodeOf.keys()]);
    if (evidenceError) throw new Error(`contradictory evidence: ${evidenceError.message}`);
    let written = 0;
    let failed = 0;
    for (const row of flagged ?? []) {
      const evidenceId = row["id"] as string;
      const { data: inserted, error: insightError } = await ctx.service
        .from("brain_insights")
        .upsert(
          {
            fund_id: ctx.fundId,
            kind: "contradiction",
            title: serverText("brainServer.merge.contradictionTitle", {
              claim: String(
                row["claim"] ?? serverText("brainServer.merge.contradictionEvidence"),
              ).slice(0, 250),
            }),
            body_md: serverText("brainServer.merge.contradictionBody"),
            refs: [
              { kind: "evidence", id: evidenceId },
              { kind: "episode", id: episodeOf.get(evidenceId) ?? null },
            ],
            priority: 2,
            created_by_loop: "L1_extract",
            dedupe_key: `contradiction:evidence:${evidenceId}`,
          },
          { onConflict: "fund_id,dedupe_key", ignoreDuplicates: true },
        )
        .select("id");
      if (insightError) {
        failed += 1;
        console.error(
          "[brain] evidence contradiction insight",
          insightError.code,
          insightError.message,
        );
      } else {
        written += (inserted ?? []).length;
      }
    }
    return { written, failed };
  } catch (cause) {
    console.error(
      "[brain] evidence contradiction insights skipped",
      cause instanceof Error ? cause.message : cause,
    );
    return { written: 0, failed: candidates.length };
  }
}
