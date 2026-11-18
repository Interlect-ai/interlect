/**
 * L4 · Søvn (L4), steps 1–5 and 7–9: the order of the steps, when a fund is
 * skipped, and what the resolver's answer on name twins becomes. The work itself is SQL (0063,
 * 0064); the paid calls are the resolver in step 2 and the page writer in step 5 (loops/pages.ts,
 * which also clears dirty_at for the pages it finished), both on the fund's budget. Step 6
 * (anticipated questions) comes with. No I/O here, so it is tested with node --test.
 */
import type { EntityType } from "./contracts/extract.ts";
import { RESOLVER_MIN_CONFIDENCE } from "./extract.ts";
import { serverText } from "../i18n/server-text.ts";

/** Cases whose raw rows lack an episode, re-captured per night (point 3). */
export const RECONCILE_CASE_LIMIT = 50;
/** Name twins sent to the resolver per night (06 L4 step 2, "20 par"). */
export const DUPLICATE_PAIR_LIMIT = 20;
/** Name twins the resolver calls the same with at least this confidence are merged by Brain itself. */
export const AUTO_MERGE_MIN_CONFIDENCE = 0.9;
/** Cases whose similar_to facts are recomputed per night (06 L4 step 7). */
export const SIMILAR_CASE_LIMIT = 200;

export type NightlyActivity = {
  /** Start of the last finished L4 run; null on the first run. */
  since: string | null;
  episodes: number;
  feedback: number;
  retrievals: number;
  entities: number;
  bulletEvents: number;
};

/** 06 L4: only funds with something new since the last run do more than reconcile (0 kr). */
export function hasNewActivity(activity: NightlyActivity): boolean {
  return (
    activity.episodes > 0 ||
    activity.feedback > 0 ||
    activity.retrievals > 0 ||
    activity.entities > 0 ||
    activity.bulletEvents > 0
  );
}

export function parseActivity(raw: unknown): NightlyActivity {
  const row = (raw ?? {}) as Record<string, unknown>;
  const count = (key: string) => Math.max(0, Number(row[key] ?? 0) || 0);
  return {
    since: typeof row["since"] === "string" ? row["since"] : null,
    episodes: count("episodes"),
    feedback: count("feedback"),
    retrievals: count("retrievals"),
    entities: count("entities"),
    bulletEvents: count("bulletEvents"),
  };
}

export type PairEntity = { id: string; name: string; type: EntityType; key: string };
export type DuplicatePair = {
  a: PairEntity;
  b: PairEntity;
  trigram: number | null;
  cosine: number | null;
};

export function parseDuplicatePairs(raw: unknown): DuplicatePair[] {
  if (!Array.isArray(raw)) return [];
  const entity = (value: unknown): PairEntity | null => {
    const row = (value ?? {}) as Record<string, unknown>;
    const { id, name, type, key } = row;
    if (typeof id !== "string" || typeof name !== "string" || typeof type !== "string") return null;
    return { id, name, type: type as EntityType, key: typeof key === "string" ? key : "" };
  };
  const score = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  const out: DuplicatePair[] = [];
  for (const value of raw) {
    const row = (value ?? {}) as Record<string, unknown>;
    const a = entity(row["a"]);
    const b = entity(row["b"]);
    if (a && b && a.id !== b.id) {
      out.push({ a, b, trigram: score(row["trigram"]), cosine: score(row["cosine"]) });
    }
  }
  return out;
}

/** The resolver's "entities" task (prompts/resolver.ts): each pair is an item with one candidate. */
export function duplicateResolverPrompt(pairs: readonly DuplicatePair[]): string {
  const items = pairs
    .map(
      (pair, index) =>
        `I${index + 1}: ${pair.a.type} "${pair.a.name}" (${pair.a.key})\n  C1: ${pair.b.name} (${pair.b.key})`,
    )
    .join("\n\n");
  return `Task: entities\n\n${items}`;
}

export type PairVerdict =
  | { kind: "same"; confidence: number }
  | { kind: "different"; confidence: number }
  | { kind: "unsure" };

/** The resolver's answer per pair; unanswered or below RESOLVER_MIN_CONFIDENCE is "unsure". */
export function pairVerdicts(
  pairs: readonly DuplicatePair[],
  decisions: ReadonlyMap<string, { match: string; confidence: number }> | null,
): PairVerdict[] {
  return pairs.map((_, index) => {
    const decision = decisions?.get(`I${index + 1}`);
    if (!decision || decision.confidence < RESOLVER_MIN_CONFIDENCE) return { kind: "unsure" };
    if (decision.match === "C1") return { kind: "same", confidence: decision.confidence };
    if (decision.match === "new") return { kind: "different", confidence: decision.confidence };
    return { kind: "unsure" };
  });
}

/** The pairs Brain merges without asking: "same" with confidence >= AUTO_MERGE_MIN_CONFIDENCE. */
export function autoMergePairs(
  pairs: readonly DuplicatePair[],
  verdicts: readonly PairVerdict[],
): Array<{ a: string; b: string; confidence: number }> {
  const out: Array<{ a: string; b: string; confidence: number }> = [];
  pairs.forEach((pair, index) => {
    const verdict = verdicts[index];
    if (verdict?.kind === "same" && verdict.confidence >= AUTO_MERGE_MIN_CONFIDENCE) {
      out.push({ a: pair.a.id, b: pair.b.id, confidence: verdict.confidence });
    }
  });
  return out;
}

export type InsightRow = {
  fund_id: string;
  kind: "merge_candidate";
  title: string;
  body_md: string;
  refs: Array<{ kind: "entity"; id: string }>;
  priority: 1 | 2 | 3;
  status: "new" | "dismissed";
  created_by_loop: "L4_nightly";
  dedupe_key: string;
};

/**
 * One merge_candidate insight per pair, with the resolver's recommendation (06 L4 step 2). Only
 * the same CVR or domain merges by itself (0063); a human decides the rest. A pair the resolver
 * calls different with confidence is stored as dismissed: it stays out of the feed, and its dedupe
 * key (the same as L1's) keeps it from being asked again.
 */
export function duplicateInsight(
  fundId: string,
  pair: DuplicatePair,
  verdict: PairVerdict,
): InsightRow {
  const [first, second] = [pair.a.id, pair.b.id].sort();
  // The text never says how sure Brain is.
  const body =
    verdict.kind === "same"
      ? serverText("brainServer.merge.same")
      : verdict.kind === "different"
        ? serverText("brainServer.merge.different")
        : serverText("brainServer.merge.doubt");
  return {
    fund_id: fundId,
    kind: "merge_candidate",
    title: serverText("brainServer.merge.question", { a: pair.a.name, b: pair.b.name }).slice(
      0,
      300,
    ),
    body_md: body,
    refs: [
      { kind: "entity", id: pair.a.id },
      { kind: "entity", id: pair.b.id },
    ],
    priority: verdict.kind === "same" ? 2 : 3,
    status: verdict.kind === "different" ? "dismissed" : "new",
    created_by_loop: "L4_nightly",
    dedupe_key: `merge_candidate:${first}:${second}`,
  };
}

/** Why the resolver gave no answer this night: the pairs then get an insight without one. */
export type ResolverStop = "budget" | "policy" | "output";
export type ResolverAnswer =
  | { decisions: ReadonlyMap<string, { match: string; confidence: number }>; costUsd: number }
  | { stopped: ResolverStop; costUsd: number };

/** What the night needs from the outside; the loop wires the database and the model. */
export interface NightlyDeps {
  fundId: string;
  jobId: string;
  attempt: number;
  /** Steps this job already stored (a retried message): step -> output. */
  doneSteps(): Promise<Map<string, unknown>>;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  recordStep(step: string, output: unknown, costUsd?: number): Promise<boolean>;
  /** Enqueues L0 for a case marked by the reconciliation (key = case and mark time). */
  enqueueCapture(caseId: string, changedAt: Date): Promise<void>;
  resolvePairs(pairs: readonly DuplicatePair[]): Promise<ResolverAnswer>;
  /** Step 5: Brain pages (computed sections, the page writer); stats and cost. */
  refreshPages(): Promise<{ output: unknown; costUsd: number }>;
  /** Step 6: embeds extracted facts that never got a vector; stats and cost. */
  embedFacts?(): Promise<{ output: unknown; costUsd: number }>;
  /** Inserts insights, ignoring ones whose dedupe key exists; returns how many were new. */
  insertInsights(rows: readonly InsightRow[]): Promise<number>;
}

export type NightlyResult = { status: "done" | "skipped"; stats: Record<string, unknown> };

/**
 * One night for one fund. Every step is idempotent and stored when it ends, so a retried message
 * skips the stored ones (usefulness stores its own step together with its watermark, 0063).
 */
export async function runNightly(deps: NightlyDeps): Promise<NightlyResult> {
  const done = await deps.doneSteps();
  const stats: Record<string, unknown> = {};
  let costUsd = 0;
  const base = { _fund_id: deps.fundId };

  const step = async (
    name: string,
    work: () => Promise<{ output: unknown; costUsd?: number; stored?: boolean }>,
  ): Promise<unknown> => {
    if (done.has(name)) {
      stats[name] = done.get(name);
      return done.get(name);
    }
    const result = await work();
    if (!result.stored) await deps.recordStep(name, result.output, result.costUsd ?? 0);
    costUsd += result.costUsd ?? 0;
    stats[name] = result.output;
    return result.output;
  };

  // 1 · Reconciliation: free, and also for a fund without anything new (a lost enqueue).
  await step("reconcile", async () => {
    const marked = await deps.rpc("brain_nightly_reconcile", {
      ...base,
      _limit: RECONCILE_CASE_LIMIT,
    });
    const rows = Array.isArray(marked) ? (marked as Array<Record<string, unknown>>) : [];
    let enqueued = 0;
    let failed = 0;
    for (const row of rows) {
      const caseId = row["caseId"];
      const changedAt = new Date(String(row["changedAt"]));
      if (typeof caseId !== "string" || Number.isNaN(changedAt.getTime())) continue;
      try {
        await deps.enqueueCapture(caseId, changedAt);
        enqueued += 1;
      } catch (cause) {
        // The mark stays in brain_capture_queue; the cron re-queues stale marks.
        failed += 1;
        console.error(
          "[brain] L4 reconcile enqueue",
          cause instanceof Error ? cause.message : cause,
        );
      }
    }
    return { output: { cases: rows.length, enqueued, failed } };
  });

  const activity = parseActivity(
    await step("activity", async () => ({
      output: await deps.rpc("brain_nightly_activity", { ...base, _job_id: deps.jobId }),
    })),
  );
  if (!hasNewActivity(activity)) {
    return { status: "skipped", stats: { ...stats, reason: "nothing_new", costUsd: 0 } };
  }
  const since = activity.since;

  // 2 · Duplicates: same CVR or domain merges; name twins get the resolver's recommendation.
  await step("merge", async () => ({
    output: await deps.rpc("brain_nightly_identity_merges", { ...base, _job_id: deps.jobId }),
  }));
  await step("duplicates", async () => {
    const pairs = parseDuplicatePairs(
      await deps.rpc("brain_nightly_duplicate_pairs", { ...base, _limit: DUPLICATE_PAIR_LIMIT }),
    );
    if (pairs.length === 0) return { output: { pairs: 0 } };
    const answer = await deps.resolvePairs(pairs);
    const verdicts = pairVerdicts(pairs, "decisions" in answer ? answer.decisions : null);
    const inserted = await deps.insertInsights(
      pairs.map((pair, index) => duplicateInsight(deps.fundId, pair, verdicts[index]!)),
    );
    const count = (kind: PairVerdict["kind"]) => verdicts.filter((v) => v.kind === kind).length;
    // A pair the resolver is sure about is merged now (reversible with "Adskil"); the rest
    // keep their insight.
    const sure = autoMergePairs(pairs, verdicts);
    const merged =
      sure.length > 0
        ? await deps.rpc("brain_nightly_auto_merge", {
            ...base,
            _pairs: sure,
            _job_id: deps.jobId,
          })
        : null;
    return {
      output: {
        pairs: pairs.length,
        same: count("same"),
        different: count("different"),
        unsure: count("unsure"),
        inserted,
        ...(merged ? { autoMerge: merged } : {}),
        ...("stopped" in answer ? { resolverStopped: answer.stopped } : {}),
      },
      costUsd: answer.costUsd,
    };
  });

  // 3 · Lint: contradictions without an insight, stale numbers, orphaned entities.
  await step("lint", async () => ({
    output: await deps.rpc("brain_nightly_lint", { ...base, _job_id: deps.jobId }),
  }));

  // 3b · Settle: the stronger and newer fact wins a contradiction; a lesson three cases
  // have confirmed becomes active. Free, and every decision is logged with its reason.
  await step("settle", async () => ({
    output: await deps.rpc("brain_nightly_settle", { ...base, _job_id: deps.jobId }),
  }));

  // 4 · Usefulness: SQL stores the step with its watermark in the same transaction.
  await step("usefulness", async () => ({
    output: await deps.rpc("brain_nightly_usefulness", {
      ...base,
      _job_id: deps.jobId,
      _attempt: deps.attempt,
    }),
    stored: true,
  }));

  // 5 · Brain pages.
  await step("pages", () => deps.refreshPages());

  // 6 · Vectors for extracted facts that never got one (a search skips a fact without a vector).
  if (deps.embedFacts) await step("vectors", () => deps.embedFacts!());

  // 7 · Similar cases, 8 · lessons, 9 · clean-up.
  await step("similar", async () => ({
    output: await deps.rpc("brain_nightly_similar", {
      ...base,
      _since: since,
      _limit: SIMILAR_CASE_LIMIT,
    }),
  }));
  await step("lessons", async () => ({
    output: await deps.rpc("brain_nightly_lessons", { ...base, _job_id: deps.jobId }),
  }));
  await step("cleanup", async () => ({
    output: await deps.rpc("brain_nightly_cleanup", { ...base, _job_id: deps.jobId }),
  }));

  return { status: "done", stats: { ...stats, costUsd: Number(costUsd.toFixed(6)) } };
}
