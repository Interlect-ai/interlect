/**
 * The Økonomi tab's three charts (Case Dyb analyse v5, lines 173–207), drawn from the figures
 * the code calculated (`economyView`, `unitEconomics`). They follow the prototype's own markup
 * (viewBox, radii, strokes, hover band and dark tooltip); the bklit composed and area charts
 * from the presets `omsaetning-margin` and `likviditet-runway` are not vendored in this
 * repository yet (presets `available: false`), so the charts are plain SVG/HTML's
 * Finanser page. Motion: bars grow from the bottom, the line draws in, the dots
 * pop; reduced motion is a short fade.
 *
 * Nothing is invented: a year without a figure has no bar, the projection is drawn only when
 * the code could calculate the runway at the balance date, and the margin line only between
 * years that have a margin.
 */
import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { currencySuffix, formatDkkCompact } from "@/lib/analysis/financial-format";
import type { EconomyView, UnitEconomicsView } from "@/lib/cases/deep-view";
import { calculationValue } from "@/lib/cases/economy-text";
import { CASH_FRAME, REVENUE_FRAME, cashLayout, revenueMarginLayout } from "@/lib/charts/layouts";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";

function useMotionPrefs() {
  const reduced = Boolean(useReducedMotion());
  return {
    reduced,
    fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE },
  };
}

/** Revenue (else gross profit) as bars and the gross margin as a line with hollow dots. */
export function RevenueMarginChart({ view }: { view: EconomyView }) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const percentFormat = useMemo(
    () => new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 }),
    [localeTag],
  );
  const { reduced, fade } = useMotionPrefs();
  const [hover, setHover] = useState<number | null>(null);
  const card = view.revenueCard;
  if (!card) return null;
  const years = view.years;
  const pick = (year: EconomyView["years"][number]) =>
    card.series === "revenue" ? year.revenue : year.grossProfit;
  const { left, right, top, base } = REVENUE_FRAME;
  const layout = revenueMarginLayout(
    years.map(pick),
    years.map((year) => year.margin),
  );
  const { slot, bars, marginPoints, marginPath } = layout;
  const cx = (index: number) => layout.cx[index]!;
  const grid = layout.grid.map((line) => ({
    y: line.y,
    label: formatDkkCompact(line.value, language),
  }));
  const seriesLabel =
    card.series === "revenue" ? t("finance.kpi.revenue") : t("finance.kpi.grossProfit");
  const hovered = hover === null ? null : years[hover];

  return (
    <div className="relative">
      <svg
        viewBox="0 0 560 240"
        width="100%"
        className="block overflow-visible"
        role="img"
        aria-label={t(
          card.hasMargin ? "finance.charts.ariaRevenueMargin" : "finance.charts.ariaRevenue",
          { series: seriesLabel },
        )}
      >
        {grid.map((line) => (
          <g key={line.y}>
            <line
              x1={left}
              x2={right}
              y1={line.y}
              y2={line.y}
              stroke="var(--line)"
              strokeDasharray="2 4"
            />
            <text x={left - 10} y={line.y + 4} textAnchor="end" fontSize={11} fill="var(--ink-4)">
              {line.label}
            </text>
          </g>
        ))}
        {years.map((year, index) => {
          const bar = bars[index] ?? null;
          return (
            <g
              key={year.periodEnd}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              className="cursor-default"
            >
              <rect
                x={left + slot * index + 4}
                y={top - 2}
                width={slot - 8}
                height={base - top + 4}
                rx={10}
                fill={hover === index ? "var(--bg-hover)" : "transparent"}
                style={{ transition: "fill 200ms" }}
              />
              {bar && (
                <motion.rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx={8}
                  fill={
                    index === years.length - 1
                      ? "var(--series-1)"
                      : "color-mix(in srgb, var(--series-1) 45%, transparent)"
                  }
                  style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
                  initial={reduced ? { opacity: 0 } : { scaleY: 0 }}
                  animate={reduced ? { opacity: 1 } : { scaleY: 1 }}
                  transition={
                    reduced
                      ? REDUCED_FADE
                      : { duration: 0.9, ease: EASE.standard, delay: 0.2 + index * 0.08 }
                  }
                />
              )}
              <text x={cx(index)} y={236} textAnchor="middle" fontSize={12} fill="var(--ink-3)">
                {year.year}
              </text>
            </g>
          );
        })}
        {marginPoints.length > 1 && (
          <motion.path
            d={marginPath}
            fill="none"
            stroke="var(--series-8)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
            initial={reduced ? { opacity: 0 } : { pathLength: 0 }}
            animate={reduced ? { opacity: 1 } : { pathLength: 1 }}
            transition={reduced ? REDUCED_FADE : { duration: 1.2, ease: EASE.out, delay: 0.5 }}
          />
        )}
        {marginPoints.map((point, index) => (
          <motion.circle
            key={point.index}
            cx={point.x}
            cy={point.y}
            r={4.5}
            fill="var(--bg-canvas)"
            stroke="var(--series-8)"
            strokeWidth={2.5}
            pointerEvents="none"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            transition={
              reduced ? REDUCED_FADE : { duration: 0.4, ease: EASE.out, delay: 0.7 + index * 0.07 }
            }
          />
        ))}
      </svg>
      {hovered && hover !== null && (
        <motion.div
          key={hovered.periodEnd}
          className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col gap-1 rounded-xl bg-inverse px-3 py-2.5 text-meta whitespace-nowrap text-ink-inverse shadow-overlay"
          style={{ left: `${(cx(hover) / 560) * 100}%` }}
          {...(reduced
            ? fade
            : { initial: { opacity: 0, scale: 0.92 }, animate: { opacity: 1, scale: 1 } })}
          transition={reduced ? REDUCED_FADE : { duration: 0.22, ease: EASE.out }}
        >
          <span className="font-semibold">{hovered.year}</span>
          <span>
            {seriesLabel}{" "}
            {(card.series === "revenue" ? hovered.revenue : hovered.grossProfit) === null
              ? t("finance.charts.notReported")
              : `${formatDkkCompact((card.series === "revenue" ? hovered.revenue : hovered.grossProfit)!, language)} ${currencySuffix(view.currency, language)}`}
          </span>
          {card.hasMargin && (
            <span>
              {t("finance.charts.grossMargin")}{" "}
              {hovered.margin === null
                ? t("finance.charts.notReported")
                : `${percentFormat.format(hovered.margin)} %`}
            </span>
          )}
        </motion.div>
      )}
    </div>
  );
}

/** The legend next to the card title. */
export function RevenueMarginLegend({ view }: { view: EconomyView }) {
  const t = useT();
  const card = view.revenueCard;
  if (!card) return null;
  return (
    <>
      <span className="flex items-center gap-1.5 text-meta text-ink-3">
        <span className="size-2.5 rounded-[3px] bg-[var(--series-1)]" aria-hidden />
        {card.series === "revenue" ? t("finance.kpi.revenue") : t("finance.kpi.grossProfit")}
      </span>
      {card.hasMargin && (
        <span className="flex items-center gap-1.5 text-meta text-ink-3">
          <span className="h-0.5 w-3.5 rounded-[1px] bg-[var(--series-8)]" aria-hidden />
          {t("finance.charts.grossMargin")}
        </span>
      )}
    </>
  );
}

function parseDay(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
}

function addMonths(time: number, months: number): number {
  const date = new Date(time);
  date.setUTCMonth(date.getUTCMonth() + Math.floor(months));
  date.setUTCDate(date.getUTCDate() + Math.round((months % 1) * 30));
  return date.getTime();
}

/**
 * Cash at each balance date (an area) and, when the code could calculate the runway at the
 * balance date, a dashed projection to the month the money is used up (red marker). "I dag" is
 * marked when today lies inside the range.
 */
export function CashChart({ view, now }: { view: EconomyView; now: number }) {
  const t = useT();
  const language = useLanguage();
  const localeTag = useLocaleTag();
  const monthYear = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag, {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
    [localeTag],
  );
  const { reduced } = useMotionPrefs();
  const projection = view.cashCard?.projection ?? null;
  const points = view.years.flatMap((year) =>
    year.cash === null
      ? []
      : [{ time: parseDay(year.periodEnd), cash: year.cash, year: year.year }],
  );
  if (points.length === 0) return null;
  const endTime = projection
    ? addMonths(parseDay(projection.fromPeriodEnd), projection.months)
    : null;
  const layout = cashLayout(points, endTime, now);
  if (!layout) return null;
  const { left, right, floor, ceiling } = CASH_FRAME;
  const { t0, t1, zero, line, area } = layout;
  const gradientId = "cash-area-gradient";
  return (
    <svg
      viewBox="0 0 360 220"
      width="100%"
      className="block overflow-visible"
      role="img"
      aria-label={t(projection ? "finance.charts.ariaCashProjection" : "finance.charts.ariaCash")}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--series-5)" stopOpacity={0.32} />
          <stop offset="100%" stopColor="var(--series-5)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={left} x2={right} y1={zero} y2={zero} stroke="var(--line-strong)" />
      {points.length > 1 && (
        <>
          <motion.path
            d={area}
            fill={`url(#${gradientId})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9, delay: reduced ? 0 : 0.4 }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--series-5)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? { opacity: 0 } : { pathLength: 0 }}
            animate={reduced ? { opacity: 1 } : { pathLength: 1 }}
            transition={reduced ? REDUCED_FADE : { duration: 1.2, ease: EASE.out, delay: 0.2 }}
          />
        </>
      )}
      {points.map((point, index) => (
        <circle
          key={point.time}
          cx={layout.dots[index]!.x}
          cy={layout.dots[index]!.y}
          r={4}
          fill="var(--bg-canvas)"
          stroke="var(--series-5)"
          strokeWidth={2.5}
        >
          <title>{`${point.year}: ${formatDkkCompact(point.cash, language)} ${currencySuffix(view.currency, language)}`}</title>
        </circle>
      ))}
      {projection && endTime !== null && layout.projection && (
        <>
          <motion.path
            d={layout.projection.path}
            fill="none"
            stroke="var(--series-5)"
            strokeWidth={2}
            strokeDasharray="4 5"
            strokeLinecap="round"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: reduced ? 0 : 1.2 }}
          />
          <line
            x1={layout.projection.x}
            x2={layout.projection.x}
            y1={ceiling}
            y2={floor}
            stroke="var(--critical)"
            strokeWidth={1.5}
          />
          <text
            x={layout.projection.x}
            y={ceiling - 6}
            textAnchor="end"
            fontSize={11}
            fontWeight={600}
            fill="var(--critical)"
          >
            {monthYear.format(new Date(endTime))}
          </text>
        </>
      )}
      {layout.now !== null && (
        <>
          <line
            x1={layout.now}
            x2={layout.now}
            y1={20}
            y2={floor}
            stroke="var(--ink-4)"
            strokeDasharray="2 3"
          />
          <text x={layout.now} y={14} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
            {t("finance.charts.today")}
          </text>
        </>
      )}
      <text x={left} y={208} fontSize={11} fill="var(--ink-4)">
        {monthYear.format(new Date(t0))}
      </text>
      <text x={right} y={208} textAnchor="end" fontSize={11} fill="var(--ink-4)">
        {monthYear.format(new Date(endTime ?? t1))}
      </text>
    </svg>
  );
}

/**
 * LTV and CAC on one scale (only when both were calculated), then the ratio and the
 * payback as numbers. Values show with the unit the code calculated them in.
 */
export function UnitEconomicsBars({ view }: { view: UnitEconomicsView }) {
  const t = useT();
  const language = useLanguage();
  const { reduced } = useMotionPrefs();
  const pair = view.ltv && view.cac ? [view.ltv, view.cac] : [];
  const max = Math.max(1, ...pair.map((row) => row.value));
  const others = view.rows.filter(
    (row) => row.metric === "cac_payback" || (pair.length === 0 && row.metric !== "ltv_cac"),
  );
  return (
    <div className="flex flex-col gap-4">
      {pair.map((row, index) => (
        <div key={row.metric} className="flex flex-col gap-[7px]">
          <div className="flex justify-between gap-3 text-[14px]">
            <span className="text-ink-2">{row.metric === "ltv" ? "LTV" : "CAC"}</span>
            <span className="font-semibold tabular-nums">{calculationValue(row, language)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-[6px] bg-[var(--chart-track)]">
            <motion.div
              className="h-full rounded-[6px]"
              style={{
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                background: row.metric === "ltv" ? "var(--series-1)" : "var(--series-3)",
                transformOrigin: "left",
              }}
              initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
              animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
              transition={
                reduced
                  ? REDUCED_FADE
                  : { duration: 0.9, ease: EASE.out, delay: 0.25 + index * 0.1 }
              }
            />
          </div>
        </div>
      ))}
      {others.map((row) => (
        <div key={row.metric} className="flex justify-between gap-3 text-[14px]">
          <span className="text-ink-2">
            {
              {
                ltv: "LTV",
                cac: "CAC",
                cac_payback: t("finance.charts.payback"),
                ltv_cac: "LTV/CAC",
              }[row.metric]
            }
          </span>
          <span className="font-semibold tabular-nums">{calculationValue(row, language)}</span>
        </div>
      ))}
    </div>
  );
}
