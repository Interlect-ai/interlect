/**
 * Runs the creation (`runJob` in `src/lib/cases/intake-run.ts`) from the browser and follows
 * the screening it starts: the REAL steps are read from `analysis_run_steps` (RLS: the fund's
 * members only) every few seconds until the run is finished. Nothing here invents a step.
 *
 * The state lives in `IntakeFlow`, so leaving the waiting page for "Opret en til" does not
 * stop a running creation; the screening itself runs on the server either way.
 */
import { startWithLimitChoice } from "@/lib/analysis/limit-choice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase/client";
import type { RunStep } from "@/components/ai/RunSteps";
import { createManualCase, extractPitchDeck, registerPitchDeck } from "@/lib/cases/cases.functions";
import {
  fetchCompanyFinancials,
  fetchForeignCompanyFinancials,
} from "@/lib/cases/financials.functions";
import { captureCompanyWebsite } from "@/lib/cases/website.functions";
import { runInitialScreening } from "@/lib/analysis/screening.functions";
import {
  findExistingCases,
  findScreeningRun,
  setIntakeCaseOrigin,
} from "@/lib/cases/intake.functions";
import { caseFileType } from "@/lib/cases/case-files";
import { useLanguage } from "@/lib/i18n/useT";
import { translate } from "@/lib/i18n/translate";
import {
  canStartCreation,
  newJob,
  runJob,
  SafeStepError,
  type CaseJob,
  type IntakeDeps,
  type IntakePlan,
} from "@/lib/cases/intake-run";

export interface RunProgress {
  /** analysis_runs.status; null until the first read. */
  status: string | null;
  steps: RunStep[];
}

const TERMINAL = new Set(["complete", "awaiting_approval", "failed", "cancelled"]);
const POLL_MS = 2500;

type Stage =
  "pre_seed" | "seed" | "series_a" | "series_b" | "later" | "growth" | "buyout" | "unknown";

export function useIntakeRun() {
  const language = useLanguage();
  const createCase = useServerFn(createManualCase);
  const registerDeck = useServerFn(registerPitchDeck);
  const extractDeck = useServerFn(extractPitchDeck);
  const captureWebsite = useServerFn(captureCompanyWebsite);
  const screenCase = useServerFn(runInitialScreening);
  const confirmCompany = useServerFn(fetchCompanyFinancials);
  const confirmForeign = useServerFn(fetchForeignCompanyFinancials);
  const findExisting = useServerFn(findExistingCases);
  const setOrigin = useServerFn(setIntakeCaseOrigin);
  const lookupRun = useServerFn(findScreeningRun);

  const [jobs, setJobs] = useState<CaseJob[]>([]);
  const [progress, setProgress] = useState<Record<string, RunProgress>>({});
  const plan = useRef<IntakePlan | null>(null);
  const generation = useRef(0);
  const jobsRef = useRef<CaseJob[]>([]);
  jobsRef.current = jobs;

  const deps = useMemo<IntakeDeps>(
    () => ({
      findExisting: async (fundId, name, website, cvrNumber) => {
        const hits = await findExisting({
          data: { fundIds: [fundId], companyName: name, website, cvrNumber },
        });
        const hit = hits[0];
        return hit ? { caseId: hit.caseId, companyName: hit.companyName } : null;
      },
      createCase: (fundId, company) =>
        createCase({
          data: {
            fundId,
            companyName: company.name,
            website: company.website,
            stage: company.stage as Stage,
            sector: company.sector,
            geography: company.geography,
            sourceNote: company.sourceNote,
            intakeText: company.notes,
            intakeTextSource: "analyst_note",
            founders: [],
          },
        }).then((result) => ({ caseId: result.caseId, warning: result.warning })),
      setOrigin: async (fundId, caseId, origin) => {
        await setOrigin({
          data: {
            fundId,
            caseId,
            sourceKind: (origin.sourceKind as never) ?? null,
            assignedTo: origin.assignedTo,
          },
        });
      },
      confirmIdentity: async (fundId, caseId, cvrNumber, country) => {
        if (country === "DK") await confirmCompany({ data: { fundId, caseId, cvrNumber } });
        else await confirmForeign({ data: { fundId, caseId, country, registryNumber: cvrNumber } });
      },
      uploadFile: async (fundId, caseId, file) => {
        const type = caseFileType(file.name);
        if (!type) throw new SafeStepError(translate(language, "intake.flow.deckError"));
        const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
        // One storage object PER CASE (never shared between funds).
        const storagePath = `${fundId}/${caseId}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from("pitch-decks")
          .upload(storagePath, file, { contentType: type.mimeType, upsert: false });
        if (error) {
          console.warn("[intake] deck upload", error.message);
          throw new SafeStepError(translate(language, "intake.job.intake_upload"));
        }
        const registered = await registerDeck({
          data: {
            caseId,
            fileName: file.name,
            storagePath,
            mimeType: type.mimeType as never,
            sizeBytes: file.size,
          },
        });
        return { documentId: registered.documentId };
      },
      extractFile: async (caseId, documentId) => {
        await extractDeck({ data: { caseId, documentId } });
      },
      captureWebsite: async (caseId, website) => {
        await captureWebsite({ data: { caseId, website } });
      },
      findScreeningRun: async (fundId, caseId) => {
        const found = await lookupRun({ data: { fundId, caseId } });
        return found.runId;
      },
      startScreening: async (fundId, caseId) => {
        // The team asks first ("Spørg mig først"); cancelled = nothing started.
        const started = await startWithLimitChoice(fundId, "screening", (atLimit) =>
          screenCase({ data: { caseId, fundId, atLimit } }),
        );
        if (!started || started.runId === null) {
          // Cancel at the limit: the case is made, the screening is not started.
          throw new SafeStepError(translate(language, "fundSetup.limitChoice.notStarted"));
        }
        return { runId: started.runId };
      },
    }),
    [
      language,
      captureWebsite,
      confirmCompany,
      confirmForeign,
      createCase,
      extractDeck,
      findExisting,
      registerDeck,
      lookupRun,
      screenCase,
      setOrigin,
    ],
  );

  const emitFor = useCallback(
    (token: number) => (job: CaseJob) => {
      if (token !== generation.current) return;
      setJobs((current) => current.map((entry) => (entry.id === job.id ? job : entry)));
    },
    [],
  );

  const start = useCallback(
    (next: IntakePlan, funds: Array<{ id: string; name: string }>) => {
      // A second click or key press while a creation is running must not start another one.
      if (!canStartCreation(jobsRef.current)) return;
      const token = ++generation.current;
      plan.current = next;
      const initial = funds.map((fund) => newJob(fund, next));
      setJobs(initial);
      setProgress({});
      const emit = emitFor(token);
      for (const job of initial) void runJob(job, next, deps, emit, language);
    },
    [deps, emitFor, language],
  );

  const retry = useCallback(
    (jobId: string) => {
      const current = plan.current;
      if (!current) return;
      const job = jobsRef.current.find((entry) => entry.id === jobId);
      if (job && job.state !== "running")
        void runJob(job, current, deps, emitFor(generation.current), language);
    },
    [deps, emitFor, language],
  );

  /** The screening failed on the server after it started: the step turns failed so it can be retried. */
  const markScreeningFailed = useCallback(
    (jobId: string) => {
      setJobs((all) =>
        all.map((job) =>
          job.id !== jobId
            ? job
            : {
                ...job,
                runId: null,
                state: "attention",
                steps: job.steps.map((step) =>
                  step.key === "intake_screening"
                    ? {
                        ...step,
                        status: "failed",
                        message: translate(language, "intake.job.screeningFailed"),
                      }
                    : step,
                ),
              },
        ),
      );
    },
    [language],
  );

  const reset = useCallback(() => {
    generation.current += 1;
    plan.current = null;
    setJobs([]);
    setProgress({});
  }, []);

  // Follow every started screening until it is finished.
  const runKey = jobs
    .map((job) => (job.runId ? `${job.id}:${job.runId}` : ""))
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    const targets = runKey
      .split("|")
      .filter(Boolean)
      .map((entry) => {
        const [jobId, runId] = entry.split(":");
        return { jobId: jobId!, runId: runId! };
      });
    if (targets.length === 0) return;
    let cancelled = false;
    const done = new Set<string>();
    const tick = async () => {
      for (const target of targets) {
        if (cancelled || done.has(target.runId)) continue;
        const [runResult, stepResult] = await Promise.all([
          supabase.from("analysis_runs").select("status").eq("id", target.runId).maybeSingle(),
          supabase
            .from("analysis_run_steps")
            .select("step_key, step_order, status, started_at, completed_at")
            .eq("run_id", target.runId)
            .order("step_order")
            .order("created_at"),
        ]);
        if (cancelled) return;
        if (runResult.error || stepResult.error) {
          console.warn(
            "[intake] run progress",
            runResult.error?.message ?? stepResult.error?.message,
          );
          continue;
        }
        const status = (runResult.data?.["status"] as string | undefined) ?? null;
        const steps: RunStep[] = (stepResult.data ?? []).map((row) => ({
          key: row["step_key"] as string,
          status: row["status"] as string,
          startedAt: (row["started_at"] as string | null) ?? null,
          completedAt: (row["completed_at"] as string | null) ?? null,
        }));
        setProgress((current) => ({ ...current, [target.jobId]: { status, steps } }));
        if (status && TERMINAL.has(status)) {
          done.add(target.runId);
          if (status === "failed" || status === "cancelled") markScreeningFailed(target.jobId);
        }
      }
    };
    void tick();
    const timer = window.setInterval(() => {
      if (done.size < targets.length) void tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runKey, markScreeningFailed]);

  return { jobs, progress, start, retry, reset, active: jobs.length > 0 };
}
