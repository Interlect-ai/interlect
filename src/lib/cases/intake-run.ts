/**
 * Batch 3: the creation orchestration behind "Start screening" / "Opret uden screening".
 * One JOB per chosen fund (today thesis = fund): every job has its own case, its own steps,
 * its own errors and its own retry. Nothing is shared between jobs except the user's input;
 * a deck is uploaded once PER CASE (separate storage object per fund).
 *
 * Steps, in order:
 *   intake_create    hard   createManualCase (after a duplicate check; a duplicate stops the job
 *                           with a link to the existing case, never a raw error)
 *   intake_origin    soft   set_case_origin (only when the database has the columns, 0056)
 *   intake_identity  soft   the human-chosen CVR / registry number is stored on the company (fetch*Financials)
 *   intake_upload    soft   deck(s) to private storage + register, per file
 *   intake_extract   soft   deck text as evidence, per file
 *   intake_website   soft   website capture
 *   intake_screening hard   runInitialScreening (never in mode "create"; deep analysis is never
 *                           started from here: principle 10)
 *
 * Soft steps never stop the case; they become warnings with their own "Prøv igen". `runJob` can
 * be called again for the same job: finished steps are left alone, so a retry repeats only what
 * failed (and, per file, only the files that failed). Pure: every external call is in `deps`,
 * so the whole thing is unit-tested without network (intake-run.test.ts).
 */

import type { RegistryCountry } from "../analysis/registries/types.ts";
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import { isCreditStop } from "../ai/credit-meter.ts";

export type JobStepKey =
  | "intake_create"
  | "intake_origin"
  | "intake_identity"
  | "intake_upload"
  | "intake_extract"
  | "intake_website"
  | "intake_screening";

export type JobStepStatus = "queued" | "running" | "complete" | "failed" | "skipped";

export interface JobStep {
  key: JobStepKey;
  status: JobStepStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** Danish, safe to show; set when the step failed or was skipped on purpose. */
  message: string | null;
}

export interface JobFile {
  name: string;
  documentId: string | null;
  extracted: boolean;
  /** Last error for this file, safe to show. */
  error: string | null;
}

export interface ExistingCase {
  caseId: string;
  companyName: string;
}

export interface CaseJob {
  /** The fund id (one job per fund). */
  id: string;
  fundId: string;
  fundName: string;
  caseId: string | null;
  runId: string | null;
  steps: JobStep[];
  files: JobFile[];
  duplicate: ExistingCase | null;
  /** Things that went wrong without stopping the case (safe to show). */
  warnings: string[];
  /** `running`: working; `done`: all steps finished; `attention`: something failed. */
  state: "idle" | "running" | "done" | "attention";
}

export interface IntakeCompany {
  name: string;
  website: string;
  stage: string;
  sector: string;
  geography: string;
  /** "Jeres noter" from the start screen (evidence: the team's own statement). */
  notes: string;
  /** "Hvorfor kigger I på selskabet?" from Bekræft (the case's source note). */
  sourceNote: string;
  /** The CVR (foreign registry number) a human chose in Find / Bekræft; null when none. */
  cvrNumber: string | null;
  /** The register `cvrNumber` belongs to; left out for a Danish CVR. */
  registryCountry?: RegistryCountry;
  /**
   * The user actively chose this company (picked it, or typed its CVR). Only then is it stored
   * as the confirmed company; a match Interlect picked on its own is left to screening step 0.
   */
  humanChoseCompany: boolean;
}

export interface IntakeOrigin {
  sourceKind: string | null;
  assignedTo: string | null;
}

export interface IntakePlan {
  /** `screen`: start the screening. `create`: only create ("afventer screening"). */
  mode: "screen" | "create";
  company: IntakeCompany;
  /** Only when the database supports it (capability) and something was chosen. */
  origin: IntakeOrigin | null;
  files: File[];
  captureWebsite: boolean;
}

export interface IntakeDeps {
  findExisting(
    fundId: string,
    name: string,
    website: string,
    cvrNumber: string | null,
  ): Promise<ExistingCase | null>;
  createCase(
    fundId: string,
    company: IntakeCompany,
  ): Promise<{ caseId: string; warning?: string | null }>;
  setOrigin(fundId: string, caseId: string, origin: IntakeOrigin): Promise<void>;
  confirmIdentity(
    fundId: string,
    caseId: string,
    cvrNumber: string,
    country: RegistryCountry,
  ): Promise<void>;
  uploadFile(fundId: string, caseId: string, file: File): Promise<{ documentId: string }>;
  extractFile(caseId: string, documentId: string): Promise<void>;
  captureWebsite(caseId: string, website: string): Promise<void>;
  startScreening(fundId: string, caseId: string): Promise<{ runId: string }>;
  /** The case's latest screening run that is queued, running or finished (null = none found). */
  findScreeningRun(fundId: string, caseId: string): Promise<string | null>;
  now?(): string;
}

/** Which steps a plan needs, in order. */
export function planSteps(plan: IntakePlan): JobStepKey[] {
  return [
    "intake_create",
    ...(plan.origin ? (["intake_origin"] as const) : []),
    // "Opret uden screening" makes no registry/XBRL fetch at all ("ingen kørsel" is literal).
    ...(plan.company.cvrNumber && plan.company.humanChoseCompany && plan.mode === "screen"
      ? (["intake_identity"] as const)
      : []),
    ...(plan.files.length > 0 ? (["intake_upload", "intake_extract"] as const) : []),
    ...(plan.captureWebsite && plan.company.website ? (["intake_website"] as const) : []),
    ...(plan.mode === "screen" ? (["intake_screening"] as const) : []),
  ];
}

export function newJob(fund: { id: string; name: string }, plan: IntakePlan): CaseJob {
  return {
    id: fund.id,
    fundId: fund.id,
    fundName: fund.name,
    caseId: null,
    runId: null,
    steps: planSteps(plan).map((key) => ({
      key,
      status: "queued",
      startedAt: null,
      completedAt: null,
      message: null,
    })),
    files: plan.files.map((file) => ({
      name: file.name,
      documentId: null,
      extracted: false,
      error: null,
    })),
    duplicate: null,
    warnings: [],
    state: "idle",
  };
}

/** An error whose message the code wrote itself (already in the fund's language): shown as is. */
export class SafeStepError extends Error {}

/** Messages that are safe to show; anything else (network, driver, stack) becomes the fallback. */
export function friendlyStepError(cause: unknown, fallback: string): string {
  // Texts the client itself wrote (in the fund's language) are always safe to show.
  if (cause instanceof SafeStepError) return cause.message;
  const message = cause instanceof Error ? cause.message.trim() : "";
  if (!message || message.length > 220) return fallback;
  // The balance refusal, in either language: shown with "Fyld op".
  if (isCreditStop(message)) return message;
  if (
    /failed to fetch|networkerror|typeerror|load failed|abort|json|undefined|\[object|\bat\s.+:\d+/i.test(
      message,
    )
  ) {
    return fallback;
  }
  // Server functions throw deliberate Danish messages; English text is a driver or library.
  return /[æøåÆØÅ]|\b(casen|decket|websitet|stadiet|fonden|selskab|du |den |denne|prøv|kunne|for mange)/i.test(
    message,
  )
    ? message
    : fallback;
}

const FALLBACK_KEYS: Record<JobStepKey, MessageKey> = {
  intake_create: "intake.job.intake_create",
  intake_origin: "intake.job.intake_origin",
  intake_identity: "intake.job.intake_identity",
  intake_upload: "intake.job.intake_upload",
  intake_extract: "intake.job.intake_extract",
  intake_website: "intake.job.intake_website",
  intake_screening: "intake.job.intake_screening",
};

type Emit = (job: CaseJob) => void;

function patchStep(job: CaseJob, key: JobStepKey, patch: Partial<JobStep>): CaseJob {
  return {
    ...job,
    steps: job.steps.map((step) => (step.key === key ? { ...step, ...patch } : step)),
  };
}

/**
 * Runs (or re-runs) every step that is not finished. Never throws: all failures end up in the
 * job. Returns the final job (also passed to `emit` after every change).
 */
export async function runJob(
  startJob: CaseJob,
  plan: IntakePlan,
  deps: IntakeDeps,
  emit: Emit,
  language: Language = "da",
): Promise<CaseJob> {
  const fallback = (key: JobStepKey) => translate(language, FALLBACK_KEYS[key]);
  const now = deps.now ?? (() => new Date().toISOString());
  let job: CaseJob = { ...startJob, state: "running" };
  emit(job);

  const set = (next: CaseJob) => {
    job = next;
    emit(job);
  };
  const begin = (key: JobStepKey) =>
    set(
      patchStep(job, key, {
        status: "running",
        startedAt: now(),
        completedAt: null,
        message: null,
      }),
    );
  const finish = (key: JobStepKey, status: JobStepStatus, message: string | null = null) =>
    set(patchStep(job, key, { status, completedAt: now(), message }));
  const pending = (key: JobStepKey) => {
    const step = job.steps.find((candidate) => candidate.key === key);
    return step !== undefined && step.status !== "complete" && step.status !== "skipped";
  };
  const stop = (): CaseJob => {
    set({ ...job, state: "attention" });
    return job;
  };

  // 1. Create (hard). A duplicate in the same fund is a friendly stop, not an error.
  if (pending("intake_create") || !job.caseId) {
    begin("intake_create");
    try {
      const existing = await deps.findExisting(
        job.fundId,
        plan.company.name,
        plan.company.website,
        // The duplicate check knows Danish CVRs only; a foreign number matches by name/website.
        (plan.company.registryCountry ?? "DK") === "DK" ? plan.company.cvrNumber : null,
      );
      if (existing) {
        set({ ...job, duplicate: existing });
        finish(
          "intake_create",
          "failed",
          translate(language, "intake.job.duplicate", {
            company: existing.companyName,
            fund: job.fundName,
          }),
        );
        return stop();
      }
      const created = await deps.createCase(job.fundId, plan.company);
      set({
        ...job,
        caseId: created.caseId,
        duplicate: null,
        warnings: created.warning ? [...job.warnings, created.warning] : job.warnings,
      });
      finish("intake_create", "complete");
    } catch (cause) {
      console.warn("[intake] create failed", cause);
      finish("intake_create", "failed", friendlyStepError(cause, fallback("intake_create")));
      return stop();
    }
  }
  const caseId = job.caseId!;

  // 2. Origin and owner (soft).
  if (plan.origin && pending("intake_origin")) {
    begin("intake_origin");
    try {
      await deps.setOrigin(job.fundId, caseId, plan.origin);
      finish("intake_origin", "complete");
    } catch (cause) {
      console.warn("[intake] origin failed", cause);
      finish("intake_origin", "failed", friendlyStepError(cause, fallback("intake_origin")));
    }
  }

  // 3. The chosen company (soft).
  if (plan.company.cvrNumber && plan.company.humanChoseCompany && pending("intake_identity")) {
    begin("intake_identity");
    try {
      await deps.confirmIdentity(
        job.fundId,
        caseId,
        plan.company.cvrNumber,
        plan.company.registryCountry ?? "DK",
      );
      finish("intake_identity", "complete");
    } catch (cause) {
      console.warn("[intake] identity failed", cause);
      finish("intake_identity", "failed", friendlyStepError(cause, fallback("intake_identity")));
    }
  }

  // 4. Decks: upload + register per file, then extract per file (soft, only what is missing).
  if (plan.files.length > 0 && pending("intake_upload")) {
    begin("intake_upload");
    let failure: string | null = null;
    for (let index = 0; index < plan.files.length; index += 1) {
      if (job.files[index]?.documentId) continue;
      try {
        const uploaded = await deps.uploadFile(job.fundId, caseId, plan.files[index]!);
        set({
          ...job,
          files: job.files.map((entry, i) =>
            i === index ? { ...entry, documentId: uploaded.documentId, error: null } : entry,
          ),
        });
      } catch (cause) {
        console.warn("[intake] upload failed", cause);
        failure = friendlyStepError(cause, fallback("intake_upload"));
        set({
          ...job,
          files: job.files.map((entry, i) => (i === index ? { ...entry, error: failure } : entry)),
        });
      }
    }
    finish("intake_upload", failure ? "failed" : "complete", failure);
  }
  if (plan.files.length > 0 && pending("intake_extract")) {
    begin("intake_extract");
    let failure: string | null = null;
    let any = false;
    for (let index = 0; index < plan.files.length; index += 1) {
      const entry = job.files[index];
      if (!entry?.documentId || entry.extracted) continue;
      any = true;
      try {
        await deps.extractFile(caseId, entry.documentId);
        set({
          ...job,
          files: job.files.map((file, i) =>
            i === index ? { ...file, extracted: true, error: null } : file,
          ),
        });
      } catch (cause) {
        console.warn("[intake] extract failed", cause);
        failure = friendlyStepError(cause, fallback("intake_extract"));
        set({
          ...job,
          files: job.files.map((file, i) => (i === index ? { ...file, error: failure } : file)),
        });
      }
    }
    const missingUpload = job.files.some((file) => !file.documentId);
    if (!any && missingUpload) {
      // Failed, not skipped: a retry must re-enter the sequence here once the upload is fixed.
      finish("intake_extract", "failed", translate(language, "intake.job.extractNeedsUpload"));
    } else {
      finish("intake_extract", failure ? "failed" : "complete", failure);
    }
  }

  // 5. Website (soft).
  if (plan.captureWebsite && plan.company.website && pending("intake_website")) {
    begin("intake_website");
    try {
      await deps.captureWebsite(caseId, plan.company.website);
      finish("intake_website", "complete");
    } catch (cause) {
      console.warn("[intake] website failed", cause);
      finish("intake_website", "failed", friendlyStepError(cause, fallback("intake_website")));
    }
  }

  // 6. Screening (hard, never in mode "create"). Never deep analysis. A paid run is only started
  // when the chosen deck is in and read: otherwise it would ignore the deck and never be repeated.
  const deckReady =
    plan.files.length === 0 || (!pending("intake_upload") && !pending("intake_extract"));
  if (plan.mode === "screen" && pending("intake_screening") && !deckReady) {
    return stop();
  }
  if (plan.mode === "screen" && pending("intake_screening")) {
    begin("intake_screening");
    try {
      const started = await deps.startScreening(job.fundId, caseId);
      set({ ...job, runId: started.runId });
      finish("intake_screening", "complete");
    } catch (cause) {
      console.warn("[intake] screening failed", cause);
      const message = cause instanceof Error ? cause.message : "";
      // "Denne case screenes allerede" on a retry means the first start did go through.
      if (/screenes allerede/i.test(message)) {
        // The response of the first start was lost: pick up that run so the page can follow it.
        let existing: string | null = null;
        try {
          existing = await deps.findScreeningRun(job.fundId, caseId);
        } catch (lookup) {
          console.warn("[intake] run lookup failed", lookup);
        }
        if (existing) set({ ...job, runId: existing });
        finish(
          "intake_screening",
          "complete",
          existing ? null : translate(language, "intake.job.screeningRunning"),
        );
      } else {
        finish(
          "intake_screening",
          "failed",
          friendlyStepError(cause, fallback("intake_screening")),
        );
        return stop();
      }
    }
  }

  const failed = job.steps.some((step) => step.status === "failed");
  set({ ...job, state: failed ? "attention" : "done" });
  return job;
}

/** Normalises what the user typed in the website field; "" when it is not an address. */
export function normalizeWebsiteInput(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  if ((text.match(/https?:\/\//gi)?.length ?? 0) > 1) return "";
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withProtocol);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** A name that can open a case: not empty and not a bare CVR number. */
export function isUsableName(name: string): boolean {
  const text = name.trim();
  return text.length > 0 && !/^\d{8}$/.test(text);
}

/** The screening this job started has finished (analysis_runs.status). */
export function screeningFinished(job: CaseJob, runStatus: string | null | undefined): boolean {
  // An untracked run (started, but its id was lost) counts as "nothing more to wait for here":
  // the page shows the message and "Åbn screeningen" to follow it on the case.
  if (screeningUntracked(job)) return true;
  return Boolean(job.runId) && (runStatus === "complete" || runStatus === "awaiting_approval");
}

/** The screening was started but its run could not be found again: the page cannot follow it. */
export function screeningUntracked(job: CaseJob): boolean {
  const step = job.steps.find((candidate) => candidate.key === "intake_screening");
  return step?.status === "complete" && !job.runId;
}

/** A new creation may only start when no job of the previous one is still working. */
export function canStartCreation(jobs: readonly CaseJob[]): boolean {
  return !jobs.some((job) => job.state === "running" || job.state === "idle");
}
