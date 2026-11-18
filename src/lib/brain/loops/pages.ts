import { AiDataPolicyError } from "@/lib/ai/gateway-options";
import { isPermanentPolicyStop } from "@/lib/ai/model-call";
import type { Redactor } from "@/lib/ai/redact";
import { redactorForFund } from "@/lib/ai/redact-dictionary.server";
import type { LoopContext } from "../worker.server";
import { BrainBudgetReachedError, BrainLeaseLostError, BrainModelOutputError } from "../errors";
import { brainModel, brainPrompt } from "../models.server";
import { serverText } from "@/lib/i18n/server-text";
import {
  applyPageOps,
  assemblePage,
  citedIds,
  computedSections,
  factRefs,
  headingFor,
  pageOpsJsonSchema,
  pageSearchText,
  pageWriterPrompt,
  parsePageOps,
  rewriteRefs,
  WRITER_KEYS,
  writerFacts,
  writerInputHash,
  writerSectionsToIds,
  type PageData,
  type PageFact,
  type PageKind,
  type PageSection,
  type WrittenSection,
} from "../pages";
import { PAGE_WRITER_PROMPT_KEY, PAGE_WRITER_PROMPT_V1 } from "../prompts/page-writer";
import { outputLanguageDirective } from "../../i18n/ai-language";
import { loadFundLanguage } from "../../i18n/fund-language.server";
import { loopFlow, MODEL_TIMEOUT_MS, structuredWithBudget, type StructuredCaller } from "./shared";

/** Pages refreshed per night (computed sections, free). */
export const PAGE_TARGET_LIMIT = 200;
/** Page writer calls per night (06 L4 step 5, "60 sider"). */
export const PAGE_WRITER_LIMIT = 60;
/**
 * A queue invocation lives 300 s (nitro.config.ts). Counted from the start of the run (ctx.now):
 * no writer call starts later than one model timeout plus a margin before that, and no page at
 * all after PAGES_END_MS, so the steps after this one have time too.
 */
export const INVOCATION_MS = 300_000;
const WRITER_START_LIMIT_MS = INVOCATION_MS - MODEL_TIMEOUT_MS - 40_000;
const PAGES_END_MS = INVOCATION_MS - 60_000;
const PAGE_CONCURRENCY = 4;
const WRITER_MAX_OUTPUT_TOKENS = 6_000;

type Target = {
  entityId: string;
  kind: PageKind;
  title: string;
  dirtyAt: string | null;
  writer: boolean;
};

type PagesStats = {
  targets: number;
  saved: number;
  changed: number;
  writerCalls: number;
  writerUnchanged: number;
  writerOps: number;
  writerIgnored: number;
  removedSentences: number;
  writerSkipped: number;
  writerFailed: number;
  failed: number;
  writerStopped?: "budget" | "policy";
  /** Something was forgotten during the run: the rest of the pages wait for the next night. */
  stopped?: "forgotten";
};

type WriterState = {
  model: Parameters<typeof structuredWithBudget>[2]["model"];
  prompt: string;
  redactor: Redactor;
  calls: number;
  stopped: "budget" | "policy" | null;
};

/**
 * L4 step 5: the thesis and fund overview pages and up to PAGE_TARGET_LIMIT entity
 * pages that are missing or stale (0064), the page writer's pages first. Computed sections are
 * drawn from the database; the page writer rewrites the written sections of the pages of active
 * or recently opened cases (case and company), at most PAGE_WRITER_LIMIT a night, on the fund's
 * "learning" budget, and only when its input changed (input hash). Every fact reference is
 * checked against the fund's active facts: a sentence resting on another goes, and a writer
 * sentence without a reference goes too. A page whose writer had to wait (cap, time, budget)
 * stays dirty for the next night. One page failing never stops the others, but a step where
 * every page failed is an error, so the job is retried and reported. The fund's forget counter
 * (0092) is read before any data: a "Glem kilde" or "Glem person" during the run makes the save
 * refuse what the run read before it, and the step stops; the pages are drawn from clean
 * data next night.
 */
export async function refreshBrainPages(
  ctx: LoopContext,
  call: StructuredCaller,
): Promise<{ output: PagesStats; costUsd: number }> {
  const runStart = ctx.now.getTime();
  const stats: PagesStats = {
    targets: 0,
    saved: 0,
    changed: 0,
    writerCalls: 0,
    writerUnchanged: 0,
    writerOps: 0,
    writerIgnored: 0,
    removedSentences: 0,
    writerSkipped: 0,
    writerFailed: 0,
    failed: 0,
  };
  let costUsd = 0;
  const now = new Date().toISOString();
  const generation = await rpc(ctx, "brain_forget_generation", { _fund_id: ctx.fundId });
  if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 0) {
    throw new Error(`brain_forget_generation: unexpected value ${String(generation)}`);
  }

  for (const kind of ["thesis", "fund_overview"] as const) {
    if (stats.stopped) break;
    try {
      const data = (await rpc(ctx, "brain_page_data", {
        _fund_id: ctx.fundId,
        _kind: kind,
        _entity_id: null,
      })) as PageData;
      const current = await currentPage(ctx, kind, null);
      const sections = assemblePage(
        kind,
        current.sections,
        computedSections(kind, data),
        written(current.sections),
        now,
      );
      await save(ctx, stats, generation, {
        kind,
        entityId: null,
        title: serverText(
          kind === "thesis"
            ? "brainServer.pages.titles.thesis"
            : "brainServer.pages.titles.fundOverview",
        ),
        sections,
        dirtyAt: null,
        finished: true,
        inputHash: null,
        note: serverText("brainServer.pages.computedNote"),
      });
    } catch (cause) {
      if (isFatal(cause)) throw cause;
      stats.failed += 1;
      console.error(`[brain] L4 ${kind} page`, cause instanceof Error ? cause.message : cause);
    }
  }

  if (stats.stopped) return { output: stats, costUsd: Number(costUsd.toFixed(6)) };
  const targets = parseTargets(
    await rpc(ctx, "brain_page_targets", { _fund_id: ctx.fundId, _limit: PAGE_TARGET_LIMIT }),
  );
  stats.targets = targets.length;
  const writer = await writerSettings(ctx);

  let next = 0;
  let fatal: unknown = null;
  const worker = async () => {
    while (
      fatal === null &&
      !stats.stopped &&
      next < targets.length &&
      Date.now() - runStart < PAGES_END_MS
    ) {
      const target = targets[next++]!;
      try {
        const spent = await refreshOne(ctx, call, writer, target, stats, now, runStart, generation);
        costUsd += spent;
      } catch (cause) {
        if (isFatal(cause)) {
          // A lost lease or a masking dictionary that failed to load: the other workers stop
          // too, and the job is retried.
          fatal = cause;
          return;
        }
        stats.failed += 1;
        console.error(
          `[brain] L4 page ${target.kind} ${target.entityId}`,
          cause instanceof Error ? cause.message : cause,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, worker));
  if (fatal !== null) throw fatal;
  if (writer.stopped) stats.writerStopped = writer.stopped;
  if (stats.failed > 0 && stats.saved === 0) {
    throw new Error(`L4 pages: all ${stats.failed} pages failed`);
  }
  return { output: stats, costUsd: Number(costUsd.toFixed(6)) };
}

function isFatal(cause: unknown): boolean {
  return (
    cause instanceof BrainLeaseLostError ||
    (cause instanceof AiDataPolicyError && !isPermanentPolicyStop(cause))
  );
}

async function writerSettings(ctx: LoopContext): Promise<WriterState> {
  const [model, prompt, redactor, language] = await Promise.all([
    brainModel(ctx.service, ctx.fundId, "page_writer"),
    brainPrompt(ctx.service, ctx.fundId, PAGE_WRITER_PROMPT_KEY, PAGE_WRITER_PROMPT_V1),
    redactorForFund(ctx.fundId, loopFlow(ctx), ctx.service),
    loadFundLanguage(ctx.service, ctx.fundId),
  ]);
  // The pages are shown to the team, so they are written in the fund's language.
  return {
    model,
    prompt: `${prompt.body}${outputLanguageDirective(language)}`,
    redactor,
    calls: 0,
    stopped: null,
  };
}

async function refreshOne(
  ctx: LoopContext,
  call: StructuredCaller,
  writer: WriterState,
  target: Target,
  stats: PagesStats,
  now: string,
  runStart: number,
  generation: number,
): Promise<number> {
  const data = (await rpc(ctx, "brain_page_data", {
    _fund_id: ctx.fundId,
    _kind: target.kind,
    _entity_id: target.entityId,
  })) as PageData | null;
  if (!data) return 0;
  const current = await currentPage(ctx, target.kind, target.entityId);
  const locked = new Set(current.sections.filter((s) => s.locked_by_user).map((s) => s.key));

  // Every reference in a written section must be an active fact of the fund.
  const facts = await withCitedFacts(ctx, data.facts ?? [], current.sections);
  const active = new Set(facts.map((fact) => fact.id));
  let sections = written(current.sections);
  for (const [key, section] of sections) {
    if (locked.has(key)) continue;
    const checked = rewriteRefs(section.body, (id) => (active.has(id) ? id : null));
    stats.removedSentences += checked.removed;
    sections.set(key, { heading: section.heading, body: checked.body });
  }

  let costUsd = 0;
  let finished = true;
  let inputHash: string | null = null;
  let note = serverText("brainServer.pages.computedNote");
  const writable = (WRITER_KEYS[target.kind] ?? []).filter((key) => !locked.has(key));
  const forWriter = writerFacts(facts);
  if (target.writer && writable.length > 0 && forWriter.length > 0) {
    const hash = writerInputHash({
      model: writer.model,
      system: writer.prompt,
      writable,
      facts: forWriter,
    });
    if (hash === current.inputHash) {
      stats.writerUnchanged += 1;
    } else if (
      writer.stopped ||
      writer.calls >= PAGE_WRITER_LIMIT ||
      Date.now() - runStart > WRITER_START_LIMIT_MS
    ) {
      stats.writerSkipped += 1;
      finished = false;
    } else {
      writer.calls += 1;
      const result = await writeSections(
        ctx,
        call,
        writer,
        target,
        sections,
        forWriter,
        current,
        writable,
      );
      costUsd = result.costUsd;
      if (result.kind === "written") {
        sections = result.sections;
        inputHash = hash;
        note = serverText("brainServer.pages.writtenNote");
        stats.writerCalls += 1;
        stats.writerOps += result.applied;
        stats.writerIgnored += result.ignored;
        stats.removedSentences += result.removed;
      } else if (result.kind === "unusable") {
        // An answer that could not be used (cut off, not parseable): the same input is not asked
        // again every night; new facts give a new hash and a new try.
        inputHash = hash;
        stats.writerFailed += 1;
      } else {
        stats.writerSkipped += 1;
        finished = false;
      }
    }
  }

  const page = assemblePage(
    target.kind,
    current.sections,
    computedSections(target.kind, data),
    sections,
    now,
  );
  await save(ctx, stats, generation, {
    kind: target.kind,
    entityId: target.entityId,
    title: data.entity?.name ?? target.title,
    sections: page,
    dirtyAt: target.dirtyAt,
    finished,
    inputHash,
    note,
  });
  return costUsd;
}

type WriteResult =
  | {
      kind: "written";
      sections: Map<string, WrittenSection>;
      applied: number;
      ignored: number;
      removed: number;
      costUsd: number;
    }
  | { kind: "unusable"; costUsd: number }
  | { kind: "stopped"; costUsd: number };

/** One page writer call, in reference space F1 … and back. */
async function writeSections(
  ctx: LoopContext,
  call: StructuredCaller,
  writer: WriterState,
  target: Target,
  sections: Map<string, WrittenSection>,
  facts: PageFact[],
  current: { sections: readonly PageSection[] },
  writable: readonly string[],
): Promise<WriteResult> {
  const { refOf, idOf } = factRefs(facts);
  const lastWritten = current.sections
    .filter((section) => !section.computed)
    .reduce<number | null>((latest, section) => {
      const at = Date.parse(section.updated_at);
      return Number.isNaN(at) || (latest !== null && latest >= at) ? latest : at;
    }, null);
  // [f:<uuid>] → [f:F3]; a sentence on a fact outside the list is not shown to the writer.
  const inRefs = new Map<string, WrittenSection>();
  for (const [key, section] of sections) {
    inRefs.set(key, {
      heading: section.heading,
      body: rewriteRefs(section.body, (id) => refOf.get(id) ?? null).body,
    });
  }
  let answer: { output: unknown; costUsd: number };
  try {
    answer = await structuredWithBudget(
      ctx,
      call,
      {
        model: writer.model,
        name: "interlect_brain_page_ops_v1",
        system: writer.prompt,
        prompt: pageWriterPrompt({
          kind: target.kind,
          title: target.title,
          writable,
          sections: inRefs,
          facts: facts.map((fact) => ({
            ...fact,
            ref: refOf.get(fact.id)!,
            isNew: lastWritten === null || Date.parse(fact.recordedAt) > lastWritten,
          })),
        }),
        schema: pageOpsJsonSchema,
        maxOutputTokens: WRITER_MAX_OUTPUT_TOKENS,
        redactor: writer.redactor,
      },
      target.entityId,
    );
  } catch (cause) {
    if (cause instanceof BrainBudgetReachedError) {
      writer.stopped = "budget";
      return { kind: "stopped", costUsd: 0 };
    }
    if (isPermanentPolicyStop(cause)) {
      writer.stopped = "policy";
      return { kind: "stopped", costUsd: 0 };
    }
    if (cause instanceof BrainModelOutputError) {
      return { kind: "unusable", costUsd: cause.bookedUsd };
    }
    throw cause;
  }
  const { ops, invalid } = parsePageOps(answer.output);
  const applied = applyPageOps(inRefs, ops, new Set(writable), new Set(), (key) =>
    headingFor(target.kind, key),
  );
  const back = writerSectionsToIds(sections, changedOnly(inRefs, applied.sections), idOf);
  return {
    kind: "written",
    sections: back.sections,
    applied: applied.applied,
    ignored: applied.ignored + invalid,
    removed: back.removed,
    costUsd: answer.costUsd,
  };
}

/** The sections the writer changed (in reference space), so untouched ones keep their ids. */
function changedOnly(
  before: ReadonlyMap<string, WrittenSection>,
  after: ReadonlyMap<string, WrittenSection>,
): Map<string, WrittenSection> {
  const out = new Map<string, WrittenSection>();
  for (const [key, section] of after) {
    const old = before.get(key);
    if (!old || old.body !== section.body) out.set(key, section);
  }
  return out;
}

/** The facts a written section cites that are still active, added to the page's facts. */
async function withCitedFacts(
  ctx: LoopContext,
  facts: PageFact[],
  current: readonly PageSection[],
): Promise<PageFact[]> {
  const known = new Set(facts.map((fact) => fact.id));
  const uuid = /^[0-9a-f-]{36}$/i;
  const missing = [
    ...new Set(
      current
        .filter((section) => !section.computed)
        .flatMap((section) => citedIds(section.body_md))
        .filter((id) => uuid.test(id) && !known.has(id)),
    ),
  ].slice(0, 200);
  if (missing.length === 0) return facts;
  const { data, error } = await ctx.service
    .from("brain_facts")
    .select(
      "id, predicate, statement, subject_id, object_id, value_text, value_num, unit, valid_from, valid_to, trust_tier, recorded_at",
    )
    .eq("fund_id", ctx.fundId)
    .eq("status", "active")
    .is("expired_at", null)
    .in("id", missing);
  if (error) throw new Error(`brain_facts: ${error.message}`);
  const extra: PageFact[] = (data ?? []).map((row) => ({
    id: row["id"] as string,
    predicate: row["predicate"] as string,
    statement: row["statement"] as string,
    subjectId: row["subject_id"] as string,
    subjectName: "",
    objectId: (row["object_id"] as string | null) ?? null,
    objectName: null,
    valueText: (row["value_text"] as string | null) ?? null,
    valueNum: row["value_num"] === null ? null : Number(row["value_num"]),
    unit: (row["unit"] as string | null) ?? null,
    validFrom: (row["valid_from"] as string | null) ?? null,
    validTo: (row["valid_to"] as string | null) ?? null,
    trust: row["trust_tier"] as string,
    recordedAt: row["recorded_at"] as string,
  }));
  return [...facts, ...extra];
}

function written(current: readonly PageSection[]): Map<string, WrittenSection> {
  const out = new Map<string, WrittenSection>();
  for (const section of current) {
    if (!section.computed)
      out.set(section.key, { heading: section.heading, body: section.body_md });
  }
  return out;
}

async function currentPage(
  ctx: LoopContext,
  kind: PageKind,
  entityId: string | null,
): Promise<{ sections: PageSection[]; inputHash: string | null }> {
  let query = ctx.service
    .from("brain_pages")
    .select("sections, input_hash")
    .eq("fund_id", ctx.fundId)
    .eq("kind", kind);
  query = entityId === null ? query.is("entity_id", null) : query.eq("entity_id", entityId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`brain_pages: ${error.message}`);
  const sections = data?.["sections"];
  return {
    sections: Array.isArray(sections) ? (sections as PageSection[]) : [],
    inputHash: (data?.["input_hash"] as string | null | undefined) ?? null,
  };
}

async function save(
  ctx: LoopContext,
  stats: PagesStats,
  generation: number,
  page: {
    kind: PageKind;
    entityId: string | null;
    title: string;
    sections: PageSection[];
    dirtyAt: string | null;
    finished: boolean;
    inputHash: string | null;
    note: string;
  },
): Promise<void> {
  const result = (await rpc(ctx, "brain_save_page", {
    _fund_id: ctx.fundId,
    _kind: page.kind,
    _entity_id: page.entityId,
    _title: page.title,
    _sections: page.sections,
    _search_text: pageSearchText(page.sections),
    _dirty_at: page.dirtyAt,
    _change_note: page.note,
    _finished: page.finished,
    _input_hash: page.inputHash,
    _forget_generation: generation,
  })) as { changed?: boolean; skipped?: string } | null;
  if (result?.skipped === "forgotten") {
    stats.stopped = "forgotten";
    return;
  }
  if (result?.skipped) return;
  stats.saved += 1;
  if (result?.changed) stats.changed += 1;
}

async function rpc(
  ctx: LoopContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await ctx.service.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

function parseTargets(raw: unknown): Target[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set<string>(["company", "person", "case", "sector", "market", "theme"]);
  return raw.flatMap((value) => {
    const row = (value ?? {}) as Record<string, unknown>;
    const { entityId, kind, title, dirtyAt, writer } = row;
    if (typeof entityId !== "string" || typeof kind !== "string" || !kinds.has(kind)) return [];
    return [
      {
        entityId,
        kind: kind as PageKind,
        title: typeof title === "string" ? title : "",
        dirtyAt: typeof dirtyAt === "string" ? dirtyAt : null,
        writer: writer === true,
      },
    ];
  });
}
