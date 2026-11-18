import assert from "node:assert/strict";
import { test } from "node:test";
import { aiPolicyBlockedText, AiDataPolicyError } from "../../ai/gateway-options.ts";
import { BrainBudgetReachedError, BrainModelOutputError } from "../errors.ts";
import { MAX_JOB_ATTEMPTS } from "../jobs.ts";
import type { Chunk } from "./chunk.ts";
import { pdfFixture } from "./fixtures.ts";
import {
  IngestSourceBusyError,
  classificationPatch,
  classifierText,
  runIngestPipeline,
  sha256Hex,
  type IngestDeps,
  type IngestSource,
  type IngestSourcePatch,
  type IngestStore,
} from "./pipeline.ts";

const FUND = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";

const line = (index: number) =>
  `Selskabet rapporterede i kvartal ${index} en omsætning på ${index + 3} mio. kr. og en bruttomargin på 71 procent.`;

async function reportPdf(pages = 4): Promise<Uint8Array> {
  return pdfFixture(
    Array.from({ length: pages }, (_, index) => [
      `Afsnit ${index + 1}`,
      line(index),
      line(index + 10),
      line(index + 20),
    ]),
  );
}

interface World {
  source: IngestSource;
  file: Uint8Array | null;
  patches: IngestSourcePatch[];
  stored: Chunk[];
  vectors: Map<string, number[]>;
  chunkIds: string[];
  statuses: string[];
  steps: string[];
  stepCosts: number[];
  extended: number;
  classifyCalls: number;
  embedCalls: number;
  failEmbedAfter: number | null;
  cleared: number;
  knownCompanies: Map<string, string>;
  factCalls: number;
  continued: number;
  linkedKeys: string[][];
  busy: boolean;
  claims: number;
  releases: number;
  releasesWhenContinued: number | null;
}

async function world(
  overrides: Partial<IngestSource> = {},
  file?: Uint8Array | null,
): Promise<World> {
  const bytes = file === undefined ? await reportPdf() : file;
  return {
    source: {
      id: SOURCE,
      kind: "pdf",
      title: "LP-brev",
      fileName: "LP-brev.pdf",
      storagePath: `${FUND}/${SOURCE}/LP-brev.pdf`,
      sha256: bytes ? sha256Hex(bytes) : null,
      trustTier: "customer_doc",
      status: "queued",
      approvedAt: "2026-10-01T10:00:00Z",
      pageLimit: null,
      maxCostUsd: 0.4,
      costUsd: 0,
      docType: null,
      summaryMd: null,
      periodStart: null,
      periodEnd: null,
      chunkSignature: null,
      classification: null,
      ...overrides,
    },
    file: bytes,
    patches: [],
    stored: [],
    vectors: new Map(),
    chunkIds: [],
    statuses: [],
    steps: [],
    stepCosts: [],
    extended: 0,
    classifyCalls: 0,
    embedCalls: 0,
    failEmbedAfter: null,
    cleared: 0,
    knownCompanies: new Map(),
    factCalls: 0,
    continued: 0,
    linkedKeys: [],
    busy: false,
    claims: 0,
    releases: 0,
    releasesWhenContinued: null,
  };
}

function storeFor(w: World): IngestStore {
  return {
    loadSource: async () => w.source,
    update: async (patch) => {
      w.patches.push(patch);
      if (patch.status) w.statuses.push(patch.status);
      const target = w.source as unknown as Record<string, unknown>;
      if (patch.status) target["status"] = patch.status;
      if (patch.docType) target["docType"] = patch.docType;
      if (patch.summaryMd) target["summaryMd"] = patch.summaryMd;
      if (patch.title) target["title"] = patch.title;
      if (patch.periodStart !== undefined) target["periodStart"] = patch.periodStart;
      if (patch.periodEnd !== undefined) target["periodEnd"] = patch.periodEnd;
      if (patch.costUsd !== undefined) target["costUsd"] = patch.costUsd;
      if (patch.chunkSignature !== undefined) target["chunkSignature"] = patch.chunkSignature;
      if (patch.classification) target["classification"] = patch.classification;
    },
    download: async () => w.file,
    clearChunks: async () => {
      const removed = w.stored.length;
      w.cleared += 1;
      w.stored = [];
      w.vectors.clear();
      return removed;
    },
    storeChunks: async (chunks) => {
      let added = 0;
      for (const chunk of chunks) {
        if (w.stored.some((existing) => existing.ordinal === chunk.ordinal)) continue;
        w.stored.push(chunk);
        w.chunkIds.push(`chunk-${chunk.ordinal}`);
        added += 1;
      }
      return added;
    },
    pendingChunks: async (limit) =>
      w.stored
        .filter((chunk) => !w.vectors.has(`chunk-${chunk.ordinal}`))
        .slice(0, limit)
        .map((chunk) => ({ id: `chunk-${chunk.ordinal}`, content: chunk.content })),
    setEmbeddings: async (rows) => {
      for (const row of rows) w.vectors.set(row.id, row.embedding);
    },
    claim: async () => {
      w.claims += 1;
      return !w.busy;
    },
    release: async () => {
      w.releases += 1;
    },
    findCompanyEntity: async (keys) => {
      w.linkedKeys.push([...keys]);
      for (const key of keys) {
        const id = w.knownCompanies.get(key);
        if (id) return id;
      }
      return null;
    },
  };
}

function depsFor(
  w: World,
  options: {
    classification?: unknown;
    classifyError?: Error;
    embedError?: Error;
    classifyCost?: number;
    embedCostPerCall?: number;
    maxUsd?: number;
    facts?: Partial<Awaited<ReturnType<IngestDeps["extractFacts"]>>> & { costs?: number[] };
    factsError?: Error;
  } = {},
): IngestDeps {
  return {
    classifier: { model: "openai/gpt-5.4-mini", prompt: "prompt" },
    classify: async () => {
      w.classifyCalls += 1;
      if (options.classifyError) throw options.classifyError;
      return {
        output: options.classification ?? {
          docType: "lp_letter",
          title: "LP-brev Q2 2026",
          periodStart: "2026-04-01",
          periodEnd: "2026-06-30",
          mainCompany: null,
          language: "da",
          summary: "Kvartalsbrev til investorer.",
        },
        costUsd: options.classifyCost ?? 0.004,
      };
    },
    classifyMaxUsd: () => options.maxUsd ?? 0.01,
    embed: async (texts) => {
      w.embedCalls += 1;
      if (options.embedError) throw options.embedError;
      return {
        embeddings: texts.map(() => [0.1, 0.2]),
        costUsd: options.embedCostPerCall ?? 0.0005,
      };
    },
    embedMaxUsd: () => 0.001,
    extractFacts: async (call) => {
      w.factCalls += 1;
      if (options.factsError) throw options.factsError;
      for (const usd of options.facts?.costs ?? []) await call.onBatchCost(usd);
      return {
        batches: options.facts?.costs?.length ?? 1,
        facts: 3,
        failedEpisodes: 0,
        left: false,
        capReached: false,
        sourceGone: false,
        ...options.facts,
      };
    },
    continueLater: async () => {
      w.releasesWhenContinued = w.releases;
      w.continued += 1;
    },
  };
}

const ctxFor = (w: World, attempt = 1) => ({
  attempt,
  extendLease: async () => {
    w.extended += 1;
  },
  recordStep: async (step: string, _output: unknown, cost?: number) => {
    w.steps.push(step);
    w.stepCosts.push(cost ?? 0);
    return true;
  },
});

test("a source is read, classified, cut, stored and embedded, and ends ready", async () => {
  const w = await world();
  const result = await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  assert.equal(result.status, "done");
  assert.deepEqual(w.statuses, [
    "extracting",
    "classifying",
    "chunking",
    "embedding",
    "extracting_facts",
    "linking",
    "ready",
  ]);
  assert.deepEqual(w.steps, ["extract", "classify", "chunk", "embed", "link"]);
  assert.ok(w.stored.length > 0);
  assert.equal(w.vectors.size, w.stored.length, "every chunk has a vector");
  assert.equal(
    w.source.title,
    "LP-brev Q2 2026",
    "a title that was only the file name is replaced",
  );
  assert.equal(w.source.docType, "lp_letter");
  assert.equal(w.source.periodEnd, "2026-06-30");
  const last = w.patches.at(-1)!;
  assert.equal(last.status, "ready");
  assert.equal(last.step, null);
  assert.ok((last.costUsd ?? 0) > 0.004);
  assert.equal(result.stats["docType"], "lp_letter");
});

test("the uploader's own title and period are never overwritten", () => {
  const source = {
    title: "Vores LP-brev",
    fileName: "x.pdf",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
  } as IngestSource;
  const patch = classificationPatch(source, {
    docType: "lp_letter",
    title: "Noget andet",
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    mainCompany: null,
    language: "da",
    summary: "s",
  });
  assert.equal(patch.title, undefined);
  assert.equal(patch.periodStart, undefined);
  assert.equal(patch.periodEnd, undefined);
});

test("a retry reads from the data: no second classification, no repeated chunks, only missing vectors are paid", async () => {
  const w = await world();
  await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  assert.equal(w.classifyCalls, 1);
  const embedCalls = w.embedCalls;
  // Everything is ready; a re-run does nothing.
  const again = await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  assert.deepEqual(again, { status: "skipped", stats: { reason: "already_ready" } });

  // A run that stopped half way: classified, chunks stored, half of the vectors missing.
  const w2 = await world({ status: "failed" });
  await runIngestPipeline(ctxFor(w2), storeFor(w2), depsFor(w2));
  w2.source.status = "failed";
  const missing = [...w2.vectors.keys()].slice(0, Math.floor(w2.vectors.size / 2) || 1);
  for (const id of missing) w2.vectors.delete(id);
  const before = { classify: w2.classifyCalls, embed: w2.embedCalls };
  const result = await runIngestPipeline(ctxFor(w2), storeFor(w2), depsFor(w2));
  assert.equal(result.status, "done");
  assert.equal(w2.classifyCalls, before.classify, "classification is not paid for again");
  assert.equal(result.stats["newChunks"], 0, "no chunk is stored twice");
  assert.equal(w2.embedCalls, before.embed + 1, "one embedding call for the missing vectors");
  assert.equal(result.stats["embedded"], missing.length);
  assert.ok(embedCalls >= 1);
});

test("a source that is gone, not approved or already ready is left alone", async () => {
  const gone = await world();
  const store = { ...storeFor(gone), loadSource: async () => null };
  assert.equal(
    (await runIngestPipeline(ctxFor(gone), store, depsFor(gone))).stats["reason"],
    "source_gone",
  );
  const unapproved = await world({ approvedAt: null });
  const result = await runIngestPipeline(
    ctxFor(unapproved),
    storeFor(unapproved),
    depsFor(unapproved),
  );
  assert.equal(result.stats["reason"], "not_approved");
  assert.equal(unapproved.classifyCalls, 0);
  assert.deepEqual(unapproved.patches, []);

  // "Glem person" took the approval back mid-run: the source waits for "Læs ind" again.
  const reset = await world({ approvedAt: null, status: "classifying" });
  const retried = await runIngestPipeline(ctxFor(reset), storeFor(reset), depsFor(reset));
  assert.equal(retried.stats["reason"], "not_approved");
  assert.equal(reset.classifyCalls, 0);
  assert.deepEqual(reset.patches, [
    { status: "queued", step: null, failedStep: null, errorMessage: null },
  ]);
});

test("problems the user can fix fail the source with a clear text and the failed step", async () => {
  const missing = await world({}, null);
  const lost = await runIngestPipeline(ctxFor(missing), storeFor(missing), depsFor(missing));
  assert.equal(lost.stats["reason"], "user_error");
  const failed = missing.patches.at(-1)!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.failedStep, "extract");
  assert.match(failed.errorMessage ?? "", /findes ikke længere/);

  const bytes = await reportPdf(2);
  const tampered = await world({ sha256: "0".repeat(64) }, bytes);
  await runIngestPipeline(ctxFor(tampered), storeFor(tampered), depsFor(tampered));
  assert.match(tampered.patches.at(-1)?.errorMessage ?? "", /ændret efter upload/);

  const wrongKind = await world({ kind: "docx", fileName: "x.docx" }, bytes);
  wrongKind.source.sha256 = sha256Hex(bytes);
  await runIngestPipeline(ctxFor(wrongKind), storeFor(wrongKind), depsFor(wrongKind));
  assert.equal(wrongKind.patches.at(-1)?.status, "failed");

  const junk = new TextEncoder().encode("%PDF-1.4 ikke en rigtig pdf");
  const broken = await world({}, junk);
  await runIngestPipeline(ctxFor(broken), storeFor(broken), depsFor(broken));
  assert.match(broken.patches.at(-1)?.errorMessage ?? "", /PDF/);
  assert.equal(broken.classifyCalls, 0, "nothing is paid for a file that cannot be read");
});

test("an unusable classification never blocks the upload: it is read as 'other' with a note", async () => {
  const w = await world();
  const error = new BrainModelOutputError("cut off", "length");
  error.bookedUsd = 0.012;
  const deps = {
    ...depsFor(w),
    classify: async () => {
      w.classifyCalls += 1;
      throw error;
    },
  };
  const result = await runIngestPipeline(ctxFor(w), storeFor(w), deps);
  assert.equal(result.status, "done");
  assert.equal(w.source.docType, "other");
  assert.ok(
    w.patches.some((patch) =>
      (patch.warnings ?? []).some((note) => /kunne ikke bestemmes/.test(note)),
    ),
  );
  assert.ok((w.patches.at(-1)?.costUsd ?? 0) >= 0.012, "the cost the call booked stays booked");
});

test("a transient error is retried by the queue and only fails the source on the last attempt", async () => {
  const early = await world();
  await assert.rejects(
    () =>
      runIngestPipeline(
        ctxFor(early, 1),
        storeFor(early),
        depsFor(early, { classifyError: new Error("network") }),
      ),
    /network/,
  );
  assert.notEqual(early.patches.at(-1)?.status, "failed");
  const last = await world();
  await assert.rejects(
    () =>
      runIngestPipeline(
        ctxFor(last, MAX_JOB_ATTEMPTS),
        storeFor(last),
        depsFor(last, { classifyError: new Error("network") }),
      ),
    /network/,
  );
  assert.equal(last.patches.at(-1)?.status, "failed");
  assert.equal(last.patches.at(-1)?.failedStep, "classify");
});

test("a call stopped by the data rules fails the source at once, without 'try again' (R-17a)", async () => {
  const w = await world();
  const result = await runIngestPipeline(
    ctxFor(w, 1),
    storeFor(w),
    depsFor(w, {
      embedError: new AiDataPolicyError("zdr_unavailable", "openai/text-embedding-3-small", "x"),
    }),
  );
  assert.equal(result.status, "skipped");
  const patch = w.patches.at(-1)!;
  assert.equal(patch.status, "failed");
  assert.equal(patch.failedStep, "embed");
  assert.equal(patch.errorMessage, aiPolicyBlockedText());
  assert.doesNotMatch(patch.errorMessage ?? "", /Prøv igen/);
});

test("a reached monthly budget fails the source with a clear text and is passed on", async () => {
  const w = await world();
  await assert.rejects(
    () =>
      runIngestPipeline(
        ctxFor(w),
        storeFor(w),
        depsFor(w, { embedError: new BrainBudgetReachedError("ingest") }),
      ),
    BrainBudgetReachedError,
  );
  const patch = w.patches.at(-1)!;
  assert.equal(patch.status, "failed");
  assert.equal(patch.failedStep, "embed");
  assert.match(patch.errorMessage ?? "", /budget/);
});

test("the cost cap of the document stops the run before a call that would pass it", async () => {
  const w = await world({ maxCostUsd: 0.001 });
  const result = await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w, { maxUsd: 0.01 }));
  assert.equal(result.stats["reason"], "user_error");
  assert.equal(w.classifyCalls, 0, "no model is called when its maximum is over the cap");
  assert.match(w.patches.at(-1)?.errorMessage ?? "", /Loftet for dokumentet/);
  assert.equal(w.patches.at(-1)?.failedStep, "classify");
});

test("a table of earlier decisions is read as an ordinary document until the guide exists (T-745 b)", async () => {
  const w = await world();
  const result = await runIngestPipeline(
    ctxFor(w),
    storeFor(w),
    depsFor(w, {
      classification: {
        docType: "decision_history",
        title: null,
        periodStart: null,
        periodEnd: null,
        mainCompany: null,
        language: "da",
        summary: "Liste over beslutninger.",
      },
    }),
  );
  assert.equal(result.status, "done");
  assert.ok(w.stored.length > 0, "the text is chunked");
  assert.equal(w.patches.at(-1)?.status, "ready");
  assert.match((w.patches.at(-1)?.warnings ?? []).join(" "), /almindeligt dokument/);
});

test("the embedding loop always ends, and a source with chunks that never got a vector is not ready", async () => {
  const w = await world();
  const store = { ...storeFor(w), setEmbeddings: async () => {} };
  await assert.rejects(
    () => runIngestPipeline(ctxFor(w), store, depsFor(w)),
    /embedding is incomplete/,
  );
  assert.ok(w.embedCalls <= 6, `embed calls ${w.embedCalls}`);
  assert.ok(!w.statuses.includes("ready"));
});

test("notes from the extraction (image pages) reach the source", async () => {
  const bytes = await pdfFixture([
    [line(1), line(2), line(3)],
    ["Kort"],
    [line(4), line(5), line(6)],
  ]);
  const w = await world({}, bytes);
  await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  assert.ok(
    w.patches.some((patch) => (patch.warnings ?? []).some((note) => /delvist læst/.test(note))),
  );
  assert.match(
    classifierText({
      kind: "pdf",
      blocks: [
        { kind: "heading", text: "Titel" },
        { kind: "paragraph", text: "Tekst" },
      ],
      pageCount: 1,
      truncatedFrom: null,
      rowCount: null,
      imagePages: [],
      warnings: [],
      charCount: 9,
    }),
    /# Titel\n+Tekst/,
  );
});

test("what is paid for stays on the source after every embedding batch (review finding)", async () => {
  const w = await world();
  await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  const readyIndex = w.patches.findIndex((patch) => patch.status === "ready");
  const earlier = w.patches.slice(0, readyIndex).filter((patch) => patch.costUsd !== undefined);
  assert.ok(
    earlier.length >= 2,
    "the cost is saved after the classification and after the embedding batch",
  );
  assert.ok((earlier.at(-1)?.costUsd ?? 0) > 0.004);
});

test("when the extraction has changed since the chunks were stored, they are replaced, not kept beside the new ones (review finding)", async () => {
  const w = await world();
  await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  const first = w.stored.length;
  const signature = w.source.chunkSignature;
  assert.ok(signature);
  // The same extraction again keeps the chunks: no clearing, no new embedding.
  w.source.status = "failed";
  const embedCalls = w.embedCalls;
  await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  assert.equal(w.cleared, 0);
  assert.equal(w.embedCalls, embedCalls);
  // A smaller page limit is another extraction: the old chunks are cleared first.
  w.source.status = "failed";
  w.source.pageLimit = 1;
  await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  assert.equal(w.cleared, 1);
  assert.ok(w.stored.length < first, `${w.stored.length} < ${first}`);
  assert.notEqual(w.source.chunkSignature, signature);
  assert.equal(
    w.vectors.size,
    w.stored.length,
    "only the new chunks have vectors, and none are doubled",
  );
});

test("a document with headings only has nothing to read and says so", async () => {
  const { docxFixture } = await import("./fixtures.ts");
  const bytes = docxFixture([{ h1: "Kun en overskrift" }]);
  const w = await world(
    { kind: "docx", fileName: "tom.docx", storagePath: `${FUND}/${SOURCE}/tom.docx` },
    bytes,
  );
  w.source.sha256 = sha256Hex(bytes);
  const result = await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  assert.equal(result.stats["reason"], "user_error");
  assert.match(w.patches.at(-1)?.errorMessage ?? "", /ingen tekst/);
  assert.equal(w.patches.at(-1)?.failedStep, "chunk");
});

test("a row that is too long for a chunk is cut, and the source says so", async () => {
  const csv = new TextEncoder().encode(`Selskab,Note\nNordlys,${"x ".repeat(8000)}\n`);
  const w = await world(
    { kind: "csv", fileName: "noter.csv", storagePath: `${FUND}/${SOURCE}/noter.csv` },
    csv,
  );
  w.source.sha256 = sha256Hex(csv);
  const result = await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  assert.equal(result.status, "done");
  assert.ok(
    w.patches.some((patch) => (patch.warnings ?? []).some((note) => /afkortet/.test(note))),
  );
});

test("a worker that lost its lease writes nothing to the source (review finding)", async () => {
  const { BrainLeaseLostError } = await import("../errors.ts");
  const w = await world();
  const deps = {
    ...depsFor(w),
    embed: async () => {
      throw new BrainLeaseLostError("job");
    },
  };
  const before = w.patches.length;
  await assert.rejects(
    () => runIngestPipeline(ctxFor(w, MAX_JOB_ATTEMPTS), storeFor(w), deps),
    BrainLeaseLostError,
  );
  assert.ok(
    !w.patches.slice(before).some((patch) => patch.status === "failed"),
    "the new owner's run is not overwritten",
  );
});

const COMPANY = {
  name: "Pleo A/S",
  domain: "pleo.io",
  cvr: "38888888",
};

test("the main company is linked to an entity the brain already knows, by CVR first", async () => {
  const w = await world();
  w.knownCompanies.set("domain:pleo.io", "entity-1");
  w.knownCompanies.set("cvr:38888888", "entity-cvr");
  const deps = depsFor(w, {
    classification: {
      docType: "lp_letter",
      title: null,
      periodStart: null,
      periodEnd: null,
      mainCompany: COMPANY,
      language: "da",
      summary: "x",
    },
  });
  await runIngestPipeline(ctxFor(w), storeFor(w), deps);
  assert.deepEqual(w.linkedKeys[0]?.[0], "cvr:38888888");
  const last = w.patches.at(-1);
  assert.equal(last?.status, "ready");
  assert.equal(last?.companyEntityId, "entity-cvr");
});

test("a main company the brain does not know is not created: the source is ready without a link", async () => {
  const w = await world();
  const deps = depsFor(w, {
    classification: {
      docType: "lp_letter",
      title: null,
      periodStart: null,
      periodEnd: null,
      mainCompany: COMPANY,
      language: "da",
      summary: "x",
    },
  });
  const result = await runIngestPipeline(ctxFor(w), storeFor(w), deps);
  assert.equal(result.status, "done");
  assert.equal(w.patches.at(-1)?.companyEntityId, undefined);
});

test("a resumed run links with the stored classification, not a new (paid) one", async () => {
  const w = await world({
    docType: "lp_letter",
    summaryMd: "x",
    classification: {
      docType: "lp_letter",
      title: null,
      periodStart: null,
      periodEnd: null,
      mainCompany: COMPANY,
      language: "da",
      summary: "x",
    },
  });
  w.knownCompanies.set("cvr:38888888", "entity-cvr");
  await runIngestPipeline(ctxFor(w), storeFor(w), depsFor(w));
  assert.equal(w.classifyCalls, 0);
  assert.equal(w.patches.at(-1)?.companyEntityId, "entity-cvr");
});

test("what the fact batches cost is booked on the source as it is paid and stays under the cap", async () => {
  const w = await world();
  let remaining = -1;
  const deps = depsFor(w, { facts: { costs: [0.05, 0.06] } });
  const inner = deps.extractFacts;
  deps.extractFacts = async (call) => {
    remaining = call.maxCostUsd;
    return inner(call);
  };
  await runIngestPipeline(ctxFor(w), storeFor(w), deps);
  const costs = w.patches.map((p) => p.costUsd).filter((c): c is number => c !== undefined);
  const final = costs.at(-1) ?? 0;
  assert.ok(final >= 0.11, `facts cost is on the source (${final})`);
  assert.ok(remaining > 0 && remaining < 0.4, "the facts step gets what is left of the cap");
});

test("a fact step stopped by a limit continues in a new run and the source is not ready yet", async () => {
  const w = await world();
  const result = await runIngestPipeline(
    ctxFor(w),
    storeFor(w),
    depsFor(w, { facts: { left: true } }),
  );
  assert.equal(result.status, "done");
  assert.equal(w.continued, 1);
  assert.equal(w.releasesWhenContinued, 1, "the source is released before the next part is queued");
  assert.equal(w.releases, 1, "and not released twice");
  assert.notEqual(w.patches.at(-1)?.status, "ready");
  assert.deepEqual(w.statuses.at(-1), "extracting_facts");
});

test("when the cap stops the fact step the source is ready, with a warning and no continuation", async () => {
  const w = await world();
  await runIngestPipeline(
    ctxFor(w),
    storeFor(w),
    depsFor(w, { facts: { left: true, capReached: true } }),
  );
  assert.equal(w.continued, 0);
  const last = w.patches.at(-1);
  assert.equal(last?.status, "ready");
  assert.ok(last?.warnings?.some((text) => text.includes("Loftet")));
});

test("an error in the fact step is retried by the queue and fails the source on the last attempt, at the facts step", async () => {
  const first = await world();
  await assert.rejects(
    runIngestPipeline(
      ctxFor(first, 1),
      storeFor(first),
      depsFor(first, { factsError: new Error("boom") }),
    ),
  );
  assert.notEqual(first.patches.at(-1)?.status, "failed");

  const last = await world();
  await assert.rejects(
    runIngestPipeline(
      ctxFor(last, 5),
      storeFor(last),
      depsFor(last, { factsError: new Error("boom") }),
    ),
  );
  assert.equal(last.patches.at(-1)?.status, "failed");
  assert.equal(last.patches.at(-1)?.failedStep, "facts");
});

test("a source that is gone during the fact step ends without a ready status", async () => {
  const w = await world();
  const result = await runIngestPipeline(
    ctxFor(w),
    storeFor(w),
    depsFor(w, { facts: { sourceGone: true } }),
  );
  assert.equal(result.status, "skipped");
  assert.notEqual(w.patches.at(-1)?.status, "ready");
});

test("a run that finds the source held by another run does nothing, and a run always lets go of it", async () => {
  const busy = await world();
  busy.busy = true;
  // Thrown, not "skipped": the queue retries, so the source never waits without a job.
  await assert.rejects(
    runIngestPipeline(ctxFor(busy), storeFor(busy), depsFor(busy)),
    IngestSourceBusyError,
  );
  assert.equal(busy.patches.length, 0, "nothing is written");
  assert.equal(busy.classifyCalls + busy.factCalls, 0, "nothing is paid for");
  assert.equal(busy.releases, 0, "a run that never held the source does not release it");

  const done = await world();
  await runIngestPipeline(ctxFor(done), storeFor(done), depsFor(done));
  assert.equal(done.releases, 1);
  const failed = await world();
  await assert.rejects(
    runIngestPipeline(
      ctxFor(failed),
      storeFor(failed),
      depsFor(failed, { factsError: new Error("boom") }),
    ),
  );
  assert.equal(failed.releases, 1, "also when the run throws");
});
