/**
 * Overblik v2 (prototype "Overblik v2.dc.html", "Overblik v2"): greeting and
 * period, "Venter på jer" with the tasks line, Pipeline, Geografi, Sektor og fase, Tilgang,
 * Scorefordeling and Stadie. Every card opens a sub-page (`?kort=`), the period is in the URL
 * (`?periode=`). Numbers come from `getOverviewSnapshot` (server, all pages read); a fund with
 * no published setup gets an empty state, not an error. A Læser sees the page without actions.
 */
import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/ds/AppShell";
import { FocusHost } from "@/components/ds/FocusPage";
import { Reveal, RevealGroup } from "@/components/ds/Reveal";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { EmptyState, ErrorState, LoadingState } from "@/components/ds/States";
import { useCaseActions } from "@/components/cases/useCaseActions";
import { GeoMap } from "@/components/overview/CountryMap";
import {
  FunnelBars,
  HeatGrid,
  IntakeBarsChart,
  ScoreHistogram,
  StageDonut,
} from "@/components/overview/charts";
import { CreditMeter } from "@/components/ai/CreditMeter";
import { DriftRow, RunningLine } from "@/components/overview/DriftRow";
import { OverviewFocusPage } from "@/components/overview/FocusPages";
import { CARD_KEYS, CardEmpty, OverviewCard, type CardKey } from "@/components/overview/shared";
import { WaitingCard } from "@/components/overview/WaitingCard";
import { useMyAccess, casePermissions } from "@/lib/auth/useMyAccess";
import { useSession } from "@/lib/auth/useSession";
import { useActiveFund } from "@/lib/funds/useActiveFund";
import {
  PERIODS,
  greetingLine,
  parsePeriod,
  periodLabel,
  type OverviewPeriod,
} from "@/lib/overview/dates";
import {
  getOverviewRunning,
  getOverviewSnapshot,
  type OverviewSnapshot,
} from "@/lib/overview/overview.functions";
import { useNow } from "@/lib/overview/useNow";
import { MIN_HEAT_CASES } from "@/lib/overview/snapshot";
import { userMessage } from "@/lib/errors/user-message";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { pageMeta } from "@/lib/i18n/page-head";

interface OverviewSearch {
  periode?: OverviewPeriod;
  kort?: CardKey;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [...pageMeta("overview"), { name: "robots", content: "noindex" }],
  }),
  validateSearch: (search: Record<string, unknown>): OverviewSearch => {
    const kort = (CARD_KEYS as readonly unknown[]).includes(search["kort"])
      ? (search["kort"] as CardKey)
      : undefined;
    const periode = parsePeriod(search["periode"]);
    return { ...(periode !== "4w" ? { periode } : {}), ...(kort ? { kort } : {}) };
  },
  component: OverviewPage,
});

function OverviewPage() {
  const { fundId, isLoading: fundsLoading, isError: fundsError, refreshFunds } = useActiveFund();
  const queryClient = useQueryClient();
  const session = useSession();
  const search = Route.useSearch();
  const periode = search.periode ?? "4w";
  const kort = search.kort;
  const navigate = useNavigate({ from: "/" });
  const load = useServerFn(getOverviewSnapshot);
  const access = useMyAccess(fundId);
  const permissions = casePermissions(access.data?.capabilities);
  const actions = useCaseActions(fundId);
  const t = useT();
  const language = useLanguage();
  const query = useQuery({
    // The server builds some labels in the fund's language, so a language switch fetches again.
    queryKey: ["overview", fundId, periode, language],
    queryFn: () => load({ data: { fundId: fundId!, period: periode } }),
    enabled: session.status === "signed_in" && Boolean(fundId),
    retry: false,
    // Changing the period keeps the old numbers until the new ones are in; they then tween.
    placeholderData: keepPreviousData,
  });
  const result = query.data;
  // "I gang nu" follows the runs with a small query every 5 s while something runs (30 s in rest); the full
  // snapshot is read again only when a run has finished (and when the window regains focus).
  const loadRunning = useServerFn(getOverviewRunning);
  const runningQuery = useQuery({
    queryKey: ["overview-running", fundId],
    queryFn: () => loadRunning({ data: { fundId: fundId! } }),
    enabled: session.status === "signed_in" && Boolean(fundId) && result?.status === "ready",
    retry: false,
    // In rest every 30 s, so a run started elsewhere shows up.
    refetchInterval: (current) => (current.state.data?.length ? 5000 : 30_000),
  });
  const runningKeys = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!runningQuery.data) return;
    const keys = new Set(runningQuery.data.map((run) => `${run.caseId}:${run.kind}`));
    const before = runningKeys.current;
    runningKeys.current = keys;
    if (before && [...before].some((key) => !keys.has(key))) {
      void queryClient.invalidateQueries({ queryKey: ["overview", fundId] });
    }
  }, [runningQuery.data, queryClient, fundId]);

  const setPeriod = (next: OverviewPeriod) =>
    void navigate({
      search: (prev) => ({
        ...(prev.kort ? { kort: prev.kort } : {}),
        ...(next !== "4w" ? { periode: next } : {}),
      }),
      replace: true,
    });
  const openCard = (next: CardKey) =>
    void navigate({ search: (prev) => ({ ...prev, kort: next }) });
  // Replaces the entry, so the browser's Back after "← Overblik" does not reopen the sub-page.
  const closeCard = () =>
    void navigate({
      search: (prev) => ({ ...(prev.periode ? { periode: prev.periode } : {}) }),
      replace: true,
    });

  const focus =
    result?.status === "ready" && kort && fundId ? (
      <OverviewFocusPage card={kort} data={result.data} fundId={fundId} onBack={closeCard} />
    ) : null;

  return (
    <AppShell title={t("nav.overview")} redesigned>
      {fundsLoading && <LoadingState title={t("overview.page.loading")} />}
      {!fundsLoading && fundsError && (
        <ErrorState title={t("overview.page.fundsError")} onRetry={() => void refreshFunds()} />
      )}
      {!fundsLoading && !fundsError && !fundId && (
        <EmptyState title={t("overview.page.noFundTitle")} body={t("overview.page.noFundBody")} />
      )}
      {query.isLoading && !result && <LoadingState title={t("overview.page.loading")} />}
      {query.isError && !result && (
        <ErrorState
          title={t("overview.page.loadErrorTitle")}
          body={userMessage(query.error, t("overview.page.loadErrorBody"), language)}
          onRetry={() => void query.refetch()}
        />
      )}
      {result?.status === "no_profile" && (
        <EmptyState
          title={t("overview.page.noProfileTitle")}
          body={t("overview.page.noProfileBody")}
        >
          <Link
            to="/fond"
            className="inline-flex h-10 items-center rounded-pill bg-inverse px-[18px] text-[14px] font-medium text-ink-inverse"
          >
            {t("overview.page.setUpFund")}
          </Link>
        </EmptyState>
      )}
      {result?.status === "ready" && fundId && (
        <FocusHost focus={focus}>
          <Overview
            fundId={fundId}
            data={result.data}
            period={periode}
            onPeriod={setPeriod}
            onOpen={openCard}
            permissions={permissions}
            accessReady={access.data !== undefined}
            actions={actions}
            running={runningQuery.data ?? result.data.running}
            stale={query.isPlaceholderData}
            refreshFailed={query.isError}
            onRetry={() => void query.refetch()}
          />
        </FocusHost>
      )}
      {actions.element}
    </AppShell>
  );
}

function Overview({
  fundId,
  data,
  period,
  onPeriod,
  onOpen,
  permissions,
  accessReady,
  actions,
  running,
  stale,
  refreshFailed,
  onRetry,
}: {
  fundId: string;
  data: OverviewSnapshot;
  period: OverviewPeriod;
  onPeriod: (period: OverviewPeriod) => void;
  onOpen: (card: CardKey) => void;
  permissions: ReturnType<typeof casePermissions>;
  accessReady: boolean;
  actions: ReturnType<typeof useCaseActions>;
  running: OverviewSnapshot["running"];
  /** The numbers still belong to the previous period while the new ones load. */
  stale: boolean;
  refreshFailed: boolean;
  onRetry: () => void;
}) {
  const now = useNow();
  const t = useT();
  const language = useLanguage();
  const headline =
    data.totalCases === 0
      ? t("overview.page.noCasesYet")
      : data.waitingTotal === 0
        ? t("overview.page.allFollowedUp")
        : t(data.waitingTotal === 1 ? "overview.page.waitingOne" : "overview.page.waitingMany", {
            count: data.waitingTotal,
          });
  const overCount = data.funnel.steps.find((step) => step.key === "over")?.count ?? 0;
  // Only when at least one case is over the threshold: "all sent on" of none would be empty talk.
  const funnelNote =
    overCount === 0
      ? null
      : data.funnel.overNotForwarded > 0
        ? t(
            data.funnel.overNotForwarded === 1
              ? "overview.page.funnelNoteOne"
              : "overview.page.funnelNoteMany",
            { count: data.funnel.overNotForwarded },
          )
        : t("overview.page.funnelNoteAllSent");
  return (
    <div
      aria-busy={stale}
      className={`flex max-w-[1320px] flex-col gap-3.5 px-4 pt-6 pb-[90px] transition-opacity duration-200 md:px-9 md:pt-[30px] ${stale ? "opacity-60" : ""}`}
    >
      <RevealGroup start={0} step={0.04}>
        <Reveal className="flex flex-wrap items-end gap-4 pb-2.5">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="m-0 text-[32px] leading-[1.05] font-semibold tracking-display md:text-[44px]">
              {greetingLine(now, data.viewerFirstName, language)}
            </h1>
            <span className="text-[19px] text-ink-2">{headline}</span>
            {data.olderVersionCases > 0 && (
              <span className="max-w-[640px] text-meta text-ink-3">
                {t(
                  data.olderVersionCases === 1
                    ? "overview.page.olderVersionOne"
                    : "overview.page.olderVersionMany",
                  { count: data.olderVersionCases },
                )}
              </span>
            )}
            {refreshFailed && (
              <span role="alert" className="text-meta text-critical">
                {t("overview.page.refreshFailed")}{" "}
                <button
                  type="button"
                  onClick={onRetry}
                  className="font-medium underline underline-offset-2"
                >
                  {t("common.retry")}
                </button>
              </span>
            )}
          </div>
          <div className="flex-1" />
          <SegmentedControl<OverviewPeriod>
            aria-label={t("overview.page.periodAria")}
            value={period}
            onChange={onPeriod}
            options={PERIODS.map((entry) => ({ value: entry.key, label: t(entry.labelKey) }))}
          />
        </Reveal>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-3.5">
          <WaitingCard
            rows={data.waiting}
            total={data.waitingTotal}
            permissions={permissions}
            accessReady={accessReady}
            actions={actions}
            tasks={data.tasks}
            noCases={data.totalCases === 0}
            showTasks={accessReady && permissions.canAct}
            onOpenTasks={() => onOpen("tasks")}
          />
          <OverviewCard
            title={t("overview.cards.pipeline")}
            meta={periodLabel(data.period, language)}
            onOpen={() => onOpen("pipeline")}
            delay={0.08}
          >
            {data.funnel.cohort === 0 ? (
              <CardEmpty>{t("overview.empty.funnel")}</CardEmpty>
            ) : (
              <>
                <FunnelBars funnel={data.funnel} />
                {funnelNote && <span className="text-meta text-ink-3">{funnelNote}</span>}
              </>
            )}
          </OverviewCard>
        </div>

        <RunningLine running={running} />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-3.5">
          <GeoCard data={data} onOpen={() => onOpen("geografi")} />
          <OverviewCard
            title={t("overview.cards.sector")}
            meta={t("overview.page.activeCases")}
            onOpen={() => onOpen("sektor")}
            delay={0.16}
          >
            {data.activeCases < MIN_HEAT_CASES ? (
              <CardEmpty>
                {t("overview.empty.heat", { count: data.activeCases, min: MIN_HEAT_CASES })}
              </CardEmpty>
            ) : (
              <HeatGrid columns={data.heat.columns} rows={data.heat.rows} maxRows={6} />
            )}
          </OverviewCard>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3.5">
          <OverviewCard
            title={t("overview.cards.intake")}
            onOpen={() => onOpen("tilgang")}
            delay={0.2}
            headerExtra={
              <span className="flex items-center gap-3 text-micro text-ink-3">
                <span className="flex items-center gap-1.5">
                  <span className="size-[7px] rounded-[2px] bg-chart-track shadow-[inset_0_0_0_1.5px_var(--line-strong)]" />
                  {t("overview.page.legendNew")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-[7px] rounded-[2px] bg-ai" />
                  {t("overview.page.legendForwarded")}
                </span>
              </span>
            }
          >
            {data.intake.total === 0 ? (
              <CardEmpty>{t("overview.empty.intake")}</CardEmpty>
            ) : (
              <>
                <IntakeBarsChart intake={data.intake} />
                <span className="text-[22px] font-semibold tracking-title">
                  {t("overview.page.newAndForwarded", {
                    total: data.intake.total,
                    forwarded: data.intake.forwarded,
                  })}
                </span>
              </>
            )}
          </OverviewCard>
          <OverviewCard
            title={t("overview.cards.score")}
            onOpen={() => onOpen("score")}
            delay={0.24}
          >
            {data.scores.count === 0 ? (
              <CardEmpty>{t("overview.empty.score")}</CardEmpty>
            ) : (
              <>
                <ScoreHistogram bins={data.scores.bins} threshold={data.threshold} />
                <span className="text-[22px] font-semibold tracking-title">
                  {t("overview.page.overThresholdOf", {
                    over: data.scores.overThreshold,
                    count: data.scores.count,
                  })}
                </span>
              </>
            )}
          </OverviewCard>
          <OverviewCard
            title={t("overview.cards.stage")}
            onOpen={() => onOpen("stadie")}
            delay={0.28}
          >
            {data.stages.length === 0 ? (
              <CardEmpty>{t("overview.empty.stage")}</CardEmpty>
            ) : (
              <StageDonut stages={data.stages} />
            )}
          </OverviewCard>
        </div>

        <CreditMeter fundId={fundId} />

        <DriftRow data={data} />
      </RevealGroup>
    </div>
  );
}

const GEO_TABS = [
  { key: "total", label: "overview.geoTabs.all" },
  { key: "screening", label: "overview.geoTabs.screening" },
  { key: "deep_analysis", label: "overview.geoTabs.deep" },
  { key: "committee", label: "overview.geoTabs.committee" },
] as const satisfies ReadonlyArray<{ key: string; label: MessageKey }>;

function GeoCard({ data, onOpen }: { data: OverviewSnapshot; onOpen: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<(typeof GEO_TABS)[number]["key"]>("total");
  const rows = data.geo.rows
    .map((row) => ({ code: row.code, value: row[tab] }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  return (
    <OverviewCard
      title={t("overview.cards.geography")}
      onOpen={onOpen}
      delay={0.12}
      headerExtra={
        <div role="group" aria-label={t("overview.page.geoTabsAria")} className="flex gap-0.5">
          {GEO_TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={tab === entry.key}
              onClick={(event) => {
                event.stopPropagation();
                setTab(entry.key);
              }}
              className={`h-[30px] rounded-pill px-[11px] text-meta font-medium whitespace-nowrap outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-action ${
                tab === entry.key ? "bg-inverse text-ink-inverse" : "text-ink-3 hover:text-ink-1"
              }`}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>
      }
    >
      {data.geo.rows.length === 0 ? (
        <CardEmpty>{t("overview.empty.geo")}</CardEmpty>
      ) : (
        // Only the map; the count per country shows on hover, and the
        // "no known country" note stands on the sub-page.
        <div className="relative min-w-0 overflow-hidden">
          <GeoMap data={rows} focus="world" height={250} />
          {rows.length === 0 && (
            <span className="pointer-events-none absolute top-3 left-3 text-list text-ink-3">
              {t("overview.page.geoNoneInPhase")}
            </span>
          )}
        </div>
      )}
    </OverviewCard>
  );
}
