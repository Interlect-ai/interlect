/**
 * Graf-primitiver til Interlect.ai.
 *
 * Geometrien er overtaget 1:1 fra designreferencen,
 * men intet er statisk: hver komponent modtager tal som props og beregner
 * punkter, buer og bjælkelængder ud fra de faktiske analyseresultater.
 * Uden data vises `ChartEmpty` — aldrig en tom akse eller et opdigtet tal.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ParentSize } from "@visx/responsive";
import { useCountUp } from "@/lib/hooks/useCountUp";
import { useLocaleTag, useT } from "@/lib/i18n/useT";

export function ChartEmpty({ missing }: { missing: string }) {
  return (
    <p className="rounded-md bg-surface-neutral px-3 py-4 text-list leading-5 text-ink-3">
      {missing}
    </p>
  );
}

export function ChartCard({
  title,
  meta,
  footnote,
  tone = "plain",
  children,
}: {
  title: string;
  meta?: string;
  footnote?: string;
  tone?: "plain" | "accent";
  children: ReactNode;
}) {
  return (
    <figure
      className={cn(
        "m-0 flex min-w-0 flex-col gap-[11px] rounded-xl p-[17px_19px]",
        tone === "accent" ? "bg-surface-soft" : "border border-hairline bg-surface",
      )}
    >
      <figcaption className="flex items-baseline justify-between gap-3">
        <span
          className={cn("text-body font-semibold", tone === "accent" ? "text-action" : "text-ink")}
        >
          {title}
        </span>
        {meta && (
          <span
            className={cn("mono-num text-list", tone === "accent" ? "text-action" : "text-ink-3")}
          >
            {meta}
          </span>
        )}
      </figcaption>
      {children}
      {footnote && <span className="text-list leading-[1.45] text-ink-3">{footnote}</span>}
    </figure>
  );
}

/* ── Fondsfit som ring ─────────────────────────────────────────────── */

export function FitDonut({
  score,
  caption: captionProp,
  size = 88,
  thickness = 11,
  threshold = null,
}: {
  score: number | null;
  caption?: string;
  size?: number;
  thickness?: number;
  /** Fondens tærskel (0-100). Tegnes som en koral markering på ringen. */
  threshold?: number | null;
}) {
  const t = useT();
  const localeTag = useLocaleTag();
  const caption = captionProp ?? t("charts.fitDonut.caption");
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const animated = useCountUp(score);
  const filled = animated === null ? 0 : Math.max(0, Math.min(100, animated));
  const center = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="flex-none"
      role="img"
      aria-label={
        score === null
          ? t("charts.fitDonut.ariaNone", { caption })
          : t("charts.fitDonut.aria", {
              caption,
              score: score.toLocaleString(localeTag, { maximumFractionDigits: 1 }),
            })
      }
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--surface-soft)"
        strokeWidth={thickness}
      />
      {score !== null && (
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={thickness}
          // Lige ende: en rund ende ville få scoren til at se ud, som om den når tærsklen før tid.
          strokeLinecap="butt"
          strokeDasharray={`${(filled / 100) * circumference} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
          style={{
            transition: "stroke-dasharray 320ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      )}
      {threshold !== null && threshold >= 0 && threshold <= 100 && (
        // Tærsklen som en kort koral streg på tværs af ringen, målt med uret fra toppen.
        <line
          x1={center}
          y1={center - radius - thickness / 2}
          x2={center}
          y2={center - radius + thickness / 2}
          stroke="var(--ai)"
          strokeWidth={2.5}
          strokeLinecap="butt"
          transform={`rotate(${(threshold / 100) * 360} ${center} ${center})`}
        >
          <title>{t("charts.fitDonut.threshold", { threshold })}</title>
        </line>
      )}
      {/* Tal og tekst holdes små nok til at stå frit af ringen. */}
      <text
        x={center}
        y={center + size * 0.03}
        textAnchor="middle"
        fontSize={size * 0.21}
        fontWeight={700}
        fill="var(--ink)"
      >
        {animated === null ? "—" : animated.toLocaleString(localeTag, { maximumFractionDigits: 1 })}
      </text>
      <text
        x={center}
        y={center + size * 0.165}
        textAnchor="middle"
        fontSize={Math.max(11, size * 0.08)}
        fill="var(--ink-3)"
      >
        {caption}
      </text>
    </svg>
  );
}

/** Måler den tilgængelige bredde, så SVG-diagrammer tegnes i rigtige pixels (ingen skalering). */
function MeasuredWidth({
  height,
  children,
}: {
  height: number;
  children: (width: number) => ReactNode;
}) {
  return (
    <ParentSize debounceTime={50}>
      {({ width }) =>
        width > 0 ? children(Math.floor(width)) : <div style={{ height }} aria-hidden />
      }
    </ParentSize>
  );
}

/* ── Tidsserie som areal + linje ───────────────────────────────────── */

export interface SeriesPoint {
  label: string;
  value: number;
}

export function MetricArea({
  points,
  ariaLabel,
  height = 138,
}: {
  points: SeriesPoint[];
  ariaLabel: string;
  height?: number;
}) {
  const t = useT();
  if (points.length < 2) {
    return <ChartEmpty missing={t("charts.metricArea.tooFew")} />;
  }
  // Tegnes i den faktiske bredde, så teksten altid er 11 px (også på mobil).
  return (
    <MeasuredWidth height={height}>
      {(width) => (
        <MetricAreaSvg points={points} ariaLabel={ariaLabel} height={height} width={width} />
      )}
    </MeasuredWidth>
  );
}

function MetricAreaSvg({
  points,
  ariaLabel,
  height,
  width,
}: {
  points: SeriesPoint[];
  ariaLabel: string;
  height: number;
  width: number;
}) {
  const left = 34;
  const bottom = 20;
  const top = 10;
  const values = points.map((point) => point.value);
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const plotHeight = height - bottom - top - 2;
  const coords = points.map((point, index) => {
    const x = left + (index / (points.length - 1)) * (width - left - 6);
    const y = height - bottom - ((point.value - min) / span) * plotHeight;
    return [x, y] as const;
  });
  const gridY = [0, 1, 2].map((index) => top + index * (plotHeight / 2));
  const gridLabels = [max, min + span / 2, min];
  const last = coords[coords.length - 1]!;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      role="img"
      aria-label={ariaLabel}
    >
      {gridY.map((y, index) => (
        <g key={y}>
          <line x1={left} x2={width} y1={y} y2={y} stroke="var(--hairline)" strokeWidth={1} />
          <text
            x={0}
            y={y + 3}
            fontSize={11}
            fill="var(--ink-3)"
            fontFamily="var(--font-interface)"
          >
            {formatCompact(gridLabels[index] ?? 0)}
          </text>
        </g>
      ))}
      <polygon
        points={`${coords[0]![0]},${height - bottom} ${coords.map((point) => point.join(",")).join(" ")} ${last[0]},${height - bottom}`}
        fill="color-mix(in oklab, var(--series-1) 16%, transparent)"
      />
      <polyline
        points={coords.map((point) => point.join(",")).join(" ")}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth={2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--series-1)" />
      {points.map((point, index) => (
        <text
          key={point.label + index}
          x={coords[index]![0]}
          y={height - 4}
          fontSize={11}
          fill="var(--ink-3)"
          fontFamily="var(--font-interface)"
          textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
        >
          {point.label}
        </text>
      ))}
    </svg>
  );
}

export function formatCompact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (abs >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return `${Math.round(value * 10) / 10}`;
}

/* ── Fordeling af fondsfit mod tærsklen ────────────────────────────── */

export function ThresholdPlot({
  fits,
  threshold,
}: {
  fits: Array<{ id: string; score: number }>;
  threshold: number | null;
}) {
  const t = useT();
  if (fits.length === 0) {
    return <ChartEmpty missing={t("charts.thresholdPlot.empty")} />;
  }
  const height = 62;
  return (
    <MeasuredWidth height={height}>
      {(width) => (
        <ThresholdPlotSvg fits={fits} threshold={threshold} width={width} height={height} />
      )}
    </MeasuredWidth>
  );
}

function ThresholdPlotSvg({
  fits,
  threshold,
  width,
  height,
}: {
  fits: Array<{ id: string; score: number }>;
  threshold: number | null;
  width: number;
  height: number;
}) {
  const t = useT();
  const line = threshold === null ? null : (threshold / 100) * width;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      role="img"
      aria-label={
        threshold === null
          ? t("charts.thresholdPlot.aria", { count: fits.length })
          : t("charts.thresholdPlot.ariaWithThreshold", { count: fits.length, threshold })
      }
    >
      <line x1={0} x2={width} y1={height - 16} y2={height - 16} stroke="var(--hairline)" />
      {[0, 25, 50, 75, 100].map((tick) => (
        <text
          key={tick}
          x={(tick / 100) * width}
          y={height - 3}
          fontSize={11}
          fill="var(--ink-3)"
          fontFamily="var(--font-interface)"
          textAnchor={tick === 0 ? "start" : tick === 100 ? "end" : "middle"}
        >
          {tick}
        </text>
      ))}
      {line !== null && (
        <>
          <line
            x1={line}
            x2={line}
            y1={4}
            y2={height - 16}
            stroke="var(--ai)"
            strokeDasharray="3 3"
          />
          <text
            x={line + 4}
            y={11}
            fontSize={11}
            fill="var(--ink-3)"
            fontFamily="var(--font-interface)"
          >
            {t("charts.thresholdPlot.threshold", { threshold: threshold ?? "" })}
          </text>
        </>
      )}
      {fits.map((fit, index) => (
        <circle
          key={fit.id}
          cx={(Math.max(0, Math.min(100, fit.score)) / 100) * width}
          cy={height - 24 - (index % 3) * 9}
          r={3.6}
          fill={threshold !== null && fit.score >= threshold ? "var(--series-1)" : "var(--ink-4)"}
        />
      ))}
    </svg>
  );
}

/* ── Vægtring til fondsprofilen ────────────────────────────────────── */

export function WeightRing({
  slices,
  size = 108,
}: {
  slices: Array<{ label: string; weight: number }>;
  size?: number;
}) {
  const t = useT();
  const total = slices.reduce((sum, slice) => sum + slice.weight, 0);
  if (total <= 0) return <ChartEmpty missing={t("charts.weightRing.empty")} />;
  const thickness = 14;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const shades = [
    "var(--series-1)",
    "color-mix(in oklab, var(--series-1) 78%, var(--surface))",
    "color-mix(in oklab, var(--series-1) 58%, var(--surface))",
    "color-mix(in oklab, var(--series-1) 40%, var(--surface))",
    "color-mix(in oklab, var(--series-1) 26%, var(--surface))",
    "color-mix(in oklab, var(--series-1) 16%, var(--surface))",
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={t("charts.weightRing.aria", {
        list: slices
          .map((slice) => `${slice.label} ${Math.round((slice.weight / total) * 100)}%`)
          .join(", "),
      })}
    >
      {slices.map((slice, index) => {
        const fraction = slice.weight / total;
        const dash = fraction * circumference;
        const element = (
          <circle
            key={slice.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={shades[index % shades.length]}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += dash;
        return element;
      })}
    </svg>
  );
}
