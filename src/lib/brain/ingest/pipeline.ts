/**
 * The INGEST pipeline for one uploaded source: extract → classify → chunk → embed → facts
 * → link → ready. The control flow lives here and talks to
 * the database through an `IngestStore`, so every rule is tested without a database: a repeated
 * run skips what is already done (it is read from the data), a problem the user can fix fails the
 * source with a Danish text and the failed step (the user can retry from it), a transient error
 * is retried by the queue and fails the source on the last attempt, and the cost never passes
 * the cap approved for the document.
 */
import { createHash } from "node:crypto";
import { aiPolicyBlockedText } from "../../ai/gateway-options.ts";
import { isPermanentPolicyStop } from "../../ai/model-call.ts";
import { AI_BUDGETS } from "../../analysis/budgets.ts";
import {
  BrainBudgetReachedError,
  BrainLeaseLostError,
  BrainModelOutputError,
  BrainUserError,
} from "../errors.ts";
import { CLASSIFIER_PROMPT_KEY, CLASSIFIER_PROMPT_V1 } from "../prompts/classifier.ts";
import {
  CLASSIFY_MAX_OUTPUT_TOKENS,
  classifyJsonSchema,
  classifyPromptText,
  parseClassification,
  type ClassifyOutput,
} from "../contracts/classify.ts";
import { entityKey } from "../extract.ts";
import { MAX_JOB_ATTEMPTS } from "../jobs.ts";
import type { PricedModel } from "../../analysis/budgets.ts";
import type { StructuredCall } from "../loops/shared.ts";
import type { LoopContext, LoopResult } from "../worker.server.ts";
import { chunkDocument, type Chunk } from "./chunk.ts";
import { INGEST_LIMITS_DKK } from "./estimate.ts";
import { extractDocument, type ExtractedDocument } from "./extract.ts";
import { detectFileKind, ingestFileName, type SourceKind } from "./file-kind.ts";
import { serverText } from "../../i18n/server-text.ts";

export const INGEST_STEPS = ["extract", "classify", "chunk", "embed", "facts", "link"] as const;
export type IngestStep = (typeof INGEST_STEPS)[number];

/** The statuses the pipeline sets (brain_sources.status, 0041). */
export type IngestStatus =
  | "queued"
  | "extracting"
  | "classifying"
  | "chunking"
  | "embedding"
  | "extracting_facts"
  | "linking"
  | "review"
  | "ready"
  | "failed";

export interface IngestSource {
  id: string;
  kind: SourceKind;
  title: string;
  fileName: string | null;
  storagePath: string | null;
  sha256: string | null;
  trustTier: string;
  status: string;
  approvedAt: string | null;
  pageLimit: number | null;
  maxCostUsd: number | null;
  costUsd: number;
  docType: string | null;
  summaryMd: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Fingerprint of the chunks that are stored (0053); null before the first chunk step. */
  chunkSignature: string | null;
  /** The classifier's answer (0054), so a resumed run does not pay for it again or lose the main company. */
  classification: ClassifyOutput | null;
}

export interface IngestSourcePatch {
  status?: IngestStatus;
  step?: IngestStep | null;
  failedStep?: IngestStep | null;
  errorMessage?: string | null;
  title?: string;
  docType?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  language?: string;
  summaryMd?: string;
  warnings?: string[];
  pageCount?: number | null;
  chunkCount?: number;
  chunkSignature?: string;
  classification?: ClassifyOutput;
  companyEntityId?: string | null;
  costUsd?: number;
}

/** What the pipeline needs from the database and Storage. */
export interface IngestStore {
  loadSource(): Promise<IngestSource | null>;
  update(patch: IngestSourcePatch): Promise<void>;
  /** The stored file, or null when it is gone. */
  download(path: string): Promise<Uint8Array | null>;
  /** Removes the source's stored chunks and episodes (the extraction changed since they were stored). */
  clearChunks(): Promise<number>;
  /** Stores chunks as episodes; returns how many were new (a repeated call gives 0). */
  storeChunks(chunks: readonly Chunk[]): Promise<number>;
  pendingChunks(limit: number): Promise<Array<{ id: string; content: string }>>;
  setEmbeddings(rows: ReadonlyArray<{ id: string; embedding: number[] }>): Promise<void>;
  /** The active company entity whose key is the first of `keys` that exists, or null. */
  findCompanyEntity(keys: readonly string[]): Promise<string | null>;
  /** Takes the source for this run; false when another run holds it (a continuation and a retry never overlap). */
  claim(): Promise<boolean>;
  release(): Promise<void>;
}

/** What the pipeline uses of the loop context (the rest is the loop's wiring). */
export type IngestContext = Pick<LoopContext, "recordStep" | "extendLease" | "attempt">;

/**
 * The model calls, already wrapped in the fund's budget (reserve the maximum, call, book the
 * price; scope "ingest"), so the pipeline holds no budget or gateway code of its own.
 */
export interface IngestDeps {
  /** The classifier model and prompt (a fund's own prompt version replaces the repo's). */
  classifier: { model: PricedModel; prompt: string };
  classify(call: StructuredCall, refId: string): Promise<{ output: unknown; costUsd: number }>;
  classifyMaxUsd(call: StructuredCall): number;
  embed(texts: string[], refId: string): Promise<{ embeddings: number[][]; costUsd: number }>;
  embedMaxUsd(texts: string[]): number;
  /**
   * Reads facts out of the source's episodes (the L1 extraction on scope "ingest"). `onBatchCost`
   * is called after each paid batch. `left` means a time or batch limit stopped it (continue in a
   * new run); `capReached` that the next batch could pass `maxCostUsd`.
   */
  extractFacts(options: {
    maxCostUsd: number;
    onBatchCost: (usd: number) => Promise<void>;
  }): Promise<{
    batches: number;
    facts: number;
    failedEpisodes: number;
    left: boolean;
    capReached: boolean;
    sourceGone: boolean;
  }>;
  /** Queues a continuation run of this source (the facts step stopped on its limit). */
  continueLater(): Promise<void>;
}

/** The cost cap of the document is reached: the user can choose fewer pages. */
export class IngestCostCapError extends BrainUserError {}

const EMBED_BATCH = 100;
const STORE_BATCH = 100;
/** The text sent to the classifier is cut by characters before the token trim (about 3.000 tokens). */
const CLASSIFY_SOURCE_CHARS = 14_000;

export function documentLimitUsd(): number {
  return INGEST_LIMITS_DKK.document / AI_BUDGETS.exchangeRateDkkPerUsd;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A fingerprint of the chunks: the same extraction always gives the same one. */
export function chunkSignature(chunks: readonly Chunk[]): string {
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify(chunks.map((c) => [c.ordinal, c.heading, c.pageFrom, c.pageTo, c.content])),
    ),
  );
}

/** What the classification changes on the source; the uploader's own choices are never overwritten. */
export function classificationPatch(
  source: IngestSource,
  classification: ClassifyOutput,
): IngestSourcePatch {
  const base = (source.fileName ?? "").replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const titleIsFileName = source.title === source.fileName || source.title === base;
  return {
    docType: classification.docType,
    language: classification.language,
    summaryMd: classification.summary,
    ...(classification.title && titleIsFileName ? { title: classification.title } : {}),
    ...(classification.periodStart && !source.periodStart
      ? { periodStart: classification.periodStart }
      : {}),
    ...(classification.periodEnd && !source.periodEnd
      ? { periodEnd: classification.periodEnd }
      : {}),
  };
}

/** The first blocks of the document as text, for the classifier. */
export function classifierText(doc: ExtractedDocument): string {
  let text = "";
  for (const block of doc.blocks) {
    text += `${block.kind === "heading" ? "\n# " : "\n"}${block.text}\n`;
    if (text.length >= CLASSIFY_SOURCE_CHARS) break;
  }
  return text.trim();
}

/** The keys under which the document's main company may already be known, most certain first. */
export function companyLinkKeys(
  company: NonNullable<ClassifyOutput["mainCompany"]> | null | undefined,
): string[] {
  if (!company) return [];
  const keys = [
    company.cvr ? { cvr: company.cvr } : null,
    company.domain ? { domain: company.domain } : null,
    {},
  ];
  const found: string[] = [];
  for (const identifiers of keys) {
    if (!identifiers) continue;
    const key = entityKey({ type: "company", name: company.name, identifiers }, "");
    if (key && !found.includes(key)) found.push(key);
  }
  return found;
}

function failedStatement(step: IngestStep, message: string): IngestSourcePatch {
  return { status: "failed", step: null, failedStep: step, errorMessage: message };
}

/** The source is held by another run: the queue retries this job later. */
export class IngestSourceBusyError extends Error {
  constructor() {
    super("INGEST: the source is held by another run");
    this.name = "IngestSourceBusyError";
  }
}

/** The steps a run is in; a source in one of them without approval was reset by "Glem person". */
const RUNNING_STATUSES: ReadonlySet<string> = new Set([
  "extracting",
  "classifying",
  "chunking",
  "embedding",
  "extracting_facts",
  "linking",
]);

export async function runIngestPipeline(
  ctx: IngestContext,
  store: IngestStore,
  deps: IngestDeps,
): Promise<LoopResult> {
  const source = await store.loadSource();
  if (!source) return { status: "skipped", stats: { reason: "source_gone" } };
  if (source.status === "ready") return { status: "skipped", stats: { reason: "already_ready" } };
  if (!source.approvedAt) {
    // "Glem person" took the approval back while a run was reading the file: the run's own
    // status updates came after it, so the source waits for "Læs ind" again instead of hanging.
    if (RUNNING_STATUSES.has(source.status)) {
      await store.update({ status: "queued", step: null, failedStep: null, errorMessage: null });
    }
    return { status: "skipped", stats: { reason: "not_approved" } };
  }

  // Held by another run: throw, so the queue tries again. A "skipped" job would end the chain
  // for ever and leave the source in its step without a job and without "Prøv igen".
  if (!(await store.claim())) throw new IngestSourceBusyError();
  let released = false;
  const releaseSource = async () => {
    await store.release();
    released = true;
  };
  let current: IngestStep = "extract";
  let spent = source.costUsd;
  const cap = source.maxCostUsd ?? documentLimitUsd();
  const warnings: string[] = [];
  const guardCap = (extraUsd: number) => {
    if (spent + extraUsd > cap + 1e-9) {
      throw new IngestCostCapError(serverText("brainServer.ingest.documentCap"));
    }
  };

  try {
    // ---- extract: the file must be what was approved, and readable
    await store.update({
      status: "extracting",
      step: "extract",
      failedStep: null,
      errorMessage: null,
    });
    if (!source.storagePath)
      throw new BrainUserError(serverText("brainServer.ingest.noFileToRead"));
    const bytes = await store.download(source.storagePath);
    if (!bytes) throw new BrainUserError(serverText("brainServer.common.fileGoneInStorage"));
    if (source.sha256 && sha256Hex(bytes) !== source.sha256) {
      throw new BrainUserError(serverText("brainServer.ingest.changedAfterUpload"));
    }
    const kind = detectFileKind(bytes, ingestFileName(source.fileName, source.kind));
    if (!kind.ok) throw new BrainUserError(kind.reason);
    if (kind.kind !== source.kind)
      throw new BrainUserError(serverText("brainServer.ingest.typeMismatch"));
    const doc = await extractDocument(bytes, kind.kind, {
      ...(source.pageLimit ? { maxPages: source.pageLimit } : {}),
    });
    warnings.push(...doc.warnings);
    await store.update({ warnings, pageCount: doc.pageCount });
    await ctx.recordStep("extract", {
      pages: doc.pageCount,
      rows: doc.rowCount,
      chars: doc.charCount,
      imagePages: doc.imagePages.length,
    });

    // ---- classify: skipped on a retry when the classification is already on the source
    current = "classify";
    let docType = source.docType;
    let mainCompany = source.classification?.mainCompany ?? null;
    if (!(source.summaryMd && source.docType)) {
      await store.update({ status: "classifying", step: "classify" });
      const call: StructuredCall = {
        model: deps.classifier.model,
        name: "interlect_brain_classify_v1",
        system: deps.classifier.prompt,
        prompt: classifyPromptText({
          fileName: source.fileName,
          trustTier: source.trustTier,
          pageCount: doc.pageCount,
          text: classifierText(doc),
        }),
        schema: classifyJsonSchema,
        maxOutputTokens: CLASSIFY_MAX_OUTPUT_TOKENS,
      };
      guardCap(deps.classifyMaxUsd(call));
      let classification: ClassifyOutput | null = null;
      try {
        const answer = await deps.classify(call, source.id);
        spent += answer.costUsd;
        classification = parseClassification(answer.output);
      } catch (cause) {
        // An unusable answer never blocks the upload: the source is read as "other" (booked cost
        // stays booked; a budget stop or a transient error still ends the run below).
        if (!(cause instanceof BrainModelOutputError)) throw cause;
        spent += cause.bookedUsd;
      }
      if (!classification) {
        warnings.push(serverText("brainServer.ingest.notClassified"));
        classification = {
          docType: "other",
          title: null,
          periodStart: null,
          periodEnd: null,
          mainCompany: null,
          language: "other",
          summary: serverText("brainServer.ingest.notClassifiedSummary"),
        };
      }
      docType = classification.docType;
      await store.update({
        ...classificationPatch(source, classification),
        classification,
        warnings,
        costUsd: spent,
      });
      mainCompany = classification.mainCompany;
      await ctx.recordStep("classify", { docType, mainCompany: classification.mainCompany }, 0);
    }
    if (docType === "decision_history" && source.kind !== "website") {
      // The guide for tables of earlier decisions has no caller yet: until it
      // has, the source is read as an ordinary document instead of waiting in "review" for ever.
      warnings.push(serverText("brainServer.ingest.decisionHistory"));
    }

    // ---- chunk: stored as episodes, a repeated call stores nothing new
    current = "chunk";
    await store.update({ status: "chunking", step: "chunk" });
    const chunks = chunkDocument(doc);
    if (chunks.length === 0) {
      throw new BrainUserError(serverText("brainServer.extract.noText"));
    }
    const truncated = chunks.filter((chunk) => chunk.truncated).length;
    if (truncated > 0) {
      warnings.push(
        serverText(
          truncated === 1 ? "brainServer.ingest.truncatedOne" : "brainServer.ingest.truncatedMany",
          { count: truncated },
        ),
      );
    }
    // The chunks that are stored must be the chunks of THIS extraction. If it changed since they
    // were stored (another page limit, a new parser), they are replaced; if not, they (and their
    // embeddings, already paid for) stay. The new fingerprint is saved before anything is stored,
    // so a crash in between never makes the next run throw the embeddings away.
    const signature = chunkSignature(chunks);
    if (source.chunkSignature !== signature) {
      if (source.chunkSignature !== null) await store.clearChunks();
      await store.update({ chunkSignature: signature, warnings });
    }
    let stored = 0;
    for (let start = 0; start < chunks.length; start += STORE_BATCH) {
      stored += await store.storeChunks(chunks.slice(start, start + STORE_BATCH));
    }
    await store.update({ chunkCount: chunks.length });
    await ctx.recordStep("chunk", { chunks: chunks.length, stored });

    // ---- embed: only the chunks without a vector, so a retry pays for nothing twice
    current = "embed";
    await store.update({ status: "embedding", step: "embed" });
    let embedded = 0;
    let embedCost = 0;
    for (let guard = 0; guard <= Math.ceil(chunks.length / EMBED_BATCH) + 2; guard += 1) {
      const rows = await store.pendingChunks(EMBED_BATCH);
      if (rows.length === 0) break;
      await ctx.extendLease();
      const texts = rows.map((row) => row.content);
      guardCap(deps.embedMaxUsd(texts));
      const vectors = await deps.embed(texts, source.id);
      spent += vectors.costUsd;
      embedCost += vectors.costUsd;
      await store.setEmbeddings(
        rows.map((row, index) => ({ id: row.id, embedding: vectors.embeddings[index]! })),
      );
      embedded += rows.length;
      // What is paid stays on the source, also when a later batch fails and the run is retried.
      await store.update({ costUsd: spent });
    }
    // A source is only ready when every chunk has its vector.
    if ((await store.pendingChunks(1)).length > 0) {
      throw new Error("INGEST: embedding is incomplete after the last batch");
    }
    await ctx.recordStep("embed", { chunks: embedded }, embedCost);

    // ---- facts: the L1 extraction over the source's episodes; paid batches are booked at once
    current = "facts";
    await store.update({ status: "extracting_facts", step: "facts" });
    const facts = await deps.extractFacts({
      maxCostUsd: Math.max(0, cap - spent),
      onBatchCost: async (usd) => {
        spent += usd;
        await store.update({ costUsd: spent });
      },
    });
    if (facts.sourceGone) return { status: "skipped", stats: { reason: "source_gone" } };
    if (facts.left && !facts.capReached) {
      // A time or batch limit: the next run reads on from where this one stopped (the episodes
      // that are done are not pending any more).
      await store.update({ costUsd: spent, warnings });
      // Let go first and check it: the next part is claimed by a new job at once, and a source
      // that is still held then ends in "source busy" with no job behind it.
      await releaseSource();
      await deps.continueLater();
      return { status: "done", stats: { continues: true, facts: facts.facts } };
    }
    if (facts.capReached) {
      warnings.push(serverText("brainServer.ingest.factsCap"));
    }
    if (facts.failedEpisodes > 0) {
      warnings.push(serverText("brainServer.ingest.factsFailed", { count: facts.failedEpisodes }));
    }

    // ---- link: the main company is tied to an entity the brain already knows (never created here)
    current = "link";
    await store.update({ status: "linking", step: "link" });
    const linkKeys = companyLinkKeys(mainCompany);
    const companyEntityId = linkKeys.length > 0 ? await store.findCompanyEntity(linkKeys) : null;
    await ctx.recordStep("link", { linked: companyEntityId !== null });

    await store.update({
      status: "ready",
      step: null,
      costUsd: spent,
      warnings,
      ...(companyEntityId ? { companyEntityId } : {}),
    });
    return {
      status: "done",
      stats: {
        chunks: chunks.length,
        newChunks: stored,
        embedded,
        facts: facts.facts,
        linked: companyEntityId !== null,
        docType,
        costUsd: Number((spent - source.costUsd).toFixed(6)),
      },
    };
  } catch (cause) {
    // Another worker has taken over this job: it owns the source now, and this one writes nothing.
    if (cause instanceof BrainLeaseLostError) throw cause;
    if (cause instanceof BrainUserError) {
      await store.update({ ...failedStatement(current, cause.message), costUsd: spent });
      return { status: "skipped", stats: { reason: "user_error", step: current } };
    }
    // Stopped by the data rules: every retry would stop the same way. A masking
    // dictionary that could not be loaded is not such a stop: the job retries.
    if (isPermanentPolicyStop(cause)) {
      await store.update({ ...failedStatement(current, aiPolicyBlockedText()), costUsd: spent });
      return { status: "skipped", stats: { reason: "policy_blocked", step: current } };
    }
    if (cause instanceof BrainBudgetReachedError) {
      await store.update({
        ...failedStatement(current, serverText("brainServer.ingest.monthlyBudget")),
        costUsd: spent,
      });
      throw cause;
    }
    // A transient error is retried by the queue; the source only fails on the last attempt.
    if (ctx.attempt >= MAX_JOB_ATTEMPTS) {
      await store.update({
        ...failedStatement(current, serverText("brainServer.ingest.failed")),
        costUsd: spent,
      });
    }
    throw cause;
  } finally {
    if (!released) await store.release().catch(() => {});
  }
}

export { CLASSIFIER_PROMPT_KEY, CLASSIFIER_PROMPT_V1 };
