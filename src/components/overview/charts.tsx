/**
 * The Overblik v2 charts, ported from the prototype's markup (bars, heat grid, donut). Timing
 * follows the chart presets (src/lib/charts/presets.ts: bars grow 800–900 ms ease-out with a
 * 40–90 ms stagger) and ("Data-opdatering: animér mellem værdier, tegn aldrig
 * forfra"): the enter animation is keyed by the item, so a new period tweens the widths and
 * heights (CSS transition, 600 ms) instead of drawing again. Reduced motion: no growing.
 * Every chart has the numbers as text (the count beside the bar, `title`, aria-label).
 */
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CountUp } from "@/components/ds/CountUp";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { chartPreset } from "@/lib/charts/presets";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { EASE } from "@/lib/motion";
import type { FunnelKey, FunnelResult, IntakeResult } from "@/lib/overview/funnel";
import { stageColor } from "@/lib/overview/stage-color";
import {
  thresholdPosition,
  type HeatColumn,
  type HeatRow,
  type ScoreBin,
  type StageSlice,
} from "@/lib/overview/snapshot";

const FUNNEL_COLOR: Record<FunnelKey, string> = {
  in: "var(--ink-2)",
  screened: "var(--action)",
  over: "var(--positive)",
  deep: "var(--ai)",
  committee: "var(--warning)",
  invested: "var(--series-8)",
};

const FUNNEL_LABEL: Record<FunnelKey, MessageKey> = {
  in: "overview.funnel.in",
  screened: "overview.funnel.screened",
  over: "overview.funnel.over",
  deep: "overview.funnel.deep",
  committee: "overview.funnel.committee",
  invested: "overview.funnel.invested",
};

const GROW = chartPreset("overblik-tragt").motion;
const BARS = chartPreset("overblik-tilgang").motion;

/** Pipeline funnel: six bars, count and % of new cases. `large` is the sub-page's size. */
export function FunnelBars({ funnel, large = false }: { funnel: FunnelResult; large?: boolean }) {
  const reduced = useReducedMotion();
  const t = useT();
  const total = Math.max(1, funnel.cohort);
  return (
    <ol
      aria-label={t("overview.cards.pipeline")}
      className={`m-0 flex list-none flex-col p-0 ${large ? "gap-4" : "gap-2.5"}`}
    >
      {funnel.steps.map((step, index) => (
        <li
          key={step.key}
          className={
            large
              ? "grid grid-cols-[minmax(96px,140px)_minmax(0,1fr)_44px_56px] items-center gap-3.5"
              : "grid grid-cols-[minmax(84px,110px)_minmax(0,1fr)_34px_44px] items-center gap-3"
          }
        >
          <span className={`whitespace-nowrap text-ink-2 ${large ? "text-[15px]" : "text-list"}`}>
            {t(FUNNEL_LABEL[step.key])}
          </span>
          <div
            className={`bg-chart-track ${large ? "h-4 rounded-lg" : "h-2.5 rounded-[5px]"}`}
            aria-hidden
          >
            <motion.div
              className={`h-full ${large ? "rounded-lg" : "rounded-[5px]"}`}
              style={{
                width: `${(step.count / total) * 100}%`,
                background: FUNNEL_COLOR[step.key],
                transformOrigin: "left",
                transition: reduced ? "none" : "width 600ms var(--ease-standard)",
              }}
              initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
              animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
              transition={{
                duration: GROW.enter.kind === "ease" ? GROW.enter.durationMs / 1000 : 0.9,
                ease: EASE.out,
                delay: reduced ? 0 : index * (GROW.staggerMs / 1000),
              }}
            />
          </div>
          <span
            className={`text-right font-semibold tabular-nums ${large ? "text-[18px]" : "text-[15px]"}`}
          >
            <CountUp value={step.count} />
          </span>
          <span
            className={`text-right text-ink-4 tabular-nums ${large ? "text-list" : "text-meta"}`}
          >
            {step.percent === null ? "" : `${step.percent} %`}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Tilgang: new cases per week, filled with the share sent on (the "AI" colour). */
export function IntakeBarsChart({
  intake,
  large = false,
}: {
  intake: IntakeResult;
  large?: boolean;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const max = Math.max(1, ...intake.bars.map((bar) => bar.total));
  const unit =
    intake.weeksPerBar === 1
      ? t("overview.charts.unitWeek")
      : t("overview.charts.unitWeeks", { count: intake.weeksPerBar });
  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="img"
        aria-label={t("overview.charts.intakeAria", {
          total: intake.total,
          forwarded: intake.forwarded,
          bars: intake.bars.length,
          unit,
        })}
        className={`flex items-end ${large ? "h-60 gap-2" : "h-[120px] gap-[5px]"}`}
      >
        {intake.bars.map((bar, index) => (
          <div
            key={index}
            title={t("overview.page.newAndForwarded", {
              total: bar.total,
              forwarded: bar.forwarded,
            })}
            className="flex h-full flex-1 flex-col justify-end"
          >
            <motion.div
              className={`relative overflow-hidden bg-chart-track ${large ? "rounded-[8px_8px_3px_3px]" : "rounded-[6px_6px_3px_3px]"}`}
              style={{
                height: `${bar.total === 0 ? 0 : Math.max(6, (bar.total / max) * 100)}%`,
                transformOrigin: "bottom",
                transition: reduced ? "none" : "height 600ms var(--ease-standard)",
              }}
              initial={reduced ? { opacity: 0 } : { scaleY: 0 }}
              animate={reduced ? { opacity: 1 } : { scaleY: 1 }}
              transition={{
                duration: BARS.enter.kind === "ease" ? BARS.enter.durationMs / 1000 : 0.8,
                ease: EASE.out,
                delay: reduced ? 0 : index * (BARS.staggerMs / 1000),
              }}
            >
              <div
                className="absolute inset-x-0 bottom-0 bg-ai"
                style={{
                  height: `${bar.total ? (bar.forwarded / bar.total) * 100 : 0}%`,
                  transition: reduced ? "none" : "height 600ms var(--ease-standard)",
                }}
              />
            </motion.div>
          </div>
        ))}
      </div>
      <div className={`flex justify-between text-ink-4 ${large ? "text-meta" : "text-micro"}`}>
        <span>
          {t("overview.charts.weeksAgo", { count: intake.bars.length * intake.weeksPerBar })}
        </span>
        <span>{t("overview.drift.today")}</span>
      </div>
    </div>
  );
}

/** Scorefordeling: five bars and the threshold as a dashed line. */
export function ScoreHistogram({
  bins,
  threshold,
  large = false,
}: {
  bins: readonly ScoreBin[];
  threshold: number;
  large?: boolean;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const max = Math.max(1, ...bins.map((bin) => bin.count));
  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="img"
        aria-label={t("overview.charts.scoreAria", {
          bins: bins.map((bin) => `${bin.label}: ${bin.count}`).join(", "),
          threshold,
        })}
        className={`relative flex items-end ${large ? "h-60 gap-3.5" : "h-[120px] gap-2"}`}
      >
        {bins.map((bin, index) => (
          <div
            key={bin.label}
            className={`flex h-full flex-1 flex-col items-center justify-end ${large ? "gap-1.5" : "gap-1"}`}
          >
            <span
              className={`font-semibold tabular-nums ${large ? "text-list text-ink-1" : "text-micro text-ink-2"}`}
            >
              {bin.count || ""}
            </span>
            <motion.div
              className={`w-full ${large ? "rounded-[10px_10px_3px_3px]" : "rounded-[8px_8px_3px_3px]"}`}
              style={{
                height: `${bin.count === 0 ? 4 : Math.max(4, (bin.count / max) * 90)}%`,
                background:
                  bin.to > threshold
                    ? "var(--positive)"
                    : "color-mix(in srgb, var(--positive) 28%, var(--bg-sunken))",
                transformOrigin: "bottom",
                transition: reduced ? "none" : "height 600ms var(--ease-standard)",
              }}
              initial={reduced ? { opacity: 0 } : { scaleY: 0 }}
              animate={reduced ? { opacity: 1 } : { scaleY: 1 }}
              transition={{
                duration: 0.8,
                ease: EASE.out,
                delay: reduced ? 0 : index * 0.07,
              }}
            />
          </div>
        ))}
        <div
          aria-hidden
          className={`absolute top-0 bottom-0 border-l-ink-2 ${large ? "border-l-2" : "border-l-[1.5px]"} border-dashed`}
          style={{ left: `${thresholdPosition(threshold) * 100}%` }}
        />
      </div>
      <div className={`flex justify-between text-ink-4 ${large ? "text-meta" : "text-micro"}`}>
        {bins.map((bin) => (
          <span key={bin.label}>{bin.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Sektor og fase: sector rows × stage columns, one tint of "action" per count. */
export function HeatGrid({
  columns,
  rows,
  large = false,
  maxRows,
}: {
  columns: readonly HeatColumn[];
  rows: readonly HeatRow[];
  large?: boolean;
  /** The card shows the biggest sectors only; the sub-page shows all. */
  maxRows?: number;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  const max = Math.max(1, ...shown.flatMap((row) => row.cells));
  const hidden = rows.length - shown.length;
  return (
    <div className="flex flex-col gap-2">
      <div
        role="table"
        aria-label={t("overview.charts.heatAria")}
        className={`grid items-center ${large ? "gap-1.5" : "gap-1"}`}
        style={{
          gridTemplateColumns: `minmax(${large ? 160 : 130}px,1.3fr) repeat(${columns.length},minmax(0,1fr))`,
        }}
      >
        <span aria-hidden />
        {columns.map((column) => (
          <span
            key={column.key}
            role="columnheader"
            className={`whitespace-nowrap pb-1 text-center text-ink-4 ${large ? "text-meta" : "text-micro"}`}
          >
            {column.label}
          </span>
        ))}
        {shown.map((row, r) => (
          <HeatLine
            key={row.label}
            row={row}
            r={r}
            max={max}
            large={large}
            reduced={Boolean(reduced)}
            columnCount={columns.length}
          />
        ))}
      </div>
      {hidden > 0 && (
        <span className="text-meta text-ink-4">
          {t("overview.charts.moreSectors", { count: hidden })}
        </span>
      )}
    </div>
  );
}

function HeatLine({
  row,
  r,
  max,
  large,
  reduced,
  columnCount,
}: {
  row: HeatRow;
  r: number;
  max: number;
  large: boolean;
  reduced: boolean;
  columnCount: number;
}) {
  return (
    <>
      <span
        role="rowheader"
        className={`line-clamp-2 pr-1.5 leading-tight text-ink-2 ${large ? "text-[15px]" : "text-list"}`}
        title={row.label}
      >
        {row.label}
      </span>
      {row.cells.map((count, k) => (
        <motion.span
          key={k}
          role="cell"
          aria-label={count ? `${count}` : "0"}
          className={`grid place-items-center font-semibold ${large ? "h-12 rounded-[10px] text-[15px]" : "h-[34px] rounded-lg text-meta"}`}
          style={{
            background: count
              ? `color-mix(in srgb, var(--action) ${30 + (70 * count) / max}%, var(--bg-surface))`
              : "var(--bg-sunken)",
            color: count / max > 0.5 ? "#fff" : "var(--ink-1)",
          }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: [0.4, 1.1, 1] }}
          transition={{
            duration: 0.46,
            ease: EASE.standard,
            ...(reduced ? {} : { times: [0, 0.7, 1] }),
            delay: reduced ? 0 : (r * columnCount + k) * 0.025,
          }}
        >
          {count || ""}
        </motion.span>
      ))}
    </>
  );
}

/** Stadie: a donut with a legend; the segments follow the ring preset. */
export function StageDonut({
  stages,
  size = 130,
}: {
  stages: readonly StageSlice[];
  size?: number;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const preset = chartPreset("overblik-stadie");
  const [hover, setHover] = useState<number | null>(null);
  const total = stages.reduce((sum, slice) => sum + slice.count, 0);
  const large = size > 160;
  return (
    <div className={`flex flex-wrap items-center ${large ? "justify-center gap-10" : "gap-5"}`}>
      <div className="flex-none" style={{ width: size, height: size }}>
        <PieChart
          data={stages.map((slice, index) => ({
            label: slice.label,
            value: slice.count,
            color: stageColor(slice.key),
          }))}
          size={size}
          innerRadius={Math.round(size * 0.35)}
          padAngle={((preset.geometry.gap ?? 1.2) / 100) * Math.PI * 2}
          cornerRadius={0}
          hoveredIndex={hover}
          onHoverChange={setHover}
          {...(reduced ? {} : { enterTransition: { duration: 0.9, ease: EASE.out } })}
        >
          {stages.map((slice, index) => (
            <PieSlice key={slice.key} index={index} hoverEffect="grow" hoverOffset={4} />
          ))}
        </PieChart>
      </div>
      <ul
        aria-label={t("overview.charts.stagesAria", { count: total })}
        className={`m-0 flex list-none flex-col p-0 ${large ? "gap-3" : "gap-2"}`}
      >
        {stages.map((slice, index) => (
          <li
            key={slice.key}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center whitespace-nowrap ${large ? "gap-2.5 text-[16px]" : "gap-2 text-list"}`}
          >
            <span
              className={`rounded-full ${large ? "size-2.5" : "size-2"}`}
              style={{ background: stageColor(slice.key) }}
              aria-hidden
            />
            {slice.label}
            <b className="ml-1 font-semibold tabular-nums">{slice.count}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
