/**
 * A specialist's criteria on its card on Konklusion, in the type the card's buttons chose:
 * columns and bars against the screening, dot columns, radar, "from screening" lines, rings,
 * contribution to the score and the score on a gauge. The chart fills the card; the only text is
 * the criteria's names, their scores and "Screening" / "Deep analysis".
 */
import { motion, useReducedMotion } from "motion/react";
import { BarChart } from "@/components/charts/bar-chart";
import { BarColumnTrack, BarSquares } from "@/components/charts/bar-squares";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { CriteriaContribution, CriteriaRings } from "@/components/charts/ChartTypeSwitcher";
import { Line } from "@/components/charts/line";
import { LineChart } from "@/components/charts/line-chart";
import { RadarArea } from "@/components/charts/radar-area";
import { RadarAxis } from "@/components/charts/radar-axis";
import { RadarChart } from "@/components/charts/radar-chart";
import { RadarGrid } from "@/components/charts/radar-grid";
import { RadarLabels } from "@/components/charts/radar-labels";
import type { ChartCriterionDatum } from "@/components/charts/use-chart-type";
import type { CriteriaVariant } from "@/lib/cases/card-variants";
import type { SpecialistGroup } from "@/lib/cases/deep-view";
import { formatScore } from "@/lib/cases/screening-view";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { CriteriaColumns, ScoreGauge } from "./CardFallbackCharts";

export function CriteriaChart({ type, group }: { type: CriteriaVariant; group: SpecialistGroup }) {
  if (type === "column") return <CriteriaColumns rows={group.criteria} color={group.color} />;
  if (type === "squares") return <CriteriaSquares group={group} />;
  if (type === "radar") return <CriteriaRadarMini group={group} />;
  if (type === "slope") return <CriteriaSlope group={group} />;
  if (type === "ring") return <CriteriaRings data={criteriaData(group)} compact />;
  if (type === "pie") return <CriteriaContribution data={criteriaData(group)} compact />;
  if (type === "gauge")
    return (
      <ScoreGauge
        width={400}
        score={group.score ?? 0}
        screening={group.screeningScore}
        color={group.color}
        label={group.label}
      />
    );
  return <CriteriaBarsMini group={group} />;
}

function criteriaData(group: SpecialistGroup): ChartCriterionDatum[] {
  return group.criteria.map((row) => ({
    key: row.criterionKey,
    label: row.label,
    score: row.score,
    weight: row.weight,
    compare: row.screeningScore,
    // One criterion is the specialist itself, so it takes the specialist's colour.
    color: group.criteria.length === 1 ? group.color : row.color,
  }));
}

function shortLabel(label: string, max: number) {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;
}

/** The criteria as a radar, the screening's shape behind the deep analysis's. */
function CriteriaRadarMini({ group }: { group: SpecialistGroup }) {
  const t = useT();
  // Only scored criteria are axes: an unscored one in the centre would read as 0.
  const rows = group.criteria.filter((row) => row.score !== null);
  const hasScreening = rows.every((row) => row.screeningScore !== null);
  const metrics = rows.map((row) => ({ key: row.criterionKey, label: row.label }));
  const data = [
    ...(hasScreening
      ? [
          {
            label: t("deep.cards.screening"),
            color: "var(--ink-3)",
            values: Object.fromEntries(
              rows.map((row) => [row.criterionKey, row.screeningScore ?? 0]),
            ),
          },
        ]
      : []),
    {
      label: t("deep.cards.deepAnalysis"),
      color: group.color,
      values: Object.fromEntries(rows.map((row) => [row.criterionKey, row.score ?? 0])),
    },
  ];
  return (
    <span className="block w-full max-w-[440px]" aria-hidden>
      <RadarChart data={data} metrics={metrics} margin={58} levels={3}>
        <RadarGrid showLabels={false} />
        <RadarAxis />
        <RadarLabels fontSize={11} offset={14} wrapChars={12} />
        {hasScreening && <RadarArea index={0} showPoints={false} showGlow={false} />}
        <RadarArea index={hasScreening ? 1 : 0} showGlow={false} />
      </RadarChart>
    </span>
  );
}

/** One bar per criterion with the screening score as a mark. */
function CriteriaBarsMini({ group }: { group: SpecialistGroup }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  return (
    <span className="flex w-full flex-col gap-5">
      {group.criteria.map((row, index) => (
        <span key={row.criterionKey} className="flex flex-col gap-2">
          <span className="flex items-baseline justify-between gap-3 text-list">
            <span className="min-w-0 truncate text-ink-2">{row.label}</span>
            <span className="font-semibold">{formatScore(row.score, language)}</span>
          </span>
          <span className="relative h-3.5 rounded-[7px] bg-[var(--chart-track)]">
            <motion.span
              className="absolute inset-y-0 left-0 block rounded-[7px]"
              style={{
                width: `${row.score ?? 0}%`,
                background: group.color,
                transformOrigin: "left",
              }}
              initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
              animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
              transition={
                reduced
                  ? REDUCED_FADE
                  : { duration: 0.9, ease: EASE.out, delay: 0.3 + index * 0.09 }
              }
            />
            {row.screeningScore !== null && (
              <span
                className="absolute -top-1 -bottom-1 w-0.5 rounded-[1px] bg-ink-3"
                style={{ left: `${row.screeningScore}%` }}
                title={t("deep.cards.atScreening", {
                  score: formatScore(row.screeningScore, language),
                })}
              />
            )}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Each criterion as a column of dots out of 100 (bklit `BarSquares` over an empty dot track),
 * its score above it.
 */
function CriteriaSquares({ group }: { group: SpecialistGroup }) {
  const language = useLanguage();
  const rows = group.criteria.map((row, index) => ({
    // Unique even when two criteria share a short name.
    name: `${shortLabel(row.label, 10)}${"\u200b".repeat(index)}`,
    score: row.score ?? 0,
  }));
  return (
    <span className="flex w-full flex-col gap-1" aria-hidden>
      <span className="flex w-full justify-around px-2 text-[15px] font-semibold tabular-nums">
        {group.criteria.map((row) => (
          <span key={row.criterionKey}>{formatScore(row.score, language)}</span>
        ))}
      </span>
      <BarChart
        data={rows}
        xDataKey="name"
        valueMax={100}
        aspectRatio="16 / 11"
        // Narrow columns, so each dot is small and a column holds about ten of them.
        barGap={0.78}
        margin={{ top: 8, right: 8, bottom: 32, left: 8 }}
      >
        <BarColumnTrack squareGap={3} squareRadius={0.5} />
        <BarSquares dataKey="score" fill={group.color} squareGap={3} squareRadius={0.5} />
        <BarXAxis showAllLabels maxLabels={rows.length} />
      </BarChart>
    </span>
  );
}

/** Screening → deep analysis: one line per criterion between the two runs (slope). */
function CriteriaSlope({ group }: { group: SpecialistGroup }) {
  const t = useT();
  const language = useLanguage();
  const rows = group.criteria.filter((row) => row.score !== null && row.screeningScore !== null);
  // The chart's y-axis starts at 0, which squeezes scores of 60–80 into a flat band at the top;
  // the lines are drawn from a floor just under the lowest score, so the changes can be seen (the
  // real scores stand in the list beside it).
  const values = rows.flatMap((row) => [row.score ?? 0, row.screeningScore ?? 0]);
  const floor = Math.max(0, Math.floor(Math.min(...values) / 5) * 5 - 5);
  // Two fixed points on the time axis; the axis itself is replaced by the two run names.
  const data = [
    {
      date: new Date(2026, 0, 1),
      ...Object.fromEntries(
        rows.map((row) => [row.criterionKey, (row.screeningScore ?? 0) - floor]),
      ),
    },
    {
      date: new Date(2026, 0, 2),
      ...Object.fromEntries(rows.map((row) => [row.criterionKey, (row.score ?? 0) - floor])),
    },
  ];
  return (
    <span className="flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-4">
      <span className="flex min-w-[220px] flex-[1_1_240px] flex-col" aria-hidden>
        <LineChart
          data={data}
          aspectRatio="4 / 3"
          margin={{ top: 16, right: 12, bottom: 8, left: 12 }}
        >
          {rows.map((row) => (
            <Line
              key={row.criterionKey}
              dataKey={row.criterionKey}
              stroke={row.color}
              strokeWidth={2.5}
              showMarkers
              showHighlight={false}
            />
          ))}
        </LineChart>
        <span className="flex justify-between px-1 text-micro text-ink-3">
          <span>{t("deep.cards.screening")}</span>
          <span>{t("deep.cards.deepAnalysis")}</span>
        </span>
      </span>
      <span className="grid gap-2 text-list">
        {rows.map((row) => {
          const delta = Math.round((row.score ?? 0) - (row.screeningScore ?? 0));
          return (
            <span
              key={row.criterionKey}
              className="grid grid-cols-[10px_auto_auto] items-center gap-x-2.5"
            >
              <span className="size-2 rounded-full" style={{ background: row.color }} />
              <span className="truncate text-ink-2" title={row.label}>
                {row.label}
              </span>
              <span className="tabular-nums">
                <span className="font-semibold text-ink">{formatScore(row.score, language)}</span>{" "}
                <span
                  className={
                    delta < 0 ? "text-critical" : delta > 0 ? "text-positive" : "text-ink-4"
                  }
                >
                  {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : "±0"}
                </span>
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
