/**
 * The deep analysis of a case (Case Dyb analyse v5; ticket, batch 1). The top is the case
 * top (phase switcher, status chip, split button) with "Komitérapport"; under the
 * title a sticky bar with the tabs Konklusion, one per specialist, Økonomi and Risici on the
 * left and Noter, Beskeder and Filer on the right ('s tabs, reused). Konklusion holds the
 * score with the change since screening, the bridge, one card per tab and "Skal afklares";
 * a specialist tab holds the gauge, what pulls up and down and "Kriterierne mod tesen".
 * "Hvorfor?" holds what the surface no longer shows (sources, data trust, the score's path,
 * the research log, the run).
 *
 * The analysis tab is `spor=` in the URL, the side tab `fane=` and the sub-page `fokus=`, so
 * Back and a shared link work (gap/ choice 4). Everything is real data: the run, the
 * fund's own criteria grouped by the fund's specialist modules, the team's tasks, notes,
 * messages (live) and files. The queue states (not started, running, failed) are unchanged.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight, CircleAlert, Clock, FileDown } from "lucide-react";
import { AiBeam } from "@/components/ai/AiBeam";
import { AiOrb, PendingLabel } from "@/components/ai/AiOrb";
import { RunSteps } from "@/components/ai/RunSteps";
import { Button } from "@/components/ds/Button";
import { RunStalled } from "@/components/cases/RunStalled";
import { deepRunReleasable, runStalled } from "@/lib/cases/run-stall";
import { useNow } from "@/lib/ui/use-now";
import { FocusHost, FocusPage, GrowFromCard } from "@/components/ds/FocusPage";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { TaskList } from "@/components/ds/TaskList";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { defaultDueChoices, type TaskPrefill } from "@/components/ds/task-types";
import { WORKSPACE_ID } from "@/components/ds/AppShell";
import { Link } from "@tanstack/react-router";
import { useMyAccess } from "@/lib/auth/useMyAccess";
import { useBrainCapabilities } from "@/lib/brain/useBrainCapabilities";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { specialistCatalog } from "@/lib/analysis/specialist-catalog";
import { listFinancialStatements } from "@/lib/cases/financials.functions";
import { financeSummary } from "@/lib/cases/finance-summary";
import {
  ANALYSIS_FOCUS_PREFIX,
  CONCLUSION_TAB,
  ECONOMY_TAB,
  RISKS_TAB,
  analysisFocusKey,
  categoryLabels,
  deepBasis,
  deepTabs,
  earlierBasisScreening,
  economyFocusAvailable,
  isEconomyFocus,
  resolveTab,
  scoreBridge,
  sortRisks,
  specialistGroups,
  specialistTopics,
  type SpecialistGroup,
} from "@/lib/cases/deep-view";
import { splitConclusion } from "@/lib/cases/card-fallback";
import { shortConclusion } from "@/lib/cases/presentation";
import { runStepName, runStepOrb } from "@/lib/cases/run-steps";
import type { AnalysisView, CaseViewModel } from "@/lib/cases/view-model";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { DeepCards } from "./deep/DeepCards";
import type { CardFillRequest } from "./deep/CardMissing";
import { DeepLinks, deepHref } from "./deep/deep-links";
import { DeepHero } from "./deep/DeepHero";
import { DeepWhyFocus } from "./deep/DeepWhyFocus";
import { AnalysisFocus, type AnalysisCard } from "./deep/Analyses";
import { dataTopics } from "@/lib/cases/analysis-data";
import { EconomyFocus } from "./deep/EconomyFocus";
import { SpecialistBot } from "@/components/ai/SpecialistBot";
import { EconomyTab } from "./deep/EconomyTab";
import { RisksTab } from "./deep/RisksTab";
import { SpecialistTab } from "./deep/SpecialistTab";
import { caseMeta } from "@/lib/cases/case-meta";
import { Page, type CaseTab } from "./ScreeningCaseView";
import { FilesTab, MessagesTab, NotesTab } from "./screening/CaseTabs";
import {
  CASE_PANEL_STALE_MS,
  hasUnread,
  useCaseFiles,
  useCaseMessages,
  useCaseNotes,
} from "./screening/case-tab-data";
import { useCaseTasks } from "./screening/useCaseTasks";

/**
 * The deep analysis's sub-page from `fokus=` (validated by `parseDeepFocus`): "hvorfor", one of
 * the Økonomi pages or `analyse-<category>` for a specialist's analysis. The page drops one that
 * has nothing to show.
 */
export type DeepFocus = string;

export function DeepCaseView({
  model,
  fundId,
  top,
  notices,
  retryAction,
  onReload,
  onRetry,
  retrying = false,
  spor,
  onSpor,
  tab,
  onTab,
  focus,
  onFocus,
}: {
  model: CaseViewModel;
  fundId: string;
  /** CaseTop: phase switcher, status chip and split button. */
  top: ReactNode;
  notices?: ReactNode;
  retryAction?: ReactNode;
  /** Fetches the case again (the stalled state, f). */
  onReload?: (() => void) | undefined;
  /** Starts the deep analysis again once the server would release the stalled run. */
  onRetry?: (() => void) | undefined;
  retrying?: boolean | undefined;
  /** The analysis tab from `spor=` (undefined: Konklusion). */
  spor: string | undefined;
  /** Choosing an analysis tab also leaves Noter, Beskeder and Filer. */
  onSpor: (spor: string | undefined, options?: { replace?: boolean }) => void;
  /** "oversigt" is the analysis tab; the others are's Noter, Beskeder and Filer. */
  tab: CaseTab;
  onTab: (tab: CaseTab) => void;
  focus: DeepFocus | null;
  onFocus: (focus: DeepFocus | null, options?: { replace?: boolean; back?: boolean }) => void;
}) {
  const t = useT();
  const deep = model.deep;
  const header = <DeepHeader top={top} model={model} />;
  if (!deep) {
    return (
      <Page>
        {header}
        {notices}
        <section className="grid min-h-[320px] place-items-center rounded-xl bg-canvas p-6 text-center">
          <div className="max-w-md">
            <span className="mx-auto grid size-[76px] place-items-center rounded-full bg-surface">
              <AiOrb size={64} state="breathing" tone="ai" />
            </span>
            <h2 className="mt-4 mb-0 text-section font-semibold text-ink-1">
              {t("deep.view.startingTitle")}
            </h2>
            <p className="mt-2 mb-0 text-list leading-5 text-ink-2">
              {t("deep.view.startingBody")}
            </p>
          </div>
        </section>
      </Page>
    );
  }
  // A cancelled run is a stopped run: same retry state as a failed one (never "i gang" forever).
  if (deep.status === "failed" || deep.status === "cancelled") {
    return (
      <Page>
        {header}
        {notices}
        <section className="grid min-h-[320px] place-items-center rounded-xl bg-canvas p-6 text-center">
          <div className="max-w-lg">
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-critical/10 text-critical">
              <CircleAlert className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 mb-0 text-section font-semibold text-ink-1">
              {t("deep.view.failedTitle")}
            </h2>
            <p className="mt-2 mb-0 text-list leading-5 text-ink-2">{t("deep.view.failedBody")}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">{retryAction}</div>
          </div>
        </section>
      </Page>
    );
  }
  if (deep.status !== "complete" && !["queued", "running"].includes(deep.status)) {
    // An unknown status is never shown as progress either.
    return (
      <Page>
        {header}
        {notices}
        <section className="grid min-h-[320px] place-items-center rounded-xl bg-canvas p-6 text-center">
          <div className="max-w-lg">
            <h2 className="mt-4 mb-0 text-section font-semibold text-ink-1">
              {t("deep.view.unavailableTitle")}
            </h2>
            <div className="mt-5 flex flex-wrap justify-center gap-2">{retryAction}</div>
          </div>
        </section>
      </Page>
    );
  }
  if (deep.status !== "complete") {
    return (
      <Page>
        {header}
        {notices}
        <AnalysisProgress
          model={model}
          analysis={deep}
          onReload={onReload}
          onRetry={onRetry}
          retrying={retrying}
        />
      </Page>
    );
  }
  return (
    <CompleteDeep
      model={model}
      deep={deep}
      fundId={fundId}
      header={header}
      notices={notices}
      spor={spor}
      onSpor={onSpor}
      tab={tab}
      onTab={onTab}
      focus={focus}
      onFocus={onFocus}
    />
  );
}

/** Case top, breadcrumb, name and "Komitérapport" (Case Dyb analyse v5, lines 34–43). */
function DeepHeader({ top, model }: { top: ReactNode; model: CaseViewModel }) {
  const t = useT();
  const meta = caseMeta(model);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        {top}
        <div className="flex-1" />
        <a
          href={`/cases/${model.id}?view=komite`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-pill px-3.5 text-list font-medium whitespace-nowrap text-ink-2 outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover hover:no-underline focus-visible:ring-2 focus-visible:ring-action"
        >
          <FileDown className="size-4" strokeWidth={1.75} aria-hidden />
          {t("deep.view.committeeReport")}
        </a>
      </div>
      <nav
        aria-label={t("deep.view.breadcrumb")}
        className="flex items-center gap-2 text-meta whitespace-nowrap text-ink-4"
      >
        <Link to="/cases" className="text-ink-4 hover:text-ink-1 hover:no-underline">
          {t("deep.view.cases")}
        </Link>
        <ChevronRight className="size-[11px]" strokeWidth={1.75} aria-hidden />
        <span>{t("deep.view.deepAnalysis")}</span>
      </nav>
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <h1 className="m-0 text-[34px] leading-[1.05] font-semibold tracking-display [overflow-wrap:anywhere] md:text-[44px]">
          {model.companyName}
        </h1>
        {meta && <span className="min-w-0 text-[15px] text-ink-3">{meta}</span>}
      </div>
    </div>
  );
}

function CompleteDeep({
  model,
  deep,
  fundId,
  header,
  notices,
  spor,
  onSpor,
  tab,
  onTab,
  focus,
  onFocus,
}: {
  model: CaseViewModel;
  deep: AnalysisView;
  fundId: string;
  header: ReactNode;
  notices?: ReactNode;
  spor: string | undefined;
  onSpor: (spor: string | undefined, options?: { replace?: boolean }) => void;
  tab: CaseTab;
  onTab: (tab: CaseTab) => void;
  focus: DeepFocus | null;
  onFocus: (focus: DeepFocus | null, options?: { replace?: boolean; back?: boolean }) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const access = useMyAccess(fundId);
  const capabilities = access.data?.capabilities;
  const brain = useBrainCapabilities();
  const screening = model.screening;
  // The change "since screening" only means something against the screening the analysis was
  // built on. When a newer screening has come since, it is shown against the analysis's own
  // (loaded by the server), or not at all if that one could not be read; the page says
  // which analysis this is.
  const earlierBasis = earlierBasisScreening(deep, model.basisScreenings);
  const basis = deepBasis(
    {
      deepStartedAt: deep.startedAt,
      deepCompletedAt: deep.completedAt,
      screeningStartedAt: screening?.startedAt ?? null,
      screeningId: screening?.id ?? null,
      basisScreeningId: deep.basisScreeningId,
      basisScreeningLoaded: earlierBasis !== null,
      history: model.history,
    },
    language,
  );
  const comparable = basis.screeningIsNewer ? earlierBasis : screening;
  // "Skal afklares" is the case's one list, the same as in the screening (its gates and criteria).
  const tasks = useCaseTasks({
    fundId,
    caseId: model.id,
    gates: screening?.gates ?? [],
    criteria: screening?.criteria ?? [],
    capabilities,
  });
  // "Udfyld" on a card opens "Ny opgave" in that list with the gap filled in. The request
  // is cleared once the list has opened it. Not offered while the list shows its error state.
  const [taskPrefill, setTaskPrefill] = useState<TaskPrefill | null>(null);
  const fillRequests = useRef(0);
  const onFill =
    tasks.canManage && !tasks.isError
      ? (request: CardFillRequest) => {
          fillRequests.current += 1;
          setTaskPrefill({
            id: fillRequests.current,
            title: request.title,
            description: request.description,
            kind: "research",
            link:
              tasks.links.find(
                (link) => link.kind === "criterion" && link.key === request.criterionKey,
              ) ?? null,
          });
        }
      : undefined;
  const notes = useCaseNotes(fundId, model.id);
  const messages = useCaseMessages(fundId, model.id);
  const files = useCaseFiles(fundId, model.id);
  const loadFinancials = useServerFn(listFinancialStatements);
  const financials = useQuery({
    queryKey: ["financial-statements", model.id, language],
    queryFn: () => loadFinancials({ data: { fundId, caseId: model.id } }),
    staleTime: CASE_PANEL_STALE_MS,
  });

  const groups = useMemo(
    () =>
      specialistGroups(
        deep.criteria,
        comparable?.criteria ?? [],
        deep.specialistSet ?? specialistCatalog,
        deep.specialists ?? [],
        language,
      ),
    [deep.criteria, deep.specialists, deep.specialistSet, comparable?.criteria, language],
  );
  const risks = useMemo(() => sortRisks(deep.risks), [deep.risks]);
  const finance = financeSummary(financials.data?.metrics, language);
  const settled = financials.isSuccess || financials.isError;
  // A link to Økonomi (`spor=okonomi`) waits for the reports instead of falling back, and when
  // they cannot be loaded it stays on Økonomi with a retry instead of silently changing page.
  const economyAsked = spor === ECONOMY_TAB && (!settled || financials.isError);
  const tabs = deepTabs(
    groups,
    // Økonomi always shows, as in the prototype: without annual reports or
    // figures the code could calculate, the card and the tab say so instead of disappearing.
    { economy: true, risks: risks.length > 0 },
    language,
  );
  const active = economyAsked ? ECONOMY_TAB : resolveTab(tabs, spor);
  const activeTab = tabs.find((entry) => entry.key === active);

  // A tab that does not exist on this case is dropped from the URL (replace, so Back is clean).
  const onSporRef = useRef(onSpor);
  onSporRef.current = onSpor;
  useEffect(() => {
    if (spor && settled && !economyAsked && !tabs.some((entry) => entry.key === spor)) {
      onSporRef.current(undefined, { replace: true });
    }
  }, [spor, settled, economyAsked, tabs]);

  // A new analysis tab opens at the top of the work area.
  const previousTab = useRef(active);
  useEffect(() => {
    if (previousTab.current === active) return;
    previousTab.current = active;
    const area = document.getElementById(WORKSPACE_ID);
    const scroller: { scrollTop: number } | null =
      area && area.scrollHeight > area.clientHeight ? area : document.scrollingElement;
    if (scroller) scroller.scrollTop = 0;
  }, [active]);

  const unread = tab !== "beskeder" && hasUnread(messages.data, model.id);
  const back = () => onFocus(null, { back: true });
  const recommendation = deep.recommendation
    ? t("deep.view.recommendation", {
        label: t(`deep.recommendationLabel.${deep.recommendation}`),
      })
    : null;
  // About two lines on top; the rest of the assessment folds out under "Læs mere".
  const conclusionParts = deep.overallAssessment ? splitConclusion(deep.overallAssessment) : null;
  const conclusion = conclusionParts
    ? conclusionParts.lead
    : shortConclusion(
        deep.rationale,
        t("deep.view.conclusionFallback", { company: model.companyName }),
      );
  const bridge = scoreBridge(
    {
      screeningScore: comparable?.score ?? null,
      deepScore: deep.score,
      groups,
    },
    language,
  );

  // "Analyserne": each specialist's sourced data, then the categories it has findings
  // in (none without findings).
  const cardsByGroup = useMemo(
    () =>
      new Map<string, AnalysisCard[]>(
        groups.map((group) => [
          group.id,
          [
            ...dataTopics(group.id, deep.cardData, language).map((topic): AnalysisCard => ({
              kind: "data",
              topic,
            })),
            ...specialistTopics(
              deep.findings ?? [],
              group.categories,
              categoryLabels(language),
            ).map((topic): AnalysisCard => ({ kind: "findings", topic })),
          ],
        ]),
      ),
    [groups, deep.findings, deep.cardData, language],
  );
  const now = useNow();
  const report = financials.data?.metrics;

  // The sub-page the URL asks for. One that has nothing to show on this case is dropped
  // (replace, so Back is clean); an Økonomi page waits until the reports have loaded.
  let focusPage: ReactNode = null;
  let analysisPage: ReactNode = null;
  let focusPending = false;
  if (focus === "hvorfor") {
    focusPage = (
      <DeepWhyFocus model={model} analysis={deep} recommendation={recommendation} onBack={back} />
    );
  } else if (focus?.startsWith(ANALYSIS_FOCUS_PREFIX)) {
    // An analysis's sub-page stands inside the case under its specialist's tab, not over
    // the page; on any other tab or side tab it is not shown, so the URL drops it.
    const group = groups.find((entry) => entry.id === active);
    const card =
      tab === "oversigt" && group
        ? (cardsByGroup.get(group.id) ?? []).find(
            (entry) => analysisFocusKey(entry.topic.key) === focus,
          )
        : undefined;
    const found = group && card ? { group, card } : null;
    if (found) {
      analysisPage = (
        <AnalysisFocus
          group={found.group}
          card={found.card}
          backLabel={found.group.label}
          onBack={back}
        />
      );
    }
  } else if (focus && isEconomyFocus(focus)) {
    if (!settled) focusPending = true;
    else if (financials.isError) {
      focusPage = (
        <FocusPage backLabel={model.companyName} onBack={back} title={t("deep.view.economy")}>
          <ErrorState
            title={t("deep.view.financialsErrorTitle")}
            body={t("deep.view.financialsErrorBody")}
            onRetry={() => void financials.refetch()}
          />
        </FocusPage>
      );
    } else if (economyFocusAvailable(focus, report, deep.calculations)) {
      focusPage = (
        <EconomyFocus
          kind={focus}
          model={model}
          analysis={deep}
          fundId={fundId}
          report={report}
          reportingClass={financials.data?.statements[0]?.reportingClassText ?? null}
          now={now}
          onBack={back}
        />
      );
    }
  }
  const focusInvalid =
    Boolean(focus) && focusPage === null && analysisPage === null && !focusPending;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  useEffect(() => {
    if (focusInvalid) onFocusRef.current(null, { replace: true });
  }, [focusInvalid]);

  // The tab remounts when an analysis's sub-page closes, so the card that opened it is a new
  // element: remember its key and let the tab give focus back to it.
  const [closedAnalysis, setClosedAnalysis] = useState<string | null>(null);
  const openAnalysis = analysisPage && focus ? focus.slice(ANALYSIS_FOCUS_PREFIX.length) : null;
  const lastAnalysis = useRef<string | null>(null);
  useEffect(() => {
    if (openAnalysis) {
      lastAnalysis.current = openAnalysis;
      setClosedAnalysis(null);
    } else if (lastAnalysis.current) {
      setClosedAnalysis(lastAnalysis.current);
      lastAnalysis.current = null;
    }
  }, [openAnalysis]);

  const counted = (label: string, count: number | undefined, dot = false) => (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {/* The same on all three tabs, and only above 0 (as the prototype). */}
      {count !== undefined && count > 0 && <span className="text-micro text-ink-4">{count}</span>}
      {dot && (
        <span className="size-1.5 rounded-full bg-action" aria-label={t("deep.view.newMessages")} />
      )}
    </span>
  );

  return (
    <DeepLinks.Provider
      value={(target) => deepHref(model.id, active === CONCLUSION_TAB ? undefined : active, target)}
    >
      <FocusHost focus={focusPage}>
        <Page>
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? REDUCED_FADE : { duration: 0.56, ease: EASE.out }}
          >
            {header}
          </motion.div>
          {notices}
          <motion.div
            className="sticky top-0 z-[3] -mx-4 -mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 bg-[color-mix(in_srgb,var(--bg-surface)_88%,transparent)] px-4 py-2.5 backdrop-blur-[14px] md:-mx-11 md:px-11"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? REDUCED_FADE : { duration: 0.6, ease: EASE.out, delay: 0.12 }}
          >
            <SegmentedControl<string>
              aria-label={t("deep.view.tabsLabel")}
              tabs={{ idPrefix: "deep-tabs" }}
              // Switching a tab replaces the navigation entry on purpose (the route's setSpor):
              // tabs are views of one page, so Back leaves the analysis instead of stepping
              // through every tab the reader looked at.
              value={tab === "oversigt" ? active : ""}
              onChange={(key) => onSpor(key === CONCLUSION_TAB ? undefined : key)}
              options={tabs.map((entry) => ({
                value: entry.key,
                label: entry.label,
                ...(entry.figure
                  ? { icon: <SpecialistBot kind={entry.figure} size={18} /> }
                  : entry.color
                    ? { dot: entry.color }
                    : {}),
              }))}
            />
            <div className="flex-1" />
            <SegmentedControl<CaseTab>
              aria-label={t("deep.view.sideTabsLabel")}
              size="sm"
              value={tab === "oversigt" ? ("" as CaseTab) : tab}
              onChange={onTab}
              options={[
                { value: "noter", label: counted(t("deep.view.notes"), notes.data?.length) },
                {
                  value: "beskeder",
                  label: counted(
                    t("deep.view.messages"),
                    messages.data?.filter((message) => message.kind === "user").length,
                    unread,
                  ),
                },
                { value: "filer", label: counted(t("deep.view.files"), files.data?.length) },
              ]}
            />
          </motion.div>
          {basis.note && (
            <p className="m-0 -mt-2 flex items-center gap-2 px-1.5 text-meta leading-4 text-ink-3">
              <Clock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {basis.note}
            </p>
          )}
          <motion.div
            key={`${tab}:${tab === "oversigt" ? active : ""}:${analysisPage ? focus : ""}`}
            {...(tab === "oversigt"
              ? {
                  role: "tabpanel",
                  id: "deep-tabs-panel",
                  tabIndex: 0,
                  "aria-labelledby": `deep-tabs-tab-${active}`,
                }
              : {})}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? REDUCED_FADE : { duration: 0.48, ease: EASE.out }}
          >
            {tab === "oversigt" && analysisPage && <GrowFromCard>{analysisPage}</GrowFromCard>}
            {tab === "oversigt" && !analysisPage && active === CONCLUSION_TAB && (
              <div className="flex flex-col gap-3.5">
                <DeepHero
                  score={deep.score}
                  screeningScore={comparable?.score ?? null}
                  threshold={model.threshold}
                  conclusion={conclusion}
                  conclusionMore={conclusionParts?.rest ?? null}
                  recommendation={recommendation}
                  onWhy={() => onFocus("hvorfor")}
                  counterThesis={deep.counterThesis ?? deep.contraryCase ?? null}
                  bridge={bridge}
                  onOpenStep={(key) => onSpor(key)}
                />
                <DeepCards
                  fundId={fundId}
                  caseId={model.id}
                  companyName={model.companyName}
                  groups={groups}
                  findings={deep.findings ?? []}
                  finance={finance}
                  risks={risks}
                  cardData={deep.cardData ?? null}
                  onOpen={(key) => onSpor(key)}
                  onFill={onFill}
                />
                {tasks.isLoading ? (
                  <LoadingState title={t("deep.view.tasksLoading")} />
                ) : tasks.isError ? (
                  <ErrorState
                    title={t("deep.view.tasksError")}
                    onRetry={() => void tasks.refetch()}
                  />
                ) : (
                  <TaskList
                    tasks={tasks.items}
                    people={tasks.people}
                    links={tasks.links}
                    dueChoices={defaultDueChoices(new Date(), language)}
                    note={t("deep.view.tasksNote")}
                    prefill={taskPrefill}
                    onPrefillOpened={() => setTaskPrefill(null)}
                    {...tasks.listProps}
                  />
                )}
              </div>
            )}
            {tab === "oversigt" && !analysisPage && activeTab?.kind === "specialist" && (
              <SpecialistTab
                group={groups.find((group) => group.id === active)!}
                cards={cardsByGroup.get(active) ?? []}
                returnTo={closedAnalysis}
                onTopic={(category) => onFocus(analysisFocusKey(category))}
                onEvidence={() => onFocus("hvorfor")}
              />
            )}
            {tab === "oversigt" && active === ECONOMY_TAB && financials.isError && (
              <ErrorState
                title={t("deep.view.financialsErrorTitle")}
                body={t("deep.view.financialsErrorBody")}
                onRetry={() => void financials.refetch()}
              />
            )}
            {tab === "oversigt" && active === ECONOMY_TAB && !settled && (
              <LoadingState title={t("deep.view.financialsLoading")} />
            )}
            {tab === "oversigt" && active === ECONOMY_TAB && financials.isSuccess && (
              <EconomyTab
                fundId={fundId}
                caseId={model.id}
                manualInputs={financials.data?.manualInputs}
                inputCurrency={financials.data?.inputCurrency}
                canEnter={capabilities?.includes("correct_evidence") ?? false}
                canFind={
                  (capabilities?.includes("correct_evidence") ?? false) &&
                  (brain.data?.enabled ?? false)
                }
                statements={financials.data?.statements}
                inputsError={financials.data?.manualInputsError ?? false}
                hiddenInputCount={financials.data?.hiddenInputCount ?? 0}
                maxInputYear={financials.data?.maxInputYear}
                report={report}
                analysis={deep}
                statementCount={financials.data?.statements.length ?? 0}
                now={now}
                onFocus={(page) => onFocus(page)}
              />
            )}
            {tab === "oversigt" && active === RISKS_TAB && <RisksTab risks={risks} />}
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
    </DeepLinks.Provider>
  );
}

function AnalysisProgress({
  model,
  analysis,
  onReload,
  onRetry,
  retrying = false,
}: {
  model: CaseViewModel;
  analysis: AnalysisView;
  onReload?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  retrying?: boolean | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const now = useNow();
  if (runStalled(analysis, now)) {
    // Once the server would release the stalled run (a minute's margin for the clocks),
    // the run can be started again; before that the page offers a reload.
    const retryable = deepRunReleasable(analysis, now - 60_000) && Boolean(onRetry);
    return (
      <RunStalled
        title={t("caseView.stalled.deepTitle")}
        body={t(retryable ? "caseView.stalled.deepRetryBody" : "caseView.stalled.deepBody")}
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
          ) : onReload ? (
            <Button variant="secondary" size="md" onClick={onReload}>
              {t("caseView.stalled.reload")}
            </Button>
          ) : null
        }
      />
    );
  }
  const completed = analysis.steps.filter(
    (step) =>
      step.status === "complete" ||
      step.status === "skipped" ||
      // CVR er berigelse: et mislykket opslag stopper ikke analysen.
      (step.key === "cvr_financials" && step.status === "failed"),
  ).length;
  const current =
    analysis.steps.find((step) => step.status === "running") ??
    analysis.steps.find((step) => step.status === "queued");
  return (
    <AiBeam active>
      <section className="grid gap-5 rounded-xl bg-canvas p-7 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <span className="text-meta font-medium text-ai-ink">{t("deep.view.progressLabel")}</span>
          <h2 className="mt-4 mb-0 text-[32px] leading-[1.1] font-semibold tracking-display">
            {t("deep.view.progressTitle", { company: model.companyName })}
          </h2>
          <p className="mt-2 mb-0 max-w-[52ch] text-list leading-5 text-ink-2">
            {t("deep.view.progressBody")}
          </p>
          <div className="mt-7 flex items-center gap-5">
            <AiOrb size={64} state={current ? runStepOrb(current.key) : "breathing"} tone="ai" />
            <div className="min-w-0">
              <span className="text-meta tabular-nums text-ink-3">
                {t("deep.view.progressStep", {
                  current: Math.min(completed + 1, analysis.steps.length || 6),
                  total: analysis.steps.length || 6,
                })}
              </span>
              <strong className="mt-0.5 block text-section text-ink-1">
                {current ? runStepName(current.key, language) : t("deep.view.progressRegistering")}
              </strong>
            </div>
          </div>
        </div>
        <aside className="rounded-lg bg-surface px-4 py-3">
          <RunSteps steps={analysis.steps} />
        </aside>
      </section>
    </AiBeam>
  );
}
