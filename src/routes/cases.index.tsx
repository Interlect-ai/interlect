/**
 * Cases (prototype v4.dc.html, "Cases v4", "Cases: handling frem for status", "Handlinger v2"):
 * phase cards as filters, filter chips, the
 * table (Selskab, Fase, Score, Tasks, Status, Næste skridt), split buttons with all actions,
 * the bulk bar and "Fortryd". Only the active fund's cases; the server checks every action.
 */
import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleX,
  Factory,
  Gavel,
  Layers,
  MapPin,
  Plus,
  RotateCcw as RotateIcon,
  Search,
  Sparkles,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/ds/AppShell";
import { AiOrb } from "@/components/ai/AiOrb";
import { BulkBar } from "@/components/ds/BulkBar";
import { showToast } from "@/components/ds/Toast";
import { Menu, MenuCheckItem, MenuContent, MenuHeader, MenuTrigger } from "@/components/ds/Menu";
import { Reveal, RevealGroup } from "@/components/ds/Reveal";
import { SplitButton } from "@/components/ds/SplitButton";
import { StatusChip } from "@/components/ds/StatusChip";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { FirstCaseSteps } from "@/components/cases/FirstCaseSteps";
import { CaseActionMenuItems } from "@/components/cases/CaseActionMenu";
import { caseActionCopy } from "@/lib/cases/case-action-copy";
import { useCaseActions, type CaseTarget } from "@/components/cases/useCaseActions";
import { listCases, type CaseListItem } from "@/lib/cases/cases.functions";
import {
  bulkHighlight,
  menuGroups,
  primaryAction,
  statusChipKey,
  type CaseActionState,
} from "@/lib/cases/case-actions";
import {
  casePhaseLabelKey,
  caseStatusLabelKey,
  daysWithoutAction,
  needsNudge,
} from "@/lib/cases/lifecycle";
import type { CasePhase, CaseStatus } from "@/lib/cases/lifecycle";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { isServerRefusal } from "@/lib/errors/server-refusal";
import type { MessageKey, TranslateVars } from "@/lib/i18n/translate";
import { casePermissions, useMyAccess } from "@/lib/auth/useMyAccess";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import { useSession } from "@/lib/auth/useSession";
import { geographyText, sectorText, stageText } from "@/lib/funds/basis-labels";
import { translate } from "@/lib/i18n/translate";
import type { Language } from "@/lib/i18n/language";
import { formatWholeScore } from "@/lib/cases/screening-view";
import { userMessage } from "@/lib/errors/user-message";
import { EASE, REDUCED_FADE, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { BrainCardDialog, type CardSource } from "@/components/brain/BrainCard";
import { showBrain } from "@/lib/brain/capabilities";
import { useBrainCapabilities } from "@/lib/brain/useBrainCapabilities";
import { pageMeta } from "@/lib/i18n/page-head";

export const Route = createFileRoute("/cases/")({
  head: () => ({
    meta: [...pageMeta("cases"), { name: "robots", content: "noindex" }],
  }),
  component: CasesPage,
});

type StageKey = "all" | "screening" | "deep_analysis" | "committee" | "decided";
type SortKey = "score" | "tasks" | "name";

type Translate = (key: MessageKey, vars?: TranslateVars) => string;

/** Phase cards (Cases v4 ST): label and signal colour. */
const STAGES: { key: StageKey; label: MessageKey; color: string }[] = [
  { key: "all", label: "cases.list.allStages", color: "var(--ink-1)" },
  { key: "screening", label: "cases.phase.screening", color: "var(--action)" },
  { key: "deep_analysis", label: "cases.phase.deep_analysis", color: "var(--ai)" },
  { key: "committee", label: "cases.phase.committee", color: "var(--warning)" },
  { key: "decided", label: "cases.phase.decided", color: "var(--positive)" },
];

/** The phase column: a decided case shows its outcome (Investeret / Lukket). */
function phaseCell(
  phase: CasePhase,
  status: CaseStatus,
  t: Translate,
): { label: string; color: string } {
  if (phase === "decided") {
    return status === "invested"
      ? { label: t(caseStatusLabelKey.invested), color: "var(--positive)" }
      : { label: t(caseStatusLabelKey.closed), color: "var(--ink-4)" };
  }
  const color =
    phase === "screening"
      ? "var(--action)"
      : phase === "deep_analysis"
        ? "var(--ai)"
        : "var(--warning)";
  return { label: t(casePhaseLabelKey[phase]), color };
}

const RUNNING_STATUSES = new Set([
  "queued",
  "collecting_evidence",
  "screening_in_progress",
  "deep_analysis_in_progress",
  "quality_audit",
]);

const isRunning = (item: CaseListItem) =>
  item.activeRunKind !== null && RUNNING_STATUSES.has(item.executionStatus);

/** The score the row shows: the deep analysis once there is one, else the screening. */
function scoreOf(item: CaseListItem): number | null {
  if (item.hasDeepAnalysis && item.phase !== "screening" && item.fitScore !== null) {
    return item.fitScore;
  }
  return item.screeningScore ?? item.fitScore;
}

function hasScreening(item: CaseListItem) {
  return (
    item.screeningScore !== null ||
    item.screeningRecommendation !== null ||
    item.gateMarks !== null ||
    item.hasDeepAnalysis
  );
}

const stageWord = (stage: string, language: Language) => {
  const label =
    stage === "unknown" ? translate(language, "basis.stage.unknown") : stageText(stage, language);
  return label.charAt(0).toLocaleLowerCase(language) + label.slice(1);
};

function monogram(name: string) {
  return name
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word))
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase("da");
}

function actionState(item: CaseListItem): CaseActionState {
  return {
    phase: item.phase,
    status: item.status,
    hasScreening: hasScreening(item),
    canRunDeep: item.canRunDeep,
    hasDeep: item.hasDeepAnalysis,
    running: isRunning(item),
  };
}

const targetOf = (item: CaseListItem): CaseTarget => ({
  id: item.id,
  name: item.companyName,
  phase: item.phase,
  status: item.status,
});

function CasesPage() {
  const t = useT();
  const language = useLanguage();
  const navigate = useNavigate();
  const {
    fundId,
    fund,
    isLoading: fundsLoading,
    isError: fundsError,
    refreshFunds,
  } = useActiveFund();
  const session = useSession();
  const getCases = useServerFn(listCases);
  const access = useMyAccess(fundId);
  const permissions = casePermissions(access.data?.capabilities);
  const canCreate = access.data?.capabilities.includes("create_case") ?? false;
  const actions = useCaseActions(fundId);
  const reduced = useReducedMotion();
  // "Hvem var det nu lige?": the company's monogram opens Brain's card when Brain works.
  const brainCaps = useBrainCapabilities();
  const brainOn = showBrain(brainCaps.data);
  const [who, setWho] = useState<CardSource | null>(null);

  const query = useQuery({
    queryKey: ["cases", fundId],
    queryFn: () => getCases({ data: { fundId: fundId! } }),
    enabled: session.status === "signed_in" && Boolean(fundId),
    retry: false,
    refetchInterval: (current) => ((current.state.data ?? []).some(isRunning) ? 2_500 : false),
  });
  const all = useMemo(() => query.data ?? [], [query.data]);

  const [stage, setStage] = useState<StageKey>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const [statuses, setStatuses] = useState<CaseStatus[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [geos, setGeos] = useState<string[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [openTasksOnly, setOpenTasksOnly] = useState(false);
  const [overThreshold, setOverThreshold] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const inStage = (item: CaseListItem, key: StageKey) => key === "all" || item.phase === key;

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("da");
    const list = all.filter((item) => {
      if (!inStage(item, stage)) return false;
      if (
        needle &&
        ![item.companyName, item.sector ? sectorText(item.sector, language) : null].some((value) =>
          value?.toLocaleLowerCase("da").includes(needle),
        )
      ) {
        return false;
      }
      if (statuses.length && !statuses.includes(item.status)) return false;
      if (sectors.length && !(item.sector && sectors.includes(item.sector))) return false;
      if (stages.length && !stages.includes(item.stage)) return false;
      if (geos.length && !(item.geography && geos.includes(item.geography))) return false;
      if (owners.length && !(item.assigneeId && owners.includes(item.assigneeId))) return false;
      if (openTasksOnly && item.openTasks === 0) return false;
      if (overThreshold) {
        const score = scoreOf(item);
        if (score === null || item.threshold === null || score < item.threshold) return false;
      }
      return true;
    });
    return list.sort((a, b) => {
      if (sort.key === "name") {
        // dir 1 = ascending (A→Z), as the arrow and aria-sort say.
        return a.companyName.localeCompare(b.companyName, "da") * sort.dir;
      }
      const av = sort.key === "score" ? scoreOf(a) : a.openTasks;
      const bv = sort.key === "score" ? scoreOf(b) : b.openTasks;
      // Unscored cases last in both directions.
      if (av === null && bv === null) return a.companyName.localeCompare(b.companyName, "da");
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * sort.dir || a.companyName.localeCompare(b.companyName, "da");
    });
  }, [
    all,
    language,
    geos,
    openTasksOnly,
    overThreshold,
    owners,
    search,
    sectors,
    sort,
    stage,
    stages,
    statuses,
  ]);

  const visibleIds = new Set(rows.map((item) => item.id));
  const selectedRows = rows.filter((item) => selected.includes(item.id));
  const allOn = rows.length > 0 && selectedRows.length === rows.length;
  const activeCount = all.filter((item) => item.phase !== "decided").length;

  const options = useMemo(() => {
    const unique = <T,>(values: (T | null)[]) => [
      ...new Set(values.filter((value): value is T => value !== null)),
    ];
    const ownerMap = new Map<string, string>();
    for (const item of all) {
      if (item.assigneeId)
        ownerMap.set(item.assigneeId, item.assigneeName ?? t("cases.list.unknownOwner"));
    }
    return {
      sectors: unique(all.map((item) => item.sector)).sort((a, b) =>
        sectorText(a, language).localeCompare(sectorText(b, language), language),
      ),
      stages: unique(all.map((item) => item.stage)),
      geos: unique(all.map((item) => item.geography)).sort((a, b) =>
        geographyText(a, language).localeCompare(geographyText(b, language), language),
      ),
      owners: [...ownerMap.entries()].sort((a, b) => a[1].localeCompare(b[1], language)),
    };
  }, [all, t, language]);

  const anyFilter =
    statuses.length + sectors.length + stages.length + geos.length + owners.length > 0 ||
    openTasksOnly ||
    overThreshold;
  const clearFilters = () => {
    setStatuses([]);
    setSectors([]);
    setStages([]);
    setGeos([]);
    setOwners([]);
    setOpenTasksOnly(false);
    setOverThreshold(false);
  };

  const openCase = (item: CaseListItem) =>
    void navigate({
      to: "/cases/$caseId",
      params: { caseId: item.id },
      search: { view: item.hasDeepAnalysis && item.phase !== "screening" ? "deep" : "screening" },
    });

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const highlight = bulkHighlight(selectedRows.map(actionState));
  // Cases that were not moved stay selected, so the user sees which (harden G).
  const keepRefused = (remaining: string[]) => setSelected(remaining);
  const clearSelection = () => setSelected([]);
  /**
   * Bulk works on open cases only: a decided case is reopened from its own menu, never held,
   * sent to komité or flipped by a bulk action (harden C).
   */
  const runBulk = (
    command: Parameters<typeof actions.perform>[0],
    eligible: (item: CaseListItem) => boolean,
    skippedWhy: string,
  ) => {
    const targets = selectedRows.filter(eligible);
    const skipped = selectedRows.length - targets.length;
    if (targets.length === 0) {
      showToast({
        message: t("cases.bulk.noneFit", { why: skippedWhy }),
        tone: "error",
      });
      return;
    }
    actions.perform(command, targets.map(targetOf), {
      onDone: keepRefused,
      bulk: true,
      ...(skipped > 0
        ? { skipped: t("cases.bulk.skipped", { count: skipped, why: skippedWhy }) }
        : {}),
    });
  };
  const open = (item: CaseListItem) => item.phase !== "decided";
  const bulkActions = [
    {
      key: "deep",
      label: t("cases.actions.runDeepAnalysis.label"),
      icon: Sparkles,
      highlighted: highlight.deep,
      disabled: !permissions.canRun,
      disabledReason: t("cases.bulk.roleCannotRun"),
      onClick: () =>
        runBulk(
          { kind: "run", run: "deep" },
          (item) => open(item) && item.canRunDeep && !isRunning(item),
          t("cases.bulk.whyDeep"),
        ),
    },
    {
      key: "committee",
      label: t("cases.actions.sendToCommittee.label"),
      icon: Gavel,
      highlighted: highlight.committee,
      disabled: !permissions.canMove,
      disabledReason: t("cases.bulk.roleCannotMove"),
      onClick: () =>
        runBulk(
          { kind: "transition", action: "send_to_committee", dialog: "committee" },
          (item) => open(item) && item.phase !== "committee",
          t("cases.bulk.whyCommittee"),
        ),
    },
    {
      key: "hold",
      label: t("cases.actions.hold.label"),
      icon: CirclePause,
      disabled: !permissions.canMove,
      disabledReason: t("cases.bulk.roleCannotMove"),
      onClick: () =>
        runBulk(
          { kind: "transition", action: "hold", dialog: "hold" },
          (item) => open(item) && item.status !== "on_hold",
          t("cases.bulk.whyHold"),
        ),
    },
    {
      key: "close",
      label: t("cases.bulk.close"),
      icon: CircleX,
      disabled: !permissions.canDecide,
      disabledReason: t("cases.bulk.needsLeadOrAdmin"),
      onClick: () =>
        runBulk(
          { kind: "transition", action: "close", dialog: "close" },
          open,
          t("cases.bulk.whyClose"),
        ),
    },
  ];

  // The server refuses the list until the thesis is published; other errors are shown as such.
  const noConfig =
    fund?.configStatus !== "active" &&
    isServerRefusal(query.error, "caseServer.cases.noPublishedSetup");

  return (
    <AppShell title={t("cases.list.title")} redesigned>
      <div className="flex max-w-[1240px] flex-col gap-[22px] px-4 pt-6 pb-20 md:px-10 md:pt-[30px]">
        <RevealGroup start={0} step={0.03}>
          <Reveal className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <h1 className="m-0 text-[40px] leading-[1.05] font-semibold tracking-display">
                {t("cases.list.title")}
              </h1>
              <span className="text-[15px] text-ink-3">
                {query.data
                  ? t(activeCount === 1 ? "cases.list.activeOne" : "cases.list.activeMany", {
                      count: activeCount,
                    })
                  : " "}
              </span>
              {access.isError && (
                <span role="alert" className="text-meta text-critical">
                  {t("cases.list.accessError")}
                </span>
              )}
              {query.isError && query.data && (
                // A failed refresh keeps the table, but says it may be out of date (harden SF7).
                <span role="alert" className="text-meta text-critical">
                  {t("cases.list.stale")}{" "}
                  <button
                    type="button"
                    onClick={() => void query.refetch()}
                    className="font-medium underline underline-offset-2"
                  >
                    {t("cases.list.retry")}
                  </button>
                </span>
              )}
            </div>
            <div className="flex-1" />
            <label className="flex h-10 w-[280px] max-w-full items-center gap-2.5 rounded-pill bg-sunken px-3.5 transition-[background-color,box-shadow] duration-[160ms] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1.5px_var(--action),0_0_0_4px_var(--action-wash)]">
              <Search className="size-4 shrink-0 text-ink-4" strokeWidth={1.9} aria-hidden />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("cases.list.search")}
                aria-label={t("cases.list.search")}
                className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink-1 outline-none placeholder:text-ink-4"
              />
            </label>
            {canCreate && (
              <Link
                to="/opret-case"
                className="inline-flex h-10 items-center gap-2 rounded-pill bg-inverse px-[18px] text-[14px] font-medium whitespace-nowrap text-ink-inverse transition-transform duration-[var(--dur-quick)] active:scale-[.97]"
              >
                <Plus className="size-4" strokeWidth={1.9} aria-hidden />
                {t("cases.list.createCase")}
              </Link>
            )}
          </Reveal>

          <Reveal
            delay={0.03}
            className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5"
          >
            {STAGES.map((entry) => {
              const count = all.filter((item) => inStage(item, entry.key)).length;
              const active = stage === entry.key;
              // One tick per case (Cases v4); long lists are capped so the ticks stay readable.
              const ticks = Math.max(1, Math.min(count, 30));
              return (
                <button
                  key={entry.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStage(entry.key)}
                  className={cn(
                    "flex flex-col items-start gap-2.5 rounded-lg border-0 px-[18px] py-4 text-left transition-[background-color,box-shadow,transform] duration-[240ms] ease-[var(--ease-standard)] hover:-translate-y-0.5 active:scale-[.98]",
                    active
                      ? "bg-surface shadow-[inset_0_0_0_1.5px_var(--ink-1),var(--shadow-card)]"
                      : "bg-canvas",
                  )}
                >
                  <span className="flex items-center gap-2 text-list font-medium whitespace-nowrap text-ink-2">
                    <span className="size-2 rounded-full" style={{ background: entry.color }} />
                    {t(entry.label)}
                  </span>
                  <span className="text-[30px] leading-none font-semibold tracking-display text-ink-1">
                    {query.data ? count : "–"}
                  </span>
                  <span className={cn("flex h-1 w-full", count > 16 ? "gap-0.5" : "gap-[3px]")}>
                    {Array.from({ length: ticks }, (_, index) => (
                      <span
                        key={index}
                        className="flex-1 rounded-[2px]"
                        style={{ background: count ? entry.color : "var(--chart-track)" }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </Reveal>

          <Reveal delay={0.03} className="relative z-20 flex flex-wrap items-center gap-2">
            <FilterMenu
              label={t("cases.list.filterStatus")}
              icon={CircleDashed}
              values={statuses}
              onChange={setStatuses}
              options={(["active", "on_hold", "closed", "invested"] as const).map((value) => ({
                value,
                label: t(caseStatusLabelKey[value]),
              }))}
            />
            <FilterMenu
              label={t("cases.list.filterSector")}
              icon={Factory}
              values={sectors}
              onChange={setSectors}
              options={options.sectors.map((value) => ({
                value,
                label: sectorText(value, language),
              }))}
            />
            <FilterMenu
              label={t("cases.list.filterStage")}
              icon={Layers}
              values={stages}
              onChange={setStages}
              options={options.stages.map((value) => ({
                value,
                label: stageWord(value, language),
              }))}
            />
            <FilterMenu
              label={t("cases.list.filterGeography")}
              icon={MapPin}
              values={geos}
              onChange={setGeos}
              options={options.geos.map((value) => ({
                value,
                label: geographyText(value, language),
              }))}
            />
            <FilterMenu
              label={t("cases.list.filterOwner")}
              icon={UserRound}
              values={owners}
              onChange={setOwners}
              options={options.owners.map(([value, label]) => ({ value, label }))}
              short={(label) => label.split(" ")[0] ?? label}
            />
            <FilterChip
              icon={CircleDot}
              on={openTasksOnly}
              onClick={() => setOpenTasksOnly((value) => !value)}
            >
              {t("cases.list.openTasksOnly")}
            </FilterChip>
            <FilterChip
              icon={TrendingUp}
              on={overThreshold}
              onClick={() => setOverThreshold((value) => !value)}
            >
              {t("cases.list.overThreshold")}
            </FilterChip>
            {anyFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 rounded-pill px-3 text-list font-medium whitespace-nowrap text-ink-3 transition-colors hover:text-ink-1"
              >
                {t("cases.list.resetFilters")}
              </button>
            )}
          </Reveal>

          <Reveal delay={0.03}>
            {!fundId && !fundsLoading ? (
              fundsError ? (
                <ErrorState
                  title={t("cases.list.fundsError")}
                  onRetry={() => void refreshFunds()}
                />
              ) : (
                <EmptyState title={t("cases.list.noFundTitle")} body={t("cases.list.noFundBody")} />
              )
            ) : query.isLoading || !fundId ? (
              <LoadingState title={t("cases.list.loading")} />
            ) : query.isError && !query.data ? (
              noConfig ? (
                <EmptyState
                  title={t("cases.list.unpublishedTitle")}
                  body={t("cases.list.unpublishedBody")}
                >
                  <Link to="/fond" className="text-list font-medium text-action">
                    {t("cases.list.toFundSetup")}
                  </Link>
                </EmptyState>
              ) : (
                <ErrorState
                  title={t("cases.list.loadErrorTitle")}
                  body={userMessage(query.error, t("cases.list.loadErrorBody"), language)}
                  onRetry={() => void query.refetch()}
                />
              )
            ) : all.length === 0 ? (
              <FirstCaseSteps canCreate={canCreate} />
            ) : (
              <div className="overflow-x-auto">
                <div
                  className="flex min-w-[1100px] flex-col"
                  role="table"
                  aria-label={t("cases.table.label")}
                >
                  <div
                    role="row"
                    className="grid h-9 grid-cols-[28px_minmax(220px,1.4fr)_116px_130px_84px_176px_236px] items-center gap-4 px-4 text-meta text-ink-4"
                  >
                    <span role="columnheader">
                      {permissions.canAct && (
                        <Checkbox
                          checked={allOn}
                          label={allOn ? t("cases.table.deselectAll") : t("cases.table.selectAll")}
                          onToggle={() => setSelected(allOn ? [] : rows.map((item) => item.id))}
                        />
                      )}
                    </span>
                    <SortHead
                      label={t("cases.table.company")}
                      sortKey="name"
                      sort={sort}
                      onSort={setSort}
                    />
                    <span role="columnheader" className="font-medium">
                      {t("cases.table.phase")}
                    </span>
                    <SortHead
                      label={t("cases.table.score")}
                      sortKey="score"
                      sort={sort}
                      onSort={setSort}
                    />
                    <SortHead
                      label={t("cases.table.tasks")}
                      sortKey="tasks"
                      sort={sort}
                      onSort={setSort}
                    />
                    <span role="columnheader" className="font-medium">
                      {t("cases.table.status")}
                    </span>
                    <span role="columnheader" className="font-medium">
                      {t("cases.table.nextStep")}
                    </span>
                  </div>
                  {rows.map((item, index) => (
                    <CaseRow
                      key={item.id}
                      item={item}
                      index={index}
                      reduced={Boolean(reduced)}
                      selected={selected.includes(item.id)}
                      selectable={permissions.canAct}
                      busy={actions.busy.has(item.id)}
                      onToggle={() => toggle(item.id)}
                      onOpen={() => openCase(item)}
                      onWho={brainOn ? () => setWho({ caseId: item.id }) : undefined}
                      actionSlot={
                        permissions.canAct ? (
                          <NextStep
                            item={item}
                            permissions={permissions}
                            busy={actions.busy.has(item.id)}
                            onCommand={(command) => actions.perform(command, [targetOf(item)])}
                          />
                        ) : null
                      }
                    />
                  ))}
                  {rows.length === 0 && (
                    <div className="px-5 py-12 text-center text-[15px] text-ink-3">
                      {search.trim()
                        ? t("cases.list.noMatch", { search: search.trim() })
                        : t("cases.list.noneInStage")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Reveal>
        </RevealGroup>
      </div>

      <BulkBar
        count={selectedRows.filter((item) => visibleIds.has(item.id)).length}
        actions={bulkActions}
        onClear={clearSelection}
      />
      {actions.element}
      {fundId && brainOn && (
        <BrainCardDialog fundId={fundId} source={who} onClose={() => setWho(null)} />
      )}
    </AppShell>
  );
}

function CaseRow({
  item,
  index,
  reduced,
  selected,
  selectable,
  busy,
  onToggle,
  onOpen,
  onWho,
  actionSlot,
}: {
  item: CaseListItem;
  index: number;
  reduced: boolean;
  selected: boolean;
  selectable: boolean;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Opens "Hvem var det nu lige?" for the company; absent when Brain is off. */
  onWho?: (() => void) | undefined;
  actionSlot: ReactNode;
}) {
  const t = useT();
  const language = useLanguage();
  const phase = phaseCell(item.phase, item.status, t);
  const score = scoreOf(item);
  const threshold = item.threshold ?? 70;
  const over = score !== null && score >= threshold;
  const meta = [
    item.sector ? sectorText(item.sector, language) : null,
    item.stage && item.stage !== "unknown" ? stageWord(item.stage, language) : null,
    item.geography ? geographyText(item.geography, language) : null,
  ]
    .filter(Boolean)
    .join(", ");

  // The whole row opens the case; controls inside it keep their own click.
  const fromControl = (event: MouseEvent | KeyboardEvent) =>
    (event.target as HTMLElement).closest("button, a, input, [role=menu], [data-row-control]");
  return (
    <motion.div
      role="row"
      tabIndex={-1}
      onClick={(event) => {
        if (fromControl(event) || event.defaultPrevented) return;
        onOpen();
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={
        reduced ? REDUCED_FADE : { duration: 0.4, ease: EASE.out, delay: staggerDelay(index) }
      }
      className={cn(
        "grid min-h-[89px] cursor-pointer grid-cols-[28px_minmax(220px,1.4fr)_116px_130px_84px_176px_236px] items-center gap-4 rounded-[12px] border-t border-line px-4 py-2 text-ink-1 transition-colors duration-[220ms] hover:bg-hover",
        selected && "bg-[color-mix(in_srgb,var(--action)_6%,transparent)]",
        busy && "opacity-70",
      )}
    >
      <span role="cell">
        {selectable && (
          <Checkbox
            checked={selected}
            label={t("cases.table.selectCase", { name: item.companyName })}
            onToggle={onToggle}
          />
        )}
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-3.5">
        {onWho ? (
          <button
            type="button"
            onClick={onWho}
            aria-label={t("cases.table.whoFor", { name: item.companyName })}
            title={t("cases.table.who")}
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] border-0 bg-sunken text-[13px] font-semibold text-ink-2 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-action"
          >
            {monogram(item.companyName)}
          </button>
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-sunken text-[13px] font-semibold text-ink-2">
            {monogram(item.companyName)}
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-px">
          <Link
            to="/cases/$caseId"
            params={{ caseId: item.id }}
            search={{
              view: item.hasDeepAnalysis && item.phase !== "screening" ? "deep" : "screening",
            }}
            title={item.companyName}
            className="line-clamp-2 text-[15px] leading-5 font-semibold text-ink-1 outline-none hover:no-underline focus-visible:underline"
          >
            {item.companyName}
          </Link>
          {meta && <span className="line-clamp-2 text-meta text-ink-3">{meta}</span>}
          {item.olderSetup && (
            <span className="text-meta text-ink-3" title={t("cases.table.olderSetupHint")}>
              {item.olderSetupVersion == null
                ? t("cases.table.olderSetup")
                : t("cases.table.olderSetupVersion", { version: `v${item.olderSetupVersion}` })}
            </span>
          )}
        </span>
      </span>
      <span role="cell" className="flex items-center gap-2 text-list whitespace-nowrap">
        <span
          className="size-[7px] rounded-full transition-colors duration-[400ms]"
          style={{ background: phase.color }}
        />
        {phase.label}
      </span>
      <span role="cell" className="flex items-center gap-2.5">
        {score === null ? (
          <span className="text-list text-ink-4">–</span>
        ) : (
          <>
            <span
              className="min-w-[26px] text-[18px] font-semibold tracking-title"
              style={{ color: over ? "var(--ink-1)" : "var(--ink-3)" }}
            >
              {formatWholeScore(score, language)}
            </span>
            <span className="relative h-[5px] flex-1 rounded-[3px] bg-[var(--chart-track)]">
              <motion.span
                className="absolute inset-y-0 left-0 origin-left rounded-[3px]"
                style={{
                  width: `${Math.max(0, Math.min(100, score))}%`,
                  background: over ? "var(--ink-1)" : "var(--ink-3)",
                }}
                initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
                animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
                transition={
                  reduced
                    ? REDUCED_FADE
                    : { duration: 0.8, ease: EASE.out, delay: staggerDelay(index) }
                }
              />
              <span
                className="absolute -top-[3px] -bottom-[3px] w-[1.5px] bg-ink-4"
                style={{ left: `${threshold}%` }}
                aria-hidden
              />
            </span>
          </>
        )}
        {item.mandateBreach && (
          <span
            title={t("cases.table.mandateBreach")}
            aria-label={t("cases.table.mandateBreach")}
            className="size-[7px] shrink-0 rounded-full bg-critical"
          />
        )}
      </span>
      <span
        role="cell"
        className={cn(
          "flex items-center gap-2 text-list whitespace-nowrap",
          item.openTasks ? "font-semibold text-ink-1" : "text-ink-4",
        )}
      >
        {item.openTasks ? (
          <CircleDot className="size-3.5 text-warning" strokeWidth={1.9} aria-hidden />
        ) : (
          <CircleCheck className="size-3.5 text-positive" strokeWidth={1.9} aria-hidden />
        )}
        {item.openTasks
          ? t(item.openTasks === 1 ? "cases.table.openTasksOne" : "cases.table.openTasksMany", {
              count: item.openTasks,
            })
          : t("cases.table.noTasks")}
      </span>
      <span role="cell" className="min-w-0 justify-self-start">
        <StatusChip status={statusChipKey(item.phase, item.status)} />
      </span>
      <span role="cell" data-row-control className="flex min-w-0 items-center gap-1.5">
        {isRunning(item) ? (
          <span className="inline-flex h-[34px] items-center gap-2 rounded-pill bg-ai-wash pr-3.5 pl-2.5 text-meta font-medium whitespace-nowrap text-ai-ink">
            <AiOrb size={20} tone="ai" state="working" />
            {item.activeRunKind === "deep"
              ? t("cases.table.deepRunning")
              : t("cases.table.screeningRunning")}
          </span>
        ) : (
          actionSlot
        )}
      </span>
    </motion.div>
  );
}

function NextStep({
  item,
  permissions,
  busy,
  onCommand,
}: {
  item: CaseListItem;
  permissions: ReturnType<typeof casePermissions>;
  busy: boolean;
  onCommand: (command: Parameters<ReturnType<typeof useCaseActions>["perform"]>[0]) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const state = actionState(item);
  const primary = primaryAction(state, "list");
  if (!primary) return null;
  const copy = caseActionCopy(primary.id, language);
  const nudge =
    item.phase !== "decided" && needsNudge(item.status, item.lastActionAt)
      ? daysWithoutAction(item.lastActionAt)
      : undefined;
  const phase = phaseCell(item.phase, item.status, t);
  const phaseWord = t(casePhaseLabelKey[item.phase]);
  const now =
    item.phase === "decided"
      ? phase.label
      : item.status === "on_hold"
        ? t("cases.table.nowOnHold", { phase: phaseWord })
        : item.phase === "committee"
          ? t("cases.table.nowAwaitingDecision", { phase: phaseWord })
          : phaseWord;
  // The left half does the recommended step, unless the role cannot take it.
  const primaryBlocked = menuGroups(state, permissions, "list", language)
    .flatMap((group) => group.items)
    .find((entry) => entry.id === primary.id)?.blocked;
  return (
    <SplitButton
      size="sm"
      label={copy.label}
      icon={primary.id === "reopen" ? RotateIcon : copy.icon}
      pending={busy}
      open={open}
      onOpenChange={setOpen}
      {...(nudge !== undefined ? { nudgeDays: nudge } : {})}
      {...(primary.command.kind === "menu" || primaryBlocked
        ? {}
        : { onPrimary: () => onCommand(primary.command) })}
    >
      <MenuHeader title={item.companyName} status={now} dot={phase.color} />
      <CaseActionMenuItems
        groups={menuGroups(state, permissions, "list", language)}
        onSelect={(entry) => {
          setOpen(false);
          onCommand(entry.command);
        }}
      />
    </SplitButton>
  );
}

function Checkbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "grid size-5 place-items-center rounded-[6px] p-0 transition-[background-color,box-shadow,transform] duration-200 ease-[var(--ease-standard)] active:scale-[.88]",
        checked ? "bg-ink-1" : "bg-surface shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
      )}
    >
      <Check
        className="size-3 text-ink-inverse transition-[opacity,transform] duration-[260ms]"
        style={{ opacity: checked ? 1 : 0, transform: `scale(${checked ? 1 : 0.4})` }}
        strokeWidth={2.4}
        aria-hidden
      />
    </button>
  );
}

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (next: { key: SortKey; dir: 1 | -1 }) => void;
}) {
  const active = sort.key === sortKey;
  const Arrow = sort.dir < 0 ? ArrowDown : ArrowUp;
  // Names start A→Z; numbers start highest first.
  const firstDir: 1 | -1 = sortKey === "name" ? 1 : -1;
  return (
    <span
      role="columnheader"
      aria-sort={active ? (sort.dir < 0 ? "descending" : "ascending") : "none"}
      className="justify-self-start"
    >
      <button
        type="button"
        onClick={() => onSort({ key: sortKey, dir: active ? (sort.dir === 1 ? -1 : 1) : firstDir })}
        className={cn(
          "inline-flex items-center gap-[5px] p-0 text-meta font-medium whitespace-nowrap",
          active ? "text-ink-1" : "text-ink-4",
        )}
      >
        {label}
        {active && <Arrow className="size-[11px]" strokeWidth={2} aria-hidden />}
      </button>
    </span>
  );
}

function chipClass(on: boolean) {
  return cn(
    "inline-flex h-9 items-center gap-[7px] rounded-pill px-3.5 text-list font-medium whitespace-nowrap transition-[background-color,color,transform] duration-200 active:scale-[.96]",
    on
      ? "bg-inverse text-ink-inverse"
      : "bg-surface text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)]",
  );
}

function FilterChip({
  icon: Icon,
  on,
  onClick,
  children,
}: {
  icon: LucideIcon;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={chipClass(on)}>
      <Icon className="size-[13px]" strokeWidth={1.9} aria-hidden />
      {children}
    </button>
  );
}

function FilterMenu<T extends string>({
  label,
  icon: Icon,
  values,
  options,
  onChange,
  short = (text) => text,
}: {
  label: string;
  icon: LucideIcon;
  values: T[];
  options: { value: T; label: string }[];
  onChange: (next: T[]) => void;
  short?: (label: string) => string;
}) {
  const on = values.length > 0;
  const chosen = options.filter((option) => values.includes(option.value));
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className={chipClass(on)} disabled={options.length === 0}>
          <Icon className="size-[13px]" strokeWidth={1.9} aria-hidden />
          {on ? `${label}: ${chosen.map((option) => short(option.label)).join(", ")}` : label}
          <ChevronDown className="size-3 opacity-60" strokeWidth={2} aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent size="compact" className="max-h-80">
        {options.map((option) => (
          <MenuCheckItem
            key={option.value}
            checked={values.includes(option.value)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...values, option.value]
                  : values.filter((value) => value !== option.value),
              )
            }
          >
            {option.label}
          </MenuCheckItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
