import assert from "node:assert/strict";
import { test } from "node:test";
import { BrainUserError } from "../errors.ts";
import { pdfFixture } from "./fixtures.ts";
import { ingestKey } from "./keys.ts";
import { WEBSITE_FORMAT, type WebsiteFile } from "./site.ts";
import {
  approveIngest,
  completeUpload,
  discardUpload,
  MAX_OPEN_UPLOADS,
  requestUpload,
  retryIngest,
  submitText,
  submitWebsite,
  type IngestAdmin,
  type NewSource,
  type SourceRecord,
  type SourceUpdate,
} from "./uploads.ts";

const FUND = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";

const line = (index: number) =>
  `Selskabet rapporterede i kvartal ${index} en omsætning på ${index + 3} mio. kr. og en bruttomargin på 71 procent.`;

class Fake {
  sources = new Map<string, SourceRecord & { sha256: string | null }>();
  files = new Map<string, Uint8Array>();
  updates: SourceUpdate[] = [];
  audits: Array<{ action: string; payload: Record<string, unknown> }> = [];
  enqueued: string[] = [];
  open = 0;
  highest = -1;
  nextId = 1;
  failEnqueue = false;
  failSigned = false;
  raceDuplicate = false;

  admin: IngestAdmin = {
    newId: () => `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`,
    now: () => new Date("2026-10-01T10:00:00Z"),
    countOpenUploads: async () => this.open,
    insertSource: async (s: NewSource) => {
      this.sources.set(s.id, {
        id: s.id,
        fundId: s.fundId,
        kind: s.kind,
        title: s.title,
        fileName: s.fileName,
        storagePath: s.storagePath,
        sha256: null,
        status: "queued",
        uploadCompletedAt: null,
        approvedAt: null,
        pageLimit: null,
        maxCostUsd: null,
        failedStep: null,
        errorMessage: null,
      });
    },
    getSource: async (_fund, id) => this.sources.get(id) ?? null,
    updateSource: async (_fund, id, update, only) => {
      this.updates.push(update);
      const row = this.sources.get(id)!;
      if (only?.approvedAtNull && row.approvedAt !== null) return "conflict";
      if (only?.status && row.status !== only.status) return "conflict";
      if (this.raceDuplicate && update.sha256) return "duplicate";
      if (update.sha256) row.sha256 = update.sha256;
      if (update.uploadCompletedAt) row.uploadCompletedAt = update.uploadCompletedAt;
      if (update.approvedAt !== undefined) row.approvedAt = update.approvedAt;
      if (update.pageLimit !== undefined) row.pageLimit = update.pageLimit;
      if (update.maxCostUsd !== undefined) row.maxCostUsd = update.maxCostUsd;
      if (update.status) row.status = update.status;
      if (update.errorMessage !== undefined) row.errorMessage = update.errorMessage;
      return "ok";
    },
    deleteSource: async (_fund, id) => {
      this.sources.delete(id);
    },
    deleteUnapprovedSource: async (_fund, id) => {
      const row = this.sources.get(id);
      if (!row || row.approvedAt !== null) return false;
      this.sources.delete(id);
      return true;
    },
    findBySha: async (_fund, sha, exceptId) => {
      for (const row of this.sources.values()) {
        if (row.id !== exceptId && row.sha256 === sha)
          return { id: row.id, title: row.title, status: row.status };
      }
      return null;
    },
    signedUploadUrl: async (path) => {
      if (this.failSigned) throw new Error("storage down");
      return { url: `https://storage.test/${path}?token=t`, token: "t" };
    },
    download: async (path) => this.files.get(path) ?? null,
    removeObject: async (path) => {
      this.files.delete(path);
    },
    putObject: async (path, bytes) => {
      this.files.set(path, bytes);
    },
    highestIngestRun: async () => this.highest,
    enqueueIngest: async (_fund, key) => {
      if (this.failEnqueue) throw new Error("queue down");
      this.enqueued.push(key);
    },
    audit: async (event) => {
      this.audits.push({ action: event.action, payload: event.payload });
    },
  };

  /** Requests an upload and puts the bytes in Storage like the browser would. */
  async upload(fileName: string, bytes: Uint8Array) {
    const ticket = await requestUpload(this.admin, {
      fundId: FUND,
      userId: USER,
      fileName,
      sizeBytes: bytes.length,
      trustTier: "customer_doc",
    });
    this.files.set(ticket.path, bytes);
    return ticket;
  }
}

test("an upload request makes a source row and a signed URL under the fund's own path", async () => {
  const fake = new Fake();
  const ticket = await requestUpload(fake.admin, {
    fundId: FUND,
    userId: USER,
    fileName: "C:\\mine filer\\LP-brev Q2.pdf",
    sizeBytes: 1000,
    trustTier: "company_claim",
  });
  assert.equal(ticket.kind, "pdf");
  assert.ok(ticket.path.startsWith(`${FUND}/${ticket.sourceId}/`));
  assert.ok(ticket.path.endsWith("/LP-brev Q2.pdf"));
  const row = fake.sources.get(ticket.sourceId)!;
  assert.equal(row.title, "LP-brev Q2");
  assert.equal(row.uploadCompletedAt, null);
  assert.equal(fake.audits[0]?.action, "brain_source_upload_requested");
});

test("a .json upload is always refused: only the server's crawl writes a website file", async () => {
  const fake = new Fake();
  await assert.rejects(
    () =>
      requestUpload(fake.admin, {
        fundId: FUND,
        userId: USER,
        fileName: "website.json",
        sizeBytes: 100,
        trustTier: "customer_doc",
      }),
    /Filtypen understøttes ikke/,
  );
});

test("an upload request is refused for a wrong type, size, trust or when too many are open", async () => {
  const fake = new Fake();
  const base = {
    fundId: FUND,
    userId: USER,
    fileName: "a.pdf",
    sizeBytes: 100,
    trustTier: "customer_doc",
  };
  await assert.rejects(
    () => requestUpload(fake.admin, { ...base, fileName: "program.exe" }),
    /understøttes ikke/,
  );
  await assert.rejects(() => requestUpload(fake.admin, { ...base, sizeBytes: 0 }), /tom/);
  await assert.rejects(
    () => requestUpload(fake.admin, { ...base, sizeBytes: 26 * 1024 * 1024 }),
    /25 MB/,
  );
  await assert.rejects(
    () => requestUpload(fake.admin, { ...base, trustTier: "public_web" }),
    /Vælg/,
  );
  fake.open = MAX_OPEN_UPLOADS;
  await assert.rejects(() => requestUpload(fake.admin, base), /for mange/);
  assert.equal(fake.sources.size, 0, "no row is made for a refused request");
});

test("if no signed URL can be made the row is removed again", async () => {
  const fake = new Fake();
  fake.failSigned = true;
  await assert.rejects(
    () =>
      requestUpload(fake.admin, {
        fundId: FUND,
        userId: USER,
        fileName: "a.pdf",
        sizeBytes: 100,
        trustTier: "customer_doc",
      }),
    /storage down/,
  );
  assert.equal(fake.sources.size, 0);
});

test("a finished upload is read back, typed, hashed and priced, and waits for approval", async () => {
  const fake = new Fake();
  const bytes = await pdfFixture(
    Array.from({ length: 6 }, (_, i) => [`Afsnit ${i}`, line(i), line(i + 1), line(i + 2)]),
  );
  const ticket = await fake.upload("rapport.pdf", bytes);
  const result = await completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId });
  assert.equal(result.status, "awaiting_approval");
  if (result.status !== "awaiting_approval") return;
  assert.equal(result.pages, 6);
  assert.ok(result.chunks > 0);
  assert.equal(result.estimate.overLimit, false);
  assert.equal(result.suggestedPages, null);
  const row = fake.sources.get(ticket.sourceId)!;
  assert.ok(row.uploadCompletedAt && row.sha256);
  assert.equal(row.approvedAt, null, "nothing starts before a human approves the price");
  assert.deepEqual(fake.enqueued, []);
});

test("a renamed program is refused, and neither the file nor the row is kept (acceptance of BR-1-8)", async () => {
  const fake = new Fake();
  const windows = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 3, 0, 0, 0, 4, 0, 0, 0]);
  const ticket = await fake.upload("rapport.pdf", windows);
  await assert.rejects(
    () => completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId }),
    (error: unknown) => {
      assert.ok(error instanceof BrainUserError);
      assert.match(error.message, /program/);
      return true;
    },
  );
  assert.equal(fake.sources.size, 0);
  assert.equal(fake.files.size, 0);
});

test("content that does not fit its extension is refused and removed", async () => {
  const fake = new Fake();
  const ticket = await fake.upload("notat.docx", await pdfFixture([[line(1), line(2), line(3)]]));
  await assert.rejects(
    () => completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId }),
    BrainUserError,
  );
  assert.equal(fake.sources.size, 0);
  assert.equal(fake.files.size, 0);
});

test("the same file twice is 'Findes allerede': the new copy is removed and the old one is named", async () => {
  const fake = new Fake();
  const bytes = await pdfFixture([
    [line(1), line(2), line(3)],
    [line(4), line(5), line(6)],
  ]);
  const first = await fake.upload("rapport.pdf", bytes);
  await completeUpload(fake.admin, { fundId: FUND, sourceId: first.sourceId });
  const second = await fake.upload("kopi.pdf", bytes);
  const result = await completeUpload(fake.admin, { fundId: FUND, sourceId: second.sourceId });
  assert.equal(result.status, "duplicate");
  if (result.status === "duplicate") assert.equal(result.existing.id, first.sourceId);
  assert.ok(!fake.sources.has(second.sourceId));
  assert.ok(!fake.files.has(second.path));
  assert.ok(fake.files.has(first.path), "the original stays");
});

test("two identical uploads finishing at the same moment: one wins, the other is a duplicate", async () => {
  const fake = new Fake();
  const bytes = await pdfFixture([[line(1), line(2), line(3)]]);
  const winner = await fake.upload("a.pdf", bytes);
  await completeUpload(fake.admin, { fundId: FUND, sourceId: winner.sourceId });
  const loser = await fake.upload("b.pdf", bytes);
  fake.raceDuplicate = true;
  const result = await completeUpload(fake.admin, { fundId: FUND, sourceId: loser.sourceId });
  assert.equal(result.status, "duplicate");
});

test("a file that never arrived, and an upload that is already finished, give clear texts", async () => {
  const fake = new Fake();
  const ticket = await requestUpload(fake.admin, {
    fundId: FUND,
    userId: USER,
    fileName: "a.pdf",
    sizeBytes: 100,
    trustTier: "customer_doc",
  });
  await assert.rejects(
    () => completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId }),
    /nåede ikke frem/,
  );
  const bytes = await pdfFixture([[line(1), line(2), line(3)]]);
  const ok = await fake.upload("b.pdf", bytes);
  await completeUpload(fake.admin, { fundId: FUND, sourceId: ok.sourceId });
  await assert.rejects(
    () => completeUpload(fake.admin, { fundId: FUND, sourceId: ok.sourceId }),
    /allerede afsluttet/,
  );
  await assert.rejects(
    () =>
      completeUpload(fake.admin, {
        fundId: FUND,
        sourceId: "00000000-0000-4000-8000-ffffffffffff",
      }),
    /findes ikke/,
  );
});

test("a very long PDF is over the price limit, offers the pages that fit, and approval then needs that choice", async () => {
  const fake = new Fake();
  const dense = (page: number) =>
    Array.from({ length: 42 }, (_, i) =>
      `Side ${page} linje ${i}: ${line(page * 50 + i)}`.slice(0, 120),
    );
  // 60 dense pages are about 6 kr. (the first ~28 fit the 3 kr. limit); cut it from 300.
  const bytes = await pdfFixture(Array.from({ length: 60 }, (_, page) => dense(page)));
  const ticket = await fake.upload("stor.pdf", bytes);
  const result = await completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId });
  assert.equal(result.status, "awaiting_approval");
  if (result.status !== "awaiting_approval") return;
  assert.equal(result.estimate.overLimit, true);
  assert.ok(
    result.suggestedPages !== null && result.suggestedPages >= 1 && result.suggestedPages < 60,
    String(result.suggestedPages),
  );

  await assert.rejects(
    () => approveIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    /over loftet/,
  );
  assert.deepEqual(fake.enqueued, []);
  const approved = await approveIngest(fake.admin, {
    fundId: FUND,
    sourceId: ticket.sourceId,
    userId: USER,
    pageLimit: result.suggestedPages!,
  });
  assert.equal(approved.pageLimit, result.suggestedPages);
  assert.ok(approved.maxDkk <= 3);
  assert.deepEqual(fake.enqueued, [ingestKey(ticket.sourceId, 0)]);
});

test("a PDF over 300 pages is read up to 300 pages and remembers it", async () => {
  const fake = new Fake();
  const bytes = await pdfFixture(
    Array.from({ length: 302 }, (_, i) => [line(i), line(i + 1), line(i + 2)]),
  );
  const ticket = await fake.upload("meget-stor.pdf", bytes);
  const result = await completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId });
  assert.equal(result.status, "awaiting_approval");
  if (result.status === "awaiting_approval") {
    assert.equal(result.pageLimit, 300);
    assert.match(result.warnings.join(" "), /første 300 af 302/);
  }
});

test("approving starts INGEST once; a second approval, a page limit on a non-PDF and a bad limit are refused", async () => {
  const fake = new Fake();
  const bytes = await pdfFixture([
    [line(1), line(2), line(3)],
    [line(4), line(5), line(6)],
  ]);
  const ticket = await fake.upload("a.pdf", bytes);
  await assert.rejects(
    () => approveIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    /ikke afsluttet/,
  );
  await completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId });
  for (const pageLimit of [0, -1, 1.5, 301]) {
    await assert.rejects(
      () =>
        approveIngest(fake.admin, {
          fundId: FUND,
          sourceId: ticket.sourceId,
          userId: USER,
          pageLimit,
        }),
      /mellem 1 og 300/,
    );
  }
  const approved = await approveIngest(fake.admin, {
    fundId: FUND,
    sourceId: ticket.sourceId,
    userId: USER,
  });
  assert.equal(approved.pageLimit, null);
  assert.deepEqual(fake.enqueued, [ingestKey(ticket.sourceId, 0)]);
  assert.ok(fake.audits.some((audit) => audit.action === "brain_ingest_approved"));
  await assert.rejects(
    () => approveIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    /allerede godkendt/,
  );
  assert.equal(fake.enqueued.length, 1, "a second click starts nothing");
});

test("if the queue is down the approval is withdrawn, so the user can approve again", async () => {
  const fake = new Fake();
  const bytes = await pdfFixture([[line(1), line(2), line(3)]]);
  const ticket = await fake.upload("a.pdf", bytes);
  await completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId });
  fake.failEnqueue = true;
  await assert.rejects(
    () => approveIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    /queue down/,
  );
  assert.equal(fake.sources.get(ticket.sourceId)?.approvedAt, null);
  fake.failEnqueue = false;
  await approveIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER });
  assert.equal(fake.enqueued.length, 1);
});

test("a retry from the failed step is a new run with its own key; only a failed, approved source can be retried", async () => {
  const fake = new Fake();
  const bytes = await pdfFixture([[line(1), line(2), line(3)]]);
  const ticket = await fake.upload("a.pdf", bytes);
  await completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId });
  const row = fake.sources.get(ticket.sourceId)!;
  await assert.rejects(
    () => retryIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    /fejlet/,
  );
  row.status = "failed";
  row.failedStep = "embed";
  await assert.rejects(
    () => retryIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    /ikke godkendt/,
  );
  row.approvedAt = "2026-10-01T10:00:00Z";
  fake.highest = 0;
  const first = await retryIngest(fake.admin, {
    fundId: FUND,
    sourceId: ticket.sourceId,
    userId: USER,
  });
  assert.equal(first.run, 1, "the bare source id was the first run's key, a retry never reuses it");
  assert.equal(first.fromStep, "embed");
  fake.highest = 4;
  row.status = "failed";
  const second = await retryIngest(fake.admin, {
    fundId: FUND,
    sourceId: ticket.sourceId,
    userId: USER,
  });
  assert.equal(
    second.run,
    5,
    "one more than the highest run any job ever used, also if old jobs were deleted",
  );
  assert.deepEqual(fake.enqueued, [ingestKey(ticket.sourceId, 1), ingestKey(ticket.sourceId, 5)]);
});

test("pasted text becomes a .txt source and is priced like an upload; empty, too long and untitled texts are refused", async () => {
  const fake = new Fake();
  const result = await submitText(fake.admin, {
    fundId: FUND,
    userId: USER,
    title: "Mødenotat: Nordlys / 12. maj",
    text: "Vi talte om runway.\n\nOg om hiring af en CTO.",
    trustTier: "customer_doc",
  });
  assert.equal(result.status, "awaiting_approval");
  const row = [...fake.sources.values()][0]!;
  assert.equal(row.kind, "text");
  assert.equal(row.title, "Mødenotat: Nordlys / 12. maj");
  assert.ok(row.storagePath?.endsWith(".txt"));
  assert.ok(row.storagePath?.startsWith(`${FUND}/${row.id}/`));
  const base = { fundId: FUND, userId: USER, title: "x", trustTier: "customer_doc" };
  await assert.rejects(() => submitText(fake.admin, { ...base, text: "  \n " }), /tom/);
  await assert.rejects(
    () => submitText(fake.admin, { ...base, text: "a".repeat(50_001) }),
    /50\.000/,
  );
  await assert.rejects(
    () => submitText(fake.admin, { ...base, title: " ", text: "tekst" }),
    /titel/,
  );
});

test("two approvals at once start one run: the second finds the price already approved (review finding)", async () => {
  const fake = new Fake();
  const bytes = await pdfFixture([[line(1), line(2), line(3)]]);
  const ticket = await fake.upload("a.pdf", bytes);
  await completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId });
  const [a, b] = await Promise.allSettled([
    approveIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    approveIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
  ]);
  assert.equal([a, b].filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(fake.enqueued.length, 1);
  const lost = [a, b].find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.match(String(lost.reason?.message), /allerede godkendt/);
  assert.notEqual(
    fake.sources.get(ticket.sourceId)?.approvedAt,
    null,
    "the winner's approval stands",
  );
});

test("two retries at once start one run, and a queue that is down leaves the source failed so it can be retried (review findings)", async () => {
  const fake = new Fake();
  const bytes = await pdfFixture([[line(1), line(2), line(3)]]);
  const ticket = await fake.upload("a.pdf", bytes);
  await completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId });
  const row = fake.sources.get(ticket.sourceId)!;
  row.status = "failed";
  row.errorMessage = "Filen kunne ikke læses som en PDF.";
  row.approvedAt = "2026-10-01T10:00:00Z";
  fake.failEnqueue = true;
  await assert.rejects(
    () => retryIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    /queue down/,
  );
  assert.equal(row.status, "failed", "back to failed, not stuck as queued without a job");
  assert.equal(
    row.errorMessage,
    "Filen kunne ikke læses som en PDF.",
    "the error text is not lost",
  );
  fake.failEnqueue = false;
  const [a, b] = await Promise.allSettled([
    retryIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    retryIngest(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
  ]);
  assert.equal([a, b].filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(fake.enqueued.length, 1);
});

function website(pages: number, paragraphsPerPage = 1): WebsiteFile {
  return {
    format: WEBSITE_FORMAT,
    startUrl: "https://www.fund.test/",
    siteName: "Fund Ventures",
    pages: Array.from({ length: pages }, (_, index) => ({
      url: `https://www.fund.test/side-${index + 1}`,
      title: `Side ${index + 1}`,
      blocks: Array.from({ length: paragraphsPerPage }, (_, p) => ({
        text: Array.from({ length: 12 }, (_, l) => line(index * 100 + p * 12 + l)).join(" "),
      })),
    })),
    portfolio: [{ name: "Acme", domain: "acme.io" }],
    notes: ["1 login-sider blev sprunget over."],
  };
}

test("the fund's website becomes a customer_doc source with its address, priced against the website limit (BR-1-9)", async () => {
  const fake = new Fake();
  const result = await submitWebsite(fake.admin, { fundId: FUND, userId: USER, file: website(3) });
  assert.equal(result.status, "awaiting_approval");
  if (result.status !== "awaiting_approval") return;
  assert.equal(result.kind, "website");
  assert.equal(result.pages, 3);
  assert.equal(result.estimate.limitDkk, 10);
  assert.deepEqual(result.warnings, ["1 login-sider blev sprunget over."]);
  const row = fake.sources.get(result.sourceId)!;
  assert.equal(row.title, "Fund Ventures");
  assert.equal(row.fileName, "fund.test.json");
  assert.ok(row.storagePath?.startsWith(`${FUND}/${result.sourceId}/`));
  assert.ok(fake.audits.some((audit) => audit.action === "brain_website_read"));
  // The same site with nothing changed is "Findes allerede".
  const again = await submitWebsite(fake.admin, { fundId: FUND, userId: USER, file: website(3) });
  assert.equal(again.status, "duplicate");
  // A website can be limited to its first pages (at most 40), like a PDF.
  await assert.rejects(
    () =>
      approveIngest(fake.admin, {
        fundId: FUND,
        sourceId: result.sourceId,
        userId: USER,
        pageLimit: 41,
      }),
    /mellem 1 og 40/,
  );
  const approved = await approveIngest(fake.admin, {
    fundId: FUND,
    sourceId: result.sourceId,
    userId: USER,
    pageLimit: 2,
  });
  assert.equal(approved.pageLimit, 2);
  assert.deepEqual(fake.enqueued, [ingestKey(result.sourceId, 0)]);
});

test("a website over the 10 kr. limit offers the first pages that fit", async () => {
  const fake = new Fake();
  const result = await submitWebsite(fake.admin, {
    fundId: FUND,
    userId: USER,
    file: website(40, 12),
  });
  assert.equal(result.status, "awaiting_approval");
  if (result.status !== "awaiting_approval") return;
  assert.ok(result.estimate.overLimit, `max ${result.estimate.maxDkk} kr.`);
  assert.ok(
    result.suggestedPages !== null && result.suggestedPages >= 1 && result.suggestedPages < 40,
  );
  await assert.rejects(
    () => approveIngest(fake.admin, { fundId: FUND, sourceId: result.sourceId, userId: USER }),
    /over loftet på 10 kr/,
  );
  const approved = await approveIngest(fake.admin, {
    fundId: FUND,
    sourceId: result.sourceId,
    userId: USER,
    pageLimit: result.suggestedPages!,
  });
  assert.ok(approved.maxDkk <= 10);
});

test("a closed card removes the upload nobody approved, row and file, with an audit event; an approved source is left to Glem (T-743)", async () => {
  const fake = new Fake();
  const ticket = await fake.upload("a.txt", new TextEncoder().encode("hej verden ".repeat(50)));
  await completeUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId });
  assert.ok(fake.files.has(ticket.path));

  const first = await discardUpload(fake.admin, {
    fundId: FUND,
    sourceId: ticket.sourceId,
    userId: USER,
  });
  assert.deepEqual(first, { discarded: true });
  assert.equal(fake.sources.size, 0);
  assert.equal(fake.files.has(ticket.path), false);
  assert.equal(fake.audits.at(-1)?.action, "brain_upload_discarded");
  assert.deepEqual(
    Object.keys(fake.audits.at(-1)?.payload ?? {}).sort(),
    ["kind", "sha256"],
    "the immutable audit log never holds the title (T-792)",
  );
  assert.deepEqual(
    await discardUpload(fake.admin, { fundId: FUND, sourceId: ticket.sourceId, userId: USER }),
    { discarded: false },
    "a second call has nothing left to remove",
  );

  const kept = new Fake();
  const t2 = await kept.upload("b.txt", new TextEncoder().encode("hej verden ".repeat(50)));
  await completeUpload(kept.admin, { fundId: FUND, sourceId: t2.sourceId });
  await approveIngest(kept.admin, { fundId: FUND, sourceId: t2.sourceId, userId: USER });
  await assert.rejects(
    discardUpload(kept.admin, { fundId: FUND, sourceId: t2.sourceId, userId: USER }),
    BrainUserError,
  );
  assert.ok(kept.files.has(t2.path), "an approved source keeps its file");
});
