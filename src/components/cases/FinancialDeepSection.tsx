/**
 * Building blocks of the Økonomi sub-pages in the deep analysis (masterplan C6; canvas variants C
 * and B, 26/9-2026; put together in EconomyFocus.tsx): data coverage as dots, revenue and EBITDA
 * per year, bullet meters against thresholds and a coloured metric × year table. A click on a
 * cell shows "Sådan er det regnet". Everything is calculated in code (financial-metrics.ts).
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type {
  FinancialMetric,
  FinancialMetricsReport,
  MetricPoint,
} from "@/lib/analysis/financial-metrics";
import {
  currencySuffix,
  formatDkkCompact,
  formatMetricValue,
  metricColor,
} from "@/lib/analysis/financial-format";
import { cn } from "@/lib/utils";
import { EASE_ENTER, MOTION, staggerDelay } from "@/lib/motion";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/translate";
import { CalculationDetail } from "./CalculationDetail";

const TABLE_KEYS = [
  "revenue",
  "gross_profit",
  "gross_margin",
  "ebitda",
  "ebitda_margin",
  "net_result",
  "equity",
  "equity_ratio",
  "cash",
  "current_ratio",
  "employees",
];
const MAX_YEARS = 6;

function metric(report: FinancialMetricsReport, key: string): FinancialMetric | null {
  return report.metrics.find((item) => item.key === key) ?? null;
}

function hasValues(item: FinancialMetric | null): item is FinancialMetric {
  return Boolean(item?.series.some((point) => point.value !== null));
}

/** Datagrundlag: hvilke år der er dækket (prikker), regnskabsklasse, alder og balance. */
export function DataBand({
  report,
  reportingClass,
}: {
  report: FinancialMetricsReport;
  reportingClass: string | null;
}) {
  const t = useT();
  const years = report.years.map((year) => Number(year.slice(0, 4)));
  const first = Math.min(...years);
  const last = Math.max(...years);
  const span = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const age = metric(report, "latest_filing_age")?.latest?.value ?? null;
  const balance = metric(report, "balance_check")?.latest ?? null;
  const reportingClassShort =
    reportingClass?.match(/(?:class|klasse)\s+([A-D])\b/i)?.[1]?.toUpperCase() ?? null;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-meta text-ink-3">{t("finance.deepSection.financialYears")}</p>
        <div
          className="mt-2 flex items-center gap-1.5"
          role="img"
          aria-label={t("finance.deepSection.coverageAria", {
            covered: years.length,
            total: span.length,
            first,
            last,
          })}
        >
          {span.map((year, index) => {
            const covered = years.includes(year);
            return (
              <motion.span
                key={year}
                title={`${year}${covered ? "" : t("finance.deepSection.noStatementSuffix")}`}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  duration: MOTION.disclosure,
                  ease: EASE_ENTER,
                  delay: staggerDelay(index),
                }}
                className={cn(
                  "size-2.5 rounded-full",
                  covered ? "bg-ink-2" : "border-[1.5px] border-ink-4",
                )}
              />
            );
          })}
          <span className="ml-2 text-meta tabular-nums text-ink-3">
            {first}–{last}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 sm:flex sm:gap-8">
        <BandStat
          label={t("finance.deepSection.reportingClass")}
          value={reportingClassShort ?? "–"}
        />
        <BandStat
          label={t("finance.deepSection.latestFiling")}
          value={
            age === null ? "–" : t("finance.deepSection.monthsShort", { count: Math.round(age) })
          }
        />
        <BandStat
          label={t("finance.deepSection.balance")}
          value={
            balance?.value === null || !balance
              ? "–"
              : balance.value === 0
                ? t("finance.deepSection.balanceMatches")
                : t("finance.deepSection.balanceDiffers")
          }
        />
      </div>
    </div>
  );
}

function BandStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:text-right">
      <p className="text-meta text-ink-3">{label}</p>
      <p className="mt-1 text-body font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

/** Omsætning (eller bruttofortjeneste) og EBITDA pr. år, grupperede søjler. */
export function EarningsChart({ report }: { report: FinancialMetricsReport }) {
  const t = useT();
  const language = useLanguage();
  const revenue = metric(report, "revenue");
  const top =
    hasValues(revenue) && revenue.latest?.value !== null ? revenue : metric(report, "gross_profit");
  const ebitda = hasValues(metric(report, "ebitda"))
    ? metric(report, "ebitda")
    : metric(report, "ebit");
  if (!hasValues(top) && !hasValues(ebitda)) return null;
  const series = [top, ebitda].filter(hasValues);
  const years = report.years.slice(-MAX_YEARS);
  const pointFor = (item: FinancialMetric, year: string) =>
    item.series.find((point) => point.periodEnd === year) ?? null;
  const values = series.flatMap((item) => years.map((year) => pointFor(item, year)?.value ?? null));
  const present = values.filter((value): value is number => value !== null);
  const max = Math.max(0, ...present);
  const min = Math.min(0, ...present);
  const span = max - min || 1;
  const height = 200;
  const top0 = 14;
  const bottom = height - 8;
  const zeroY = top0 + (max / span) * (bottom - top0);
  const slot = 100 / years.length;
  const barWidth = Math.min(7, (slot * 0.7) / series.length);

  return (
    <figure>
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body font-semibold text-ink">
          {t("finance.deepSection.earningsPerYear")}
        </span>
        <span className="flex gap-3 text-meta text-ink-3">
          {series.map((item) => (
            <span key={item.key} className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-[2px]"
                style={{ background: metricColor(item.key) }}
                aria-hidden
              />
              {item.label.split(" (")[0]}
            </span>
          ))}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="mt-3 h-[200px] w-full"
        role="img"
        aria-label={t("finance.deepSection.earningsPerYear")}
      >
        <line
          x1="0"
          x2="100"
          y1={zeroY}
          y2={zeroY}
          stroke="var(--ink-4)"
          strokeOpacity={0.5}
          vectorEffect="non-scaling-stroke"
        />
        {years.map((year, yearIndex) =>
          series.map((item, seriesIndex) => {
            const point = pointFor(item, year);
            if (!point || point.value === null) return null;
            const barHeight = Math.max(0.8, (Math.abs(point.value) / span) * (bottom - top0));
            const groupWidth = barWidth * series.length + 0.8 * (series.length - 1);
            const x = slot * yearIndex + (slot - groupWidth) / 2 + seriesIndex * (barWidth + 0.8);
            return (
              <motion.rect
                key={`${item.key}-${year}`}
                x={x}
                width={barWidth}
                y={point.value >= 0 ? zeroY - barHeight : zeroY}
                height={barHeight}
                rx={0.6}
                fill={metricColor(item.key)}
                fillOpacity={point.value < 0 ? 0.55 : 1}
                style={{
                  transformOrigin: `${x + barWidth / 2}px ${zeroY}px`,
                  transformBox: "view-box",
                }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{
                  duration: MOTION.panel,
                  ease: EASE_ENTER,
                  delay: staggerDelay(yearIndex),
                }}
              >
                <title>{`${item.label} ${year.slice(0, 4)}: ${formatMetricValue(item, point.value, language)}${item.currency ? "" : ` ${currencySuffix(undefined, language)}`}`}</title>
              </motion.rect>
            );
          }),
        )}
      </svg>
      <div
        className="mt-1 grid"
        style={{ gridTemplateColumns: `repeat(${years.length}, minmax(0, 1fr))` }}
      >
        {years.map((year) => (
          <span key={year} className="text-center text-meta text-ink-4">
            {year.slice(0, 4)}
          </span>
        ))}
      </div>
    </figure>
  );
}

interface BulletSpec {
  key: string;
  label: MessageKey;
  target: number;
  good: number;
  max: number;
  caption: MessageKey;
}

/** Standardtærskler fra research 07; fondens egne tærskler kommer med C7. */
const BULLETS: BulletSpec[] = [
  {
    key: "equity_ratio",
    label: "finance.deepSection.solidity",
    target: 30,
    good: 40,
    max: 60,
    caption: "finance.deepSection.solidityCaption",
  },
  {
    key: "current_ratio",
    label: "finance.deepSection.liquidity",
    target: 1,
    good: 1.5,
    max: 2.5,
    caption: "finance.deepSection.liquidityCaption",
  },
  {
    key: "runway_today",
    label: "finance.deepSection.runwayToday",
    target: 12,
    good: 18,
    max: 36,
    caption: "finance.deepSection.runwayCaption",
  },
];

/** Poster i resultatbroen, i rækkefølge. Mellem to kendte poster vises forskellen. */
const BRIDGE_TOTALS: Array<{ key: string; label: MessageKey }> = [
  { key: "revenue", label: "finance.deepSection.bridgeRevenue" },
  { key: "gross_profit", label: "finance.deepSection.bridgeGrossProfit" },
  { key: "ebitda", label: "finance.deepSection.bridgeEbitda" },
  { key: "ebit", label: "finance.deepSection.bridgeEbit" },
  { key: "net_result", label: "finance.deepSection.bridgeNetResult" },
];

const BRIDGE_STEPS: Record<string, MessageKey> = {
  "revenue>gross_profit": "finance.deepSection.stepRevenueToGross",
  "gross_profit>ebitda": "finance.deepSection.stepGrossToEbitda",
  "ebitda>ebit": "finance.deepSection.stepEbitdaToEbit",
  "ebit>net_result": "finance.deepSection.stepEbitToNet",
};

/**
 * Resultatbro (vandfald) for seneste regnskabsår: fra omsætning (eller bruttofortjeneste
 * i klasse B) til årets resultat. Kun poster, regnskabet har, og alt regnet i kode.
 */
export function ResultBridge({ report }: { report: FinancialMetricsReport }) {
  const t = useT();
  const language = useLanguage();
  const year = [...report.years]
    .reverse()
    .find(
      (candidate) =>
        BRIDGE_TOTALS.filter((total) =>
          metric(report, total.key)?.series.some(
            (point) => point.periodEnd === candidate && point.value !== null,
          ),
        ).length >= 2,
    );
  if (!year) return null;
  const totals = BRIDGE_TOTALS.flatMap((total) => {
    const value =
      metric(report, total.key)?.series.find((point) => point.periodEnd === year)?.value ?? null;
    return value === null ? [] : [{ ...total, value }];
  });
  type Row = {
    label: string;
    from: number;
    to: number;
    kind: "total" | "up" | "down";
    key: string;
  };
  const rows: Row[] = [];
  totals.forEach((total, index) => {
    const previous = totals[index - 1];
    if (previous) {
      const delta = total.value - previous.value;
      rows.push({
        key: `${previous.key}>${total.key}`,
        label: t(BRIDGE_STEPS[`${previous.key}>${total.key}`] ?? "finance.deepSection.stepOther"),
        from: previous.value,
        to: total.value,
        kind: delta >= 0 ? "up" : "down",
      });
    }
    rows.push({ key: total.key, label: t(total.label), from: 0, to: total.value, kind: "total" });
  });
  const values = rows.flatMap((row) => [row.from, row.to]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const pos = (value: number) => ((value - min) / span) * 100;
  return (
    <figure>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body font-semibold text-ink">
          {t("finance.deepSection.bridgeTitle")}
        </span>
        <span className="text-meta text-ink-3">
          {t("finance.deepSection.bridgeMeta", { year: year.slice(0, 4) })}
        </span>
      </figcaption>
      <ol
        className="mt-3 grid gap-1.5"
        aria-label={t("finance.deepSection.bridgeAria", { year: year.slice(0, 4) })}
      >
        {rows.map((row) => {
          const left = pos(Math.min(row.from, row.to));
          const width = Math.max(0.6, Math.abs(pos(row.to) - pos(row.from)));
          const value = row.kind === "total" ? row.to : row.to - row.from;
          return (
            <li
              key={row.key}
              className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-x-3 gap-y-1 text-list sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_72px]"
            >
              <span
                title={row.label}
                className={cn(
                  "order-1 min-w-0 leading-tight sm:truncate",
                  row.kind === "total" ? "font-medium text-ink" : "pl-3 text-ink-3",
                )}
              >
                {row.label}
              </span>
              {/* Mobil: søjlen får sin egen fulde række under navn og tal. */}
              <span className="relative order-3 col-span-2 h-3 rounded-[3px] bg-surface-soft sm:order-2 sm:col-span-1 sm:h-4">
                <span
                  className="absolute inset-y-0 rounded-[3px]"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background:
                      row.kind === "total"
                        ? metricColor(row.key)
                        : row.kind === "up"
                          ? "color-mix(in oklab, var(--series-1) 55%, var(--surface))"
                          : "color-mix(in oklab, var(--warning) 55%, var(--surface))",
                  }}
                />
              </span>
              <span
                className={cn(
                  "order-2 text-right tabular-nums sm:order-3",
                  row.kind === "total" ? "font-semibold text-ink" : "text-ink-3",
                )}
              >
                {row.kind !== "total" && value > 0 ? "+" : ""}
                {formatDkkCompact(value, language)}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

export function ThresholdBullets({ report }: { report: FinancialMetricsReport }) {
  const t = useT();
  const language = useLanguage();
  const reduceMotion = useReducedMotion();
  const items = BULLETS.flatMap((spec) => {
    const item = metric(report, spec.key);
    return item?.latest?.value !== null && item?.latest ? [{ spec, item, point: item.latest }] : [];
  });
  if (!items.length) return null;
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {items.map(({ spec, item, point }, index) => {
        const scale = (value: number) => Math.max(0, Math.min(100, (value / spec.max) * 100));
        return (
          <div key={spec.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-meta text-ink-3">{t(spec.label)}</span>
              <span className="text-body font-semibold tabular-nums text-ink">
                {formatMetricValue(item, point.value!, language)}
              </span>
            </div>
            <svg
              viewBox="0 0 100 14"
              preserveAspectRatio="none"
              className="mt-2 h-3.5 w-full"
              aria-label={`${t(spec.label)} ${formatMetricValue(item, point.value!, language)}, ${t(spec.caption)}`}
              role="img"
            >
              <rect
                x="0"
                y="2"
                width={scale(spec.target)}
                height="10"
                fill="var(--ink)"
                fillOpacity={0.05}
              />
              <rect
                x={scale(spec.target)}
                y="2"
                width={scale(spec.good) - scale(spec.target)}
                height="10"
                fill="var(--ink)"
                fillOpacity={0.09}
              />
              <rect
                x={scale(spec.good)}
                y="2"
                width={100 - scale(spec.good)}
                height="10"
                fill="var(--ink)"
                fillOpacity={0.14}
              />
              <motion.rect
                x="0"
                y="5"
                height="4"
                rx="1"
                fill={metricColor(item.key)}
                initial={reduceMotion ? false : { width: 0 }}
                animate={{ width: scale(point.value!) }}
                transition={{
                  duration: MOTION.number,
                  ease: EASE_ENTER,
                  delay: staggerDelay(index),
                }}
              />
              <line
                x1={scale(spec.target)}
                x2={scale(spec.target)}
                y1="0"
                y2="14"
                stroke="var(--ink)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <p className="mt-1.5 text-meta text-ink-4">
              {t(spec.caption)}
              {point.status === "estimat" ? ` · ${t("finance.kpi.estimate")}` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Nøgletal × år; cellens farvetone viser niveauet i rækken. Klik for beregningen. */
export function MetricTable({ report }: { report: FinancialMetricsReport }) {
  const t = useT();
  const language = useLanguage();
  const years = report.years.slice(-MAX_YEARS);
  const rows = useMemo(
    () => TABLE_KEYS.map((key) => metric(report, key)).filter(hasValues),
    [report],
  );
  const [selected, setSelected] = useState<{ key: string; year: string } | null>(null);
  if (!rows.length) return null;
  const selectedMetric = selected ? (rows.find((row) => row.key === selected.key) ?? null) : null;
  const selectedPoint =
    selected && selectedMetric
      ? (selectedMetric.series.find((point) => point.periodEnd === selected.year) ?? null)
      : null;

  return (
    <div>
      <p className="text-body font-semibold text-ink">{t("finance.deepSection.metricsTitle")}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-[3px] text-list tabular-nums">
          <thead>
            <tr>
              <th className="w-[34%] text-left text-meta font-normal text-ink-4" scope="col">
                <span className="sr-only">{t("finance.deepSection.metricsColumn")}</span>
              </th>
              {years.map((year) => (
                <th key={year} scope="col" className="text-right text-meta font-normal text-ink-4">
                  {year.slice(0, 4)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const points = years.map(
                (year) => row.series.find((point) => point.periodEnd === year) ?? null,
              );
              const present = points
                .map((point) => point?.value)
                .filter((value): value is number => value !== null && value !== undefined);
              const low = Math.min(...present);
              const high = Math.max(...present);
              return (
                <tr key={row.key}>
                  <th scope="row" className="pr-2 text-left font-normal text-ink-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: metricColor(row.key) }}
                        aria-hidden
                      />
                      {row.label}
                    </span>
                  </th>
                  {points.map((point, index) => (
                    <td key={years[index]} className="p-0">
                      {point && point.value !== null ? (
                        <button
                          type="button"
                          onClick={() =>
                            setSelected(
                              selected?.key === row.key && selected.year === point.periodEnd
                                ? null
                                : { key: row.key, year: point.periodEnd },
                            )
                          }
                          aria-pressed={
                            selected?.key === row.key && selected.year === point.periodEnd
                          }
                          className={cn(
                            "w-full rounded-[4px] px-2 py-1.5 text-right text-ink transition-shadow focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action",
                            selected?.key === row.key &&
                              selected.year === point.periodEnd &&
                              "ring-1 ring-ink/40",
                          )}
                          style={{
                            background: `color-mix(in oklab, ${metricColor(row.key)} ${Math.round(
                              8 + ((point.value - low) / (high - low || 1)) * 30,
                            )}%, transparent)`,
                          }}
                        >
                          {formatMetricValue(row, point.value, language)}
                        </button>
                      ) : (
                        <span className="block px-2 py-1.5 text-right text-ink-4">–</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AnimatePresence initial={false}>
        {selectedMetric && selectedPoint && (
          <motion.div
            key={`${selectedMetric.key}-${selectedPoint.periodEnd}`}
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: MOTION.disclosure, ease: EASE_ENTER }}
          >
            <CalculationDetail
              metric={selectedMetric}
              point={selectedPoint as MetricPoint}
              currency={report.currency}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
