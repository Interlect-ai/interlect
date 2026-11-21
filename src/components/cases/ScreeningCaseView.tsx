/**
 * The screening of a case (Case Screening v5; v0.2–v0.5 and "Hvad styrer screeningen"). The top is
 * the case top (one next step in the split button), then the
 * summary with "Læs mere om virksomheden" and the score; the tabs Oversigt (four cards and
 * "Skal afklares"), Noter, Beskeder and Filer. Every card opens a focus page; "Hvorfor?" holds
 * what the surface no longer shows (sources, data trust, the score's path, the run).
 *
 * The tab and the focus page are in the URL (gap/R-5-screening.md, choice 3). Everything is
 * real data: the run, the team's tasks, notes, messages (live) and files.
 */
import { PriceLimitStopped } from "@/components/cases/PriceLimitStopped";
import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { AiBeam } from "@/components/ai/AiBeam";
import { AiOrb, PendingLabel, type OrbState } from "@/components/ai/AiOrb";
import { Button } from "@/components/ds/Button";
import { RunStalled } from "@/components/cases/RunStalled";
import { runStalled, screeningRetryable } from "@/lib/cases/run-stall";
import { useNow } from "@/lib/ui/use-now";
import { RunSteps } from "@/components/ai/RunSteps";
import { FocusHost } from "@/components/ds/FocusPage";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { TaskList } from "@/components/ds/TaskList";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { defaultDueChoices } from "@/components/ds/task-types";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import { listFinancialStatements } from "@/lib/cases/financials.functions";
import { financeSummary } from "@/lib/cases/finance-summary";
import { runStepName, runStepOrb } from "@/lib/cases/run-steps";
import {
  companyProfileSections,
  findingBalance,
  findingColumns,
  fitSummary,
  profileRows,
  recommendationLine,
} from "@/lib/cases/screening-view";
import { caseMeta } from "@/lib/cases/case-meta";
import type { CaseViewModel } from "@/lib/cases/view-model";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { ScreeningHero } from "./screening/ScreeningHero";
import { ScreeningModules, type ScreeningFocus } from "./screening/ScreeningModules";
import { ProfileFocus } from "./screening/ProfileFocus";
import { MandatFocus } from "./screening/MandatFocus";
import { FindingsFocus } from "./screening/FindingsFocus";
import { FinanceFocus } from "./screening/FinanceFocus";
import { WhyFocus } from "./screening/WhyFocus";
import { FilesTab, MessagesTab, NotesTab } from "./screening/CaseTabs";
import {
  CASE_PANEL_STALE_MS,
  hasUnread,
  useCaseFiles,
  useCaseMessages,
  useCaseNotes,
} from "./screening/case-tab-data";
import { useCaseTasks } from "./screening/useCaseTasks";

export type CaseTab = "oversigt" | "noter" | "beskeder" | "filer";
export type { ScreeningFocus };

/** Page frame (Case Screening v5: max 1120, padding 36 44 72, gap 32). */
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-w-[1120px] flex-col gap-8 px-4 pt-7 pb-[72px] md:px-11 md:pt-9">
      {children}
    </div>
  );
}

export function ScreeningCaseView({
  model,
  fundId,
  top,
  notices,
  identity,
  tab,
  onTab,
  focus,
  onFocus,
  onRetry,
  stoppedAtLimit = false,
  onContinue,
  canEditLimits = false,
  retrying = false,
}: {
  model: CaseViewModel;
  fundId: string;
  /** CaseTop: phase switcher, status chip and split button. */
  top: ReactNode;
  notices?: ReactNode;
  /** "Sådan fandt vi selskabet" (behind "Hvorfor?"). */
  identity?: ReactNode;
  tab: CaseTab;
  onTab: (tab: CaseTab) => void;
  focus: ScreeningFocus | null;
  /** `replace` swaps the history entry (a page that cannot be shown), so Back never loops. */
  onFocus: (focus: ScreeningFocus | null, options?: { replace?: boolean; back?: boolean }) => void;
  /** Starts the screening again (a stalled run, f); the server closes the old run. */
  onRetry?: (() => void) | undefined;
  /** The latest screening stopped at the team's price limit. */
  stoppedAtLimit?: boolean | undefined;
  /** "Fortsæt screeningen"; absent for a member who may not start analyses. */
  onContinue?: (() => void) | undefined;
  /** Admin and Lead: "Edit limits" in the stopped state. */
  canEditLimits?: boolean | undefined;
  /** "Prøv igen" is waiting for the server. */
  retrying?: boolean | undefined;
}) {
  const t = useT();
  const analysis = model.screening;
  const screeningActive = ["queued", "collecting_evidence", "screening_in_progress"].includes(
    model.executionStatus,
  );
  const header = <SimpleHeader top={top} companyName={model.companyName} meta={caseMeta(model)} />;
  if (!analysis && screeningActive) {
    return (
      <Page>
        {header}
        {notices}
        <ScreeningProgress companyName={model.companyName} />
      </Page>
    );
  }
  if (analysis && analysis.status === "failed" && stoppedAtLimit) {
    return (
      <Page>
        {header}
        {notices}
        <PriceLimitStopped
          kind="screening"
          onContinue={onContinue}
          continuing={retrying}
          canEditLimits={canEditLimits}
        />
      </Page>
    );
  }
  if (analysis && ["failed", "cancelled"].includes(analysis.status)) {
    return (
      <Page>
        {header}
        {notices}
        <StateBox title={t("screening.view.failedTitle")}>
          {t("screening.view.failedBody")}
        </StateBox>
      </Page>
    );
  }
  if (analysis && !["complete", "awaiting_approval"].includes(analysis.status)) {
    return (
      <Page>
        {header}
        {notices}
        <ScreeningProgress
          companyName={model.companyName}
          analysis={analysis}
          onRetry={onRetry}
          retrying={retrying}
        />
      </Page>
    );
  }
  if (!analysis) {
    return (
      <Page>
        {header}
        {notices}
        <StateBox title={t("screening.view.awaitingTitle")}>
          {t("screening.view.awaitingBody")}
        </StateBox>
      </Page>
    );
  }
  return (
    <ScreenedCase
      model={model}
      analysis={analysis}
      fundId={fundId}
      top={top}
      notices={notices}
      identity={identity}
      tab={tab}
      onTab={onTab}
      focus={focus}
      onFocus={onFocus}
    />
  );
}

function ScreenedCase({
  model,
  analysis,
  fundId,
  top,
  notices,
  identity,
  tab,
  onTab,
  focus,
  onFocus,
}: {
  model: CaseViewModel;
  analysis: NonNullable<CaseViewModel["screening"]>;
  fundId: string;
  top: ReactNode;
  notices?: ReactNode;
  identity?: ReactNode;
  tab: CaseTab;
  onTab: (tab: CaseTab) => void;
  focus: ScreeningFocus | null;
  onFocus: (focus: ScreeningFocus | null, options?: { replace?: boolean; back?: boolean }) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const access = useMyAccess(fundId);
  const capabilities = access.data?.capabilities;
  const tasks = useCaseTasks({
    fundId,
    caseId: model.id,
    gates: analysis.gates,
    criteria: analysis.criteria,
    capabilities,
  });
  const notes = useCaseNotes(fundId, model.id);
  const messages = useCaseMessages(fundId, model.id);
  const files = useCaseFiles(fundId, model.id);
  const loadFinancials = useServerFn(listFinancialStatements);
  const financials = useQuery({
    queryKey: ["financial-statements", model.id, language],
    queryFn: () => loadFinancials({ data: { fundId, caseId: model.id } }),
    staleTime: CASE_PANEL_STALE_MS,
  });

  const rows = profileRows(analysis.criteria);
  const columns = findingColumns({
    keyFindings: analysis.keyFindings,
    criteria: analysis.criteria,
    strengths: analysis.strengths.map((statement) => statement.statement),
    weaknesses: analysis.weaknesses
      .filter((statement) => !statement.meta.startsWith(t("screening.model.riskWord")))
      .map((statement) => statement.statement),
  });
  const balance = findingBalance(columns);
  const finance = financeSummary(financials.data?.metrics, language);
  const recommendation = recommendationLine(analysis.recommendation, language);
  const newAnswerKeys = new Set(
    tasks.raw
      .filter((task) => task.newAnswer && task.linkedKind === "criterion" && task.linkedKey)
      .map((task) => task.linkedKey!),
  );
  const unread = tab !== "beskeder" && hasUnread(messages.data, model.id);
  // A focus page that cannot be shown (Finanser without reports, or reports that failed to load)
  // falls back to the case.
  const hasFinance = finance !== null;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  useEffect(() => {
    if (focus === "finans" && (financials.isError || (financials.isSuccess && !hasFinance)))
      onFocusRef.current(null, { replace: true });
  }, [focus, financials.isSuccess, financials.isError, hasFinance]);

  // Replaces the focus entry, so the browser Back button never returns to the page just left.
  const back = () => onFocus(null, { back: true });
  const focusPage =
    focus === "profil" ? (
      <ProfileFocus
        companyName={model.companyName}
        onBack={back}
        onEvidence={() => onFocus("hvorfor")}
        rows={rows}
        criteria={analysis.criteria}
        threshold={model.threshold}
        profileVersion={
          analysis.setupVersion == null ? model.profileVersion : `v${analysis.setupVersion}`
        }
        fitText={fitSummary(rows, model.threshold, language)}
        newAnswerKeys={newAnswerKeys}
      />
    ) : focus === "mandat" ? (
      <MandatFocus
        companyName={model.companyName}
        onBack={back}
        gates={analysis.gates}
        tasks={tasks.raw}
        canManage={tasks.canManage}
        canOverride={tasks.canOverride}
        onAnswer={(gate, task, draft) => tasks.answerGate(gate, task, { kind: "gate", ...draft })}
      />
    ) : focus === "fund" ? (
      <FindingsFocus
        companyName={model.companyName}
        onBack={back}
        columns={columns}
        balance={balance}
      />
    ) : focus === "finans" && finance ? (
      <FinanceFocus companyName={model.companyName} onBack={back} finance={finance} />
    ) : focus === "hvorfor" ? (
      <WhyFocus
        model={model}
        analysis={analysis}
        recommendation={recommendation}
        identity={identity}
        onBack={back}
      />
    ) : null;

  const counted = (label: string, count: number | undefined, dot = false) => (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {/* The same on all three tabs, and only above 0 (as the prototype). */}
      {count !== undefined && count > 0 && <span className="text-micro text-ink-4">{count}</span>}
      {dot && (
        <span
          className="size-1.5 rounded-full bg-action"
          aria-label={t("screening.tabs.newMessages")}
        />
      )}
    </span>
  );

  return (
    <FocusHost focus={focusPage}>
      <Page>
        <ScreeningHero
          top={top}
          companyName={model.companyName}
          meta={caseMeta(model)}
          summary={analysis.overallAssessment ?? null}
          profileSections={companyProfileSections(analysis.companyProfile, language)}
          recommendation={recommendation}
          onWhy={() => onFocus("hvorfor")}
          score={analysis.score}
          threshold={model.threshold}
          recalculating={tasks.recalculating}
        />
        {notices}
        <motion.div
          className="-mb-1.5 max-w-full self-start"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? REDUCED_FADE : { duration: 0.6, ease: EASE.out, delay: 0.12 }}
        >
          <SegmentedControl<CaseTab>
            aria-label={t("screening.tabs.label")}
            value={tab}
            onChange={onTab}
            className="*:justify-center md:*:min-w-28"
            options={[
              { value: "oversigt", label: t("screening.tabs.overview") },
              { value: "noter", label: counted(t("screening.tabs.notes"), notes.data?.length) },
              {
                value: "beskeder",
                label: counted(
                  t("screening.tabs.messages"),
                  messages.data?.filter((message) => message.kind === "user").length,
                  unread,
                ),
              },
              { value: "filer", label: counted(t("screening.tabs.files"), files.data?.length) },
            ]}
          />
        </motion.div>
        <motion.div
          key={tab}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? REDUCED_FADE : { duration: 0.48, ease: EASE.out }}
        >
          {tab === "oversigt" && (
            <div className="flex flex-col gap-8">
              <ScreeningModules
                profile={rows}
                gates={analysis.gates.map((gate) => ({
                  key: gate.key,
                  label: gate.label,
                  status:
                    gate.passed === true ? "passed" : gate.passed === false ? "failed" : "unknown",
                }))}
                findings={{
                  up: columns.up.length,
                  down: columns.down.length,
                  upWeight: balance.up,
                  downWeight: balance.down,
                }}
                finance={finance}
                onOpen={onFocus}
              />
              {tasks.isLoading ? (
                <LoadingState title={t("screening.view.tasksLoading")} />
              ) : tasks.isError ? (
                <ErrorState
                  title={t("screening.view.tasksError")}
                  onRetry={() => void tasks.refetch()}
                />
              ) : (
                <TaskList
                  tasks={tasks.items}
                  people={tasks.people}
                  links={tasks.links}
                  dueChoices={defaultDueChoices(new Date(), language)}
                  {...tasks.listProps}
                />
              )}
            </div>
          )}
          {tab === "noter" && <NotesTab fundId={fundId} caseId={model.id} />}
          {tab === "beskeder" && (
            <MessagesTab fundId={fundId} caseId={model.id} messages={messages} />
          )}
          {tab === "filer" && (
            <FilesTab
              fundId={fundId}
              caseId={model.id}
              files={files}
              tasks={tasks.items}
              canUpload={capabilities?.includes("upload_document") ?? false}
            />
          )}
        </motion.div>
      </Page>
    </FocusHost>
  );
}

export function SimpleHeader({
  top,
  companyName,
  meta,
}: {
  top: ReactNode;
  companyName: string;
  meta: string;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      {top}
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <h1 className="m-0 text-[34px] leading-[1.05] font-semibold tracking-display md:text-[44px]">
          {companyName}
        </h1>
        {meta && <span className="text-[15px] text-ink-3">{meta}</span>}
      </div>
    </div>
  );
}

export function StateBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex max-w-[720px] flex-col gap-2 rounded-xl bg-canvas px-6 py-6">
      <h2 className="m-0 text-section font-semibold">{title}</h2>
      <p className="m-0 text-body leading-[1.6] text-ink-2">{children}</p>
    </section>
  );
}

function ScreeningProgress({
  companyName,
  analysis,
  onRetry,
  retrying = false,
}: {
  companyName: string;
  analysis?: NonNullable<CaseViewModel["screening"]>;
  onRetry?: (() => void) | undefined;
  retrying?: boolean | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const now = useNow();
  if (analysis && runStalled(analysis, now)) {
    const retryable = screeningRetryable(analysis, now) && Boolean(onRetry);
    return (
      <RunStalled
        title={t("caseView.stalled.screeningTitle")}
        body={t(
          retryable ? "caseView.stalled.screeningBody" : "caseView.stalled.screeningWaitBody",
        )}
        action={
          retryable ? (
            <Button variant="primary" size="md" disabled={retrying} onClick={onRetry}>
              {retrying ? (
                <PendingLabel tone="ai" onDark>
                  {t("caseView.stalled.retry")}
                </PendingLabel>
              ) : (
                t("caseView.stalled.retry")
              )}
            </Button>
          ) : null
        }
      />
    );
  }
  const steps = analysis?.steps ?? [];
  const current =
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "queued");
  const currentLabel = current ? runStepName(current.key, language) : t("screening.view.preparing");
  const orbState: OrbState = current ? runStepOrb(current.key) : "breathing";
  return (
    <AiBeam active>
      <section className="grid min-h-[380px] place-items-center rounded-xl bg-canvas px-6 py-10 text-center">
        <div className="w-full max-w-xl">
          <span className="mx-auto grid size-[76px] place-items-center rounded-full bg-surface">
            <AiOrb size={64} state={orbState} tone="ai" />
          </span>
          <h2 className="mt-5 mb-0 text-title font-semibold tracking-title">
            {t("screening.view.screeningNow", { company: companyName })}
          </h2>
          <p className="mt-2 mb-0 text-list text-ink-2">{currentLabel}</p>
          {steps.length > 0 && (
            <RunSteps
              steps={[...steps].sort((a, b) => a.order - b.order)}
              className="mx-auto mt-7 max-w-sm text-left"
            />
          )}
        </div>
      </section>
    </AiBeam>
  );
}
