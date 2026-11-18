/**
 * The sub-pages of Overblik v2 ("Kortet svarer hvad, undersiden svarer hvorfor"): the card's
 * chart large, the key numbers, "Hvad betyder det?" (written in code from the real numbers,
 * left out when there is too little data) and "Cases bag tallet", the exact cases the number
 * counted. Geografi lets a click on a country filter that list. The headings and the lead
 * texts are the prototype's.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { FocusPage } from "@/components/ds/FocusPage";
import { SegmentedControl } from "@/components/ds/SegmentedControl";
import { ErrorState, LoadingState } from "@/components/ds/States";
import { StagePhaseBars } from "@/components/overview/StagePhaseBars";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import {
  countryName,
  geoMeaning,
  intakeMeaning,
  pipelineMeaning,
  scoreMeaning,
  sectorMeaning,
  stageMeaning,
  tasksMeaning,
  formatNumber,
} from "@/lib/overview/meaning";
import type { OverviewSnapshot } from "@/lib/overview/overview.functions";
import { MIN_HEAT_CASES } from "@/lib/overview/snapshot";
import { isOverdue, scopedTasks, sortTasks, type TaskScope } from "@/lib/overview/task-view";
import { useNow } from "@/lib/overview/useNow";
import { listFundOpenTasks } from "@/lib/overview/tasks.functions";
import { GeoMap } from "./CountryMap";
import { FunnelBars, HeatGrid, IntakeBarsChart, ScoreHistogram, StageDonut } from "./charts";
import {
  CardEmpty,
  CasesBehind,
  FocusStats,
  Meaning,
  type CardKey,
  type FocusStat,
} from "./shared";
import { TasksList } from "./TasksList";

const NORDIC = new Set(["DK", "SE", "NO", "FI", "IS"]);
const LATER_STAGES = new Set(["series_a", "series_b", "growth", "buyout", "later"]);

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.5, ease: EASE.out, delay: 0.04 }}
      className={`overflow-hidden rounded-xl bg-canvas px-7 py-[26px] ${className}`}
    >
      {children}
    </motion.div>
  );
}

const Lead = ({ children }: { children: ReactNode }) => (
  <span className="block max-w-[720px] text-[17px] leading-[1.6] [text-wrap:pretty] text-ink-2">
    {children}
  </span>
);

export function OverviewFocusPage({
  card,
  data,
  fundId,
  onBack,
}: {
  card: CardKey;
  data: OverviewSnapshot;
  fundId: string;
  onBack: () => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const t = useT();
  const language = useLanguage();

  const content = useMemo(() => {
    const count = (n: number) => n;
    switch (card) {
      case "pipeline": {
        const steps = Object.fromEntries(data.funnel.steps.map((step) => [step.key, step.count]));
        const cohort = data.funnel.cohort;
        return {
          title: t("overview.cards.pipeline"),
          lead: t("overview.focus.pipelineLead"),
          big:
            data.funnel.cohort === 0 ? (
              <CardEmpty>{t("overview.empty.funnel")}</CardEmpty>
            ) : (
              <FunnelBars funnel={data.funnel} large />
            ),
          stats: [
            { label: t("overview.focus.newCases"), value: count(cohort) },
            {
              label: t("overview.focus.deepConversion"),
              value: cohort ? Math.round(((steps["deep"] ?? 0) / cohort) * 100) : "–",
              ...(cohort ? { suffix: " %" } : {}),
            },
            { label: t("overview.focus.invested"), value: steps["invested"] ?? 0 },
          ] satisfies FocusStat[],
          meaning: pipelineMeaning(data, language),
          ids: data.lists.pipeline,
          scoreKind: "screening" as const,
          note: t("overview.focus.pipelineNote", {
            threshold: data.threshold,
            version: data.configVersion,
          }),
        };
      }
      case "geografi": {
        const known = data.geo.rows;
        const top = known[0];
        return {
          title: t("overview.cards.geography"),
          lead: t("overview.focus.geoLead"),
          big:
            known.length === 0 ? (
              <CardEmpty>{t("overview.empty.geo")}</CardEmpty>
            ) : (
              <GeoMap
                data={known.map((row) => ({ code: row.code, value: row.total }))}
                focus="europe"
                height={420}
                onPick={setPick}
              />
            ),
          stats: [
            { label: t("overview.focus.countries"), value: known.length },
            {
              label: t("overview.focus.largestMarket"),
              value: top ? countryName(top.code, language) : "–",
            },
            {
              label: t("overview.focus.outsideNordics"),
              value: known
                .filter((row) => !NORDIC.has(row.code))
                .reduce((s, row) => s + row.total, 0),
            },
          ] satisfies FocusStat[],
          meaning: geoMeaning(data, language),
          ids: data.lists.geo,
          // "Hvad betyder det?" already says how many have no known country.
          note: null,
        };
      }
      case "sektor": {
        const later = data.stages
          .filter((slice) => LATER_STAGES.has(slice.key))
          .reduce((sum, slice) => sum + slice.count, 0);
        return {
          title: t("overview.cards.sector"),
          lead: t("overview.focus.sectorLead"),
          big:
            data.activeCases < MIN_HEAT_CASES ? (
              <CardEmpty>
                {t("overview.empty.heat", { count: data.activeCases, min: MIN_HEAT_CASES })}
              </CardEmpty>
            ) : (
              <HeatGrid columns={data.heat.columns} rows={data.heat.rows} large />
            ),
          stats: [
            { label: t("overview.focus.sectors"), value: data.heat.rows.length },
            { label: t("overview.focus.mostCases"), value: data.heat.rows[0]?.label ?? "–" },
            { label: t("overview.focus.seriesAAndLater"), value: later },
          ] satisfies FocusStat[],
          meaning: sectorMeaning(data, language),
          ids: data.lists.sector,
          note: null,
        };
      }
      case "tilgang": {
        const weeks = data.intake.bars.length * data.intake.weeksPerBar;
        return {
          title: t("overview.cards.intake"),
          lead: t("overview.focus.intakeLead"),
          big:
            data.intake.total === 0 ? (
              <CardEmpty>{t("overview.empty.intake")}</CardEmpty>
            ) : (
              <IntakeBarsChart intake={data.intake} large />
            ),
          stats: [
            { label: t("overview.focus.newCases"), value: data.intake.total },
            { label: t("overview.focus.forwarded"), value: data.intake.forwarded },
            {
              label: t("overview.focus.weeklyAverage"),
              value: data.intake.total / weeks,
              decimals: 1,
            },
          ] satisfies FocusStat[],
          meaning: intakeMeaning(data, language),
          ids: data.lists.intake,
          note:
            data.intake.weeksPerBar > 1
              ? t("overview.focus.intakeNoteWeeks", { weeks: data.intake.weeksPerBar })
              : t("overview.focus.intakeNoteRolling"),
        };
      }
      case "score": {
        return {
          title: t("overview.cards.score"),
          lead: t("overview.focus.scoreLead"),
          big:
            data.scores.count === 0 ? (
              <CardEmpty>{t("overview.empty.score")}</CardEmpty>
            ) : (
              <ScoreHistogram bins={data.scores.bins} threshold={data.threshold} large />
            ),
          stats: [
            { label: t("overview.focus.screened"), value: data.scores.count },
            { label: t("overview.focus.overThreshold"), value: data.scores.overThreshold },
            {
              label: t("overview.focus.median"),
              value: data.scores.median === null ? "–" : formatNumber(data.scores.median, language),
            },
          ] satisfies FocusStat[],
          meaning: scoreMeaning(data, language),
          ids: data.lists.score,
          scoreKind: "screening" as const,
          note: null,
        };
      }
      case "stadie":
        return {
          title: t("overview.cards.stage"),
          lead: t("overview.focus.stageLead"),
          big:
            data.stages.length === 0 ? (
              <CardEmpty>{t("overview.empty.stage")}</CardEmpty>
            ) : (
              <StageDonut stages={data.stages} size={220} />
            ),
          stats: data.stages.map((slice) => ({
            label: slice.label,
            value: slice.count,
          })) satisfies FocusStat[],
          meaning: stageMeaning(data, language),
          ids: data.lists.stage,
          note: null,
        };
      case "tasks":
        return null;
    }
  }, [card, data, t, language]);

  if (card === "tasks" || content === null) {
    return <TasksFocus data={data} fundId={fundId} onBack={onBack} />;
  }

  const filtered =
    card === "geografi" && pick
      ? content.ids.filter((id) => data.cases[id]?.country?.toUpperCase() === pick)
      : content.ids;

  return (
    <FocusPage
      backLabel={t("nav.overview")}
      onBack={onBack}
      title={content.title}
      subtitle={<Lead>{content.lead}</Lead>}
    >
      <Panel>{content.big}</Panel>
      <FocusStats stats={content.stats} />
      <Meaning lines={content.meaning} />
      {content.note && <p className="m-0 px-1.5 text-meta text-ink-3">{content.note}</p>}
      {card === "stadie" && data.stages.reduce((sum, slice) => sum + slice.count, 0) >= 5 && (
        <Panel>
          <h3 className="m-0 mb-3 text-section font-semibold">
            {t("overview.focus.stageByPhase")}
          </h3>
          <StagePhaseBars stages={stageByPhase(data)} />
        </Panel>
      )}
      <CasesBehind
        scoreKind={"scoreKind" in content ? content.scoreKind : "shown"}
        ids={filtered}
        cases={data.cases}
        filterLabel={card === "geografi" && pick ? countryName(pick, language) : null}
        onClearFilter={() => setPick(null)}
      />
    </FocusPage>
  );
}

/** The old bar view of stage by phase, fed from the same case list (so it adds up). */
function stageByPhase(data: OverviewSnapshot) {
  const byStage = new Map<
    string,
    {
      stage: string;
      total: number;
      created: number;
      screened: number;
      deep: number;
      committee: number;
    }
  >();
  for (const id of data.lists.stage) {
    const ref = data.cases[id];
    if (!ref) continue;
    const key = stageKeyOf(ref.stageLabel, data);
    const entry = byStage.get(key) ?? {
      stage: key,
      total: 0,
      created: 0,
      screened: 0,
      deep: 0,
      committee: 0,
    };
    entry.total += 1;
    if (ref.phase === "committee") entry.committee += 1;
    else if (ref.phase === "deep_analysis") entry.deep += 1;
    else entry.screened += 1;
    byStage.set(key, entry);
  }
  return [...byStage.values()];
}

function stageKeyOf(label: string | null, data: OverviewSnapshot): string {
  if (!label) return "unknown";
  return data.stages.find((slice) => slice.label === label)?.key ?? "unknown";
}

function TasksFocus({
  data,
  fundId,
  onBack,
}: {
  data: OverviewSnapshot;
  fundId: string;
  onBack: () => void;
}) {
  const load = useServerFn(listFundOpenTasks);
  const t = useT();
  const language = useLanguage();
  const [scope, setScope] = useState<TaskScope>("mine");
  const query = useQuery({
    queryKey: ["overview-tasks", fundId],
    queryFn: () => load({ data: { fundId } }),
    retry: false,
  });
  const now = useNow();
  const tasks = useMemo(
    () => sortTasks(scopedTasks(query.data ?? [], scope), now),
    [query.data, scope, now],
  );
  const overdue = tasks.filter((task) => isOverdue(task, now)).length;
  return (
    <FocusPage
      backLabel={t("nav.overview")}
      onBack={onBack}
      title={scope === "mine" ? t("overview.tasks.titleMine") : t("overview.tasks.titleAll")}
      subtitle={<Lead>{t("overview.tasks.lead")}</Lead>}
      actions={
        // Every fund member can read every task (row-level security), so this is a view choice.
        <SegmentedControl<TaskScope>
          aria-label={t("overview.tasks.scopeAria")}
          value={scope}
          onChange={setScope}
          options={[
            { value: "mine", label: t("overview.tasks.mine") },
            { value: "all", label: t("overview.tasks.all") },
          ]}
        />
      }
    >
      {query.isLoading && <LoadingState title={t("overview.tasks.loading")} />}
      {query.isError && (
        <ErrorState title={t("overview.tasks.loadError")} onRetry={() => void query.refetch()} />
      )}
      {query.data && (
        <>
          <TasksList tasks={tasks} now={now} />
          <FocusStats
            stats={[
              { label: t("overview.tasks.open"), value: tasks.length },
              { label: t("overview.tasks.overdue"), value: overdue },
              {
                label: t("overview.tasks.cases"),
                value: new Set(tasks.map((task) => task.caseId)).size,
              },
            ]}
          />
          <Meaning
            lines={[
              ...tasksMeaning(
                {
                  ...data,
                  tasks: {
                    open: tasks.length,
                    overdue,
                    cases: new Set(tasks.map((task) => task.caseId)).size,
                  },
                },
                language,
              ),
              ...(tasks.length > 0 ? [t("overview.tasks.overdueFirst")] : []),
            ]}
          />
        </>
      )}
    </FocusPage>
  );
}
