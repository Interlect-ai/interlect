/**
 * Opret case, step 4 "Interlect arbejder" (prototype "Opret case.dc.html", `sRun`): the orb,
 * a short title, and the steps. The steps are the REAL ones: the creation steps (`intake_*`)
 * from the orchestration and, once the screening has started, the rows of `analysis_run_steps`
 * read from the database. No label is invented.
 *
 * One panel per case (one case per chosen thesis): a failed step shows its own safe message and
 * "Prøv igen", which repeats only what failed. A duplicate shows a friendly line with a link to
 * the existing case. The screening itself runs on the server, so "Til Cases" and "Opret en til"
 * never stop it.
 */
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, FileText, TriangleAlert } from "lucide-react";
import { AiBeam } from "@/components/ai/AiBeam";
import { AiImageFx } from "@/components/ai/AiImageFx";
import { AiOrb } from "@/components/ai/AiOrb";
import { RunSteps, type RunStep } from "@/components/ai/RunSteps";
import { runStepOrb } from "@/lib/cases/run-steps";
import { screeningFinished, screeningUntracked, type CaseJob } from "@/lib/cases/intake-run";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/useT";
import { CreditTopUpAction } from "@/components/ai/CreditStop";
import { isCreditStop } from "@/lib/ai/credit-meter";
import type { RunProgress } from "./useIntakeRun";
import type { StartAction } from "./types";

function jobScreeningDone(job: CaseJob, progress: RunProgress | undefined): boolean {
  return screeningFinished(job, progress?.status);
}

/** Pitch deck og filer uploades eller læses lige nu (img-fx viser, at Interlect læser dem). */
function deckBusy(job: CaseJob): boolean {
  if (job.files.length === 0) return false;
  return job.steps.some(
    (step) =>
      (step.key === "intake_upload" || step.key === "intake_extract") && step.status === "running",
  );
}

function jobSteps(job: CaseJob, progress: RunProgress | undefined): RunStep[] {
  const own: RunStep[] = job.steps.map((step) => ({
    key: step.key,
    status: step.status,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
  }));
  // A case that was never created has nothing after "Opretter casen" to wait for.
  const shown = job.caseId ? own : own.filter((step) => step.key === "intake_create");
  return [...shown, ...(job.runId && progress ? progress.steps : [])];
}

export function RunWait({
  jobs,
  progress,
  action,
  onRetry,
  onAnother,
  headingRef,
}: {
  jobs: CaseJob[];
  progress: Record<string, RunProgress>;
  action: StartAction;
  onRetry: (jobId: string) => void;
  onAnother: () => void;
  headingRef: React.Ref<HTMLHeadingElement>;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const screening = action !== "create";
  const creating = jobs.some((job) => job.state === "running" || job.state === "idle");
  const screeningRunning =
    screening &&
    jobs.some(
      (job) =>
        job.runId && !screeningFinished(job, progress[job.id]?.status) && job.state !== "attention",
    );
  const running = creating || screeningRunning;
  const attention = !running && jobs.some((job) => job.state === "attention");
  const allDone =
    !running &&
    !attention &&
    jobs.length > 0 &&
    jobs.every((job) =>
      screening ? jobScreeningDone(job, progress[job.id]) : job.state === "done",
    );
  const multi = jobs.length > 1;

  const activeStepKey = jobs
    .flatMap((job) => jobSteps(job, progress[job.id]))
    .find((step) => step.status === "running")?.key;

  let title = t("intake.wait.working");
  let sub: string | null = screening ? t("intake.wait.subScreening") : t("intake.wait.subCreate");
  if (attention) {
    title = t("intake.wait.attentionTitle");
    sub = t("intake.wait.attentionSub");
  } else if (allDone) {
    title = screening
      ? t("intake.wait.doneScreening")
      : multi
        ? t("intake.wait.doneCasesCreated")
        : t("intake.wait.doneCaseCreated");
    // A plain screening needs no line: "Åbn screeningen" right below says it.
    sub = screening
      ? action === "screen_then_review"
        ? t("intake.wait.doneSubReview")
        : null
      : t("intake.wait.doneSubCreate");
  } else if (!running && jobs.length > 0) {
    // Screening started and the case is waiting for the model: still working.
    title = t("intake.wait.working");
  }

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-6 md:p-10">
      <motion.div
        className="flex w-full max-w-[520px] flex-col items-center gap-[26px] text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        {running && (
          <AiOrb
            size={64}
            tone="ai"
            state={activeStepKey ? runStepOrb(activeStepKey) : "working"}
          />
        )}
        {allDone && (
          <motion.span
            className="grid size-[72px] place-items-center rounded-full bg-positive text-white"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduced ? { duration: 0.12 } : { type: "spring", stiffness: 380, damping: 24 }
            }
            aria-hidden
          >
            <Check className="size-[30px]" strokeWidth={2.25} />
          </motion.span>
        )}
        {attention && (
          <span
            className="grid size-[72px] place-items-center rounded-full bg-warning-wash text-warning"
            aria-hidden
          >
            <TriangleAlert className="size-[30px]" strokeWidth={1.75} />
          </span>
        )}
        <div className="flex flex-col gap-2" aria-live="polite">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="m-0 text-[26px] font-semibold tracking-title text-ink-1 outline-none"
          >
            {title}
          </h2>
          {sub && <span className="text-[15px] leading-[1.55] text-ink-3">{sub}</span>}
        </div>

        <div className="flex w-full flex-col gap-3 text-left">
          {jobs.map((job) => {
            // Failed steps, and finished steps that carry a note (e.g. a screening that runs,
            // but could not be found again).
            const failedSteps = job.steps.filter(
              (step) => (step.status === "failed" || step.status === "complete") && step.message,
            );
            const fileErrors = job.files.filter((file) => file.error);
            return (
              <AiBeam key={job.id} active={running}>
                <section
                  aria-label={
                    multi
                      ? t("intake.wait.sectionFund", { fund: job.fundName })
                      : t("intake.wait.sectionCase")
                  }
                  className="flex flex-col gap-2 rounded-lg bg-canvas p-2.5"
                >
                  {multi && (
                    <div className="flex items-center gap-2 px-2.5 pt-1.5">
                      <span className="text-[15px] font-semibold text-ink-1">{job.fundName}</span>
                      {job.state === "done" && jobScreeningDone(job, progress[job.id]) && (
                        <span className="text-meta text-positive">{t("intake.wait.finished")}</span>
                      )}
                    </div>
                  )}
                  {deckBusy(job) && (
                    <AiImageFx active>
                      <div
                        role="status"
                        className="mx-2.5 flex min-h-14 items-center gap-2.5 rounded-[14px] bg-surface px-4 py-3 text-list text-ink-2 shadow-pill"
                      >
                        <FileText
                          className="size-4 shrink-0 text-series-3"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate">
                          {job.files.length === 1
                            ? t("intake.wait.readingOne", { name: job.files[0]!.name })
                            : t("intake.wait.readingMany", { count: job.files.length })}
                        </span>
                      </div>
                    </AiImageFx>
                  )}
                  <RunSteps steps={jobSteps(job, progress[job.id])} className="px-2.5 py-1" />
                  {(failedSteps.length > 0 ||
                    fileErrors.length > 0 ||
                    job.warnings.length > 0 ||
                    job.duplicate) && (
                    <div className="flex flex-col gap-2 px-2.5 pb-1.5">
                      {failedSteps.map((step) => (
                        <p
                          key={step.key}
                          role="status"
                          className={cn(
                            "m-0 text-list leading-[1.5]",
                            step.status === "failed" &&
                              (step.key === "intake_create" || step.key === "intake_screening")
                              ? "text-critical"
                              : "text-warning",
                          )}
                        >
                          {step.message}
                        </p>
                      ))}
                      {job.warnings.map((warning) => (
                        <p
                          key={warning}
                          role="status"
                          className="m-0 text-list leading-[1.5] text-warning"
                        >
                          {warning}
                        </p>
                      ))}
                      {fileErrors.length > 1 &&
                        fileErrors.map((file) => (
                          <p key={file.name} className="m-0 text-meta text-ink-3">
                            {file.name}: {file.error}
                          </p>
                        ))}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {/* The screening stopped on the balance: "Fyld op" for Admin. */}
                        {failedSteps.some(
                          (step) => step.status === "failed" && isCreditStop(step.message),
                        ) && <CreditTopUpAction fundId={job.fundId} />}
                        {job.duplicate && (
                          <Link
                            to="/cases/$caseId"
                            params={{ caseId: job.duplicate.caseId }}
                            search={{ view: "screening" }}
                            className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-surface px-3.5 text-list font-medium whitespace-nowrap text-ink-1 shadow-pill outline-none focus-visible:ring-2 focus-visible:ring-action"
                          >
                            {t("intake.wait.openExisting")}
                            <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
                          </Link>
                        )}
                        {!job.duplicate && job.state === "attention" && (
                          <button
                            type="button"
                            onClick={() => onRetry(job.id)}
                            className="inline-flex h-9 items-center rounded-pill bg-surface px-3.5 text-list font-medium whitespace-nowrap text-ink-1 shadow-pill outline-none focus-visible:ring-2 focus-visible:ring-action"
                          >
                            {t("intake.wait.retry")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </AiBeam>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Link
            to="/cases"
            className="inline-flex h-11 items-center rounded-pill bg-surface px-[18px] text-[14px] font-medium text-ink-1 shadow-pill outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {t("intake.wait.toCases")}
          </Link>
          {jobs.map((job) => {
            const ready = screening
              ? jobScreeningDone(job, progress[job.id])
              : job.state === "done";
            if (!ready || !job.caseId) return null;
            return (
              <motion.span
                key={job.id}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
              >
                <Link
                  to="/cases/$caseId"
                  params={{ caseId: job.caseId }}
                  search={{ view: "screening" }}
                  className="inline-flex h-11 items-center gap-2 rounded-pill bg-inverse px-5 text-[14px] font-medium whitespace-nowrap text-ink-inverse outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  {screening ? t("intake.wait.openScreening") : t("intake.wait.openCase")}
                  {multi ? t("intake.wait.inFund", { fund: job.fundName }) : ""}
                  <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
                </Link>
              </motion.span>
            );
          })}
          {!creating && (
            <button
              type="button"
              onClick={onAnother}
              className="h-11 rounded-pill bg-transparent px-[18px] text-[14px] font-medium whitespace-nowrap text-ink-2 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
            >
              {t("intake.wait.another")}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
