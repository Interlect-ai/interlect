/**
 * The specialists' own charts on Konklusion (Case Dyb analyse v5, lines 93–98 and 311–349): each
 * standard specialist draws its own kind of chart from the sourced card data the
 * deep analysis delivers, so the cards are not the same horizontal bars four times
 *
 * - Team: a radar over the people (one area per person, the five team axes).
 * - Produkt og marked: the market size over time as a line with its area.
 * - Teknologi: the company's key figures next to the industry's as pairs of bars; a figure
 *   without the industry's level is a field of its own.
 * - Tese og deal: the ownership shares as a ring with a legend (else the financing rounds).
 *
 * Only sourced points are drawn (`sanitizeCardData`); what the sources did not have is
 * "Ikke fundet" with the specialist's own reason (`CardNotFound`). Measured from the prototype:
 * radar line 2.5 with a 22 % fill and 4.5 px points; the line 3 px with a fading area, 4.5 px
 * points and the last value 15/600 at the end; bars 56 px wide, radius 10/10/4/4, value 17/600,
 * label micro ink-3, the pair's name list/600 ink-2; ring 200 px, stroke 13, centre 34/600.
 */
import { useCallback, useMemo } from "react";
import { curveMonotoneX } from "@visx/curve";
import { motion, useReducedMotion } from "motion/react";
import { SearchX } from "lucide-react";
import { RadarChart } from "@/components/charts/radar-chart";
import { RadarGrid } from "@/components/charts/radar-grid";
import { RadarAxis } from "@/components/charts/radar-axis";
import { RadarLabels } from "@/components/charts/radar-labels";
import { RadarArea } from "@/components/charts/radar-area";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip";
import type {
  MarketCardData,
  OwnershipCardData,
  TeamCardData,
  TechBenchmarksCardData,
} from "@/lib/analysis/card-data";
import { TEAM_AXES } from "@/lib/analysis/card-data-kinds";
import { techValueText } from "@/lib/cases/analysis-data";
import { seriesSlot } from "@/lib/charts/colors";
import { marketSeries } from "@/lib/charts/layouts";
import { LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";

function formatNumber(value: number, language: Language, digits = 1): string {
  return new Intl.NumberFormat(LANGUAGE_TAGS[language], {
    maximumFractionDigits: digits,
  }).format(value);
}

/** "Ikke fundet" in the chart's place, with the specialist's own reason when it gave one. */
export function CardNotFound({ reason }: { reason: string | null }) {
  const t = useT();
  return (
    <span className="flex max-w-[340px] flex-col items-center gap-2 text-center">
      <SearchX className="size-5 text-ink-4" strokeWidth={1.75} aria-hidden />
      <span className="text-list font-semibold text-ink-2">{t("deep.cards.notFound")}</span>
      <span className="line-clamp-3 text-meta leading-[1.5] text-ink-3">
        {reason ?? t("deep.cards.notFoundHint")}
      </span>
    </span>
  );
}

/** The first person in the team colour (prototype: --series-2), the others clearly apart. */
const PEOPLE_COLORS = ["var(--series-2)", "var(--series-5)", "var(--series-7)", "var(--series-1)"];

/** The people a Team radar shows and the axes at least one of them has a sourced score on. */
function teamRadarParts(data: TeamCardData) {
  const people = data.people.slice(0, 4);
  // An axis no shown person has a sourced score on is left out instead of drawn as 0 (weak).
  const axes = TEAM_AXES.filter((axis) => people.some((person) => person.scores[axis] !== null));
  return { people, axes };
}

/** Team: one radar area per person over the five team axes (scores 0–10 drawn as 0–100). */
export function TeamChart({ data }: { data: TeamCardData }) {
  const t = useT();
  const { people, axes } = teamRadarParts(data);
  const more = data.people.length - people.length;
  const metrics = axes.map((axis) => ({ key: axis, label: t(`deep.cards.teamAxis.${axis}`) }));
  const series = people.map((person, index) => ({
    label: person.name,
    color: PEOPLE_COLORS[index % PEOPLE_COLORS.length]!,
    values: Object.fromEntries(axes.map((axis) => [axis, (person.scores[axis] ?? 0) * 10])),
  }));
  // A radar needs three axes; with fewer the people are listed without it.
  if (axes.length < 3) return <CardNotFound reason={data.notFound} />;
  return (
    <span className="flex w-full flex-col items-center gap-3">
      <span className="block w-full max-w-[420px]" aria-hidden>
        <RadarChart data={series} metrics={metrics} margin={58} levels={3}>
          <RadarGrid showLabels={false} />
          <RadarAxis />
          <RadarLabels fontSize={12} offset={14} />
          {series.map((person, index) => (
            <RadarArea key={`${person.label}-${index}`} index={index} showGlow={false} />
          ))}
        </RadarChart>
      </span>
      {/* Names only: the roles are in the Team tab (little text on the card). */}
      <span className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-meta text-ink-2">
        {people.map((person, index) => (
          <span key={`${person.name}-${index}`} className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ background: series[index]!.color }}
              aria-hidden
            />
            {person.name}
          </span>
        ))}
        {more > 0 && <span className="text-ink-4">{t("deep.cards.more", { count: more })}</span>}
      </span>
    </span>
  );
}

function marketAmount(
  value: number,
  data: MarketCardData,
  language: Language,
  t: ReturnType<typeof useT>,
) {
  return `${formatNumber(value, language)} ${t(`deep.cards.unit.${data.unit}`)} ${data.currency}`;
}

/** The x label of a market point: its year. */
const yearLabel = (date: Date) => String(date.getUTCFullYear());

/**
 * Produkt og marked: the market size per year as bklit's area chart (c2): the line with a
 * fading area, a hollow point per year, the forecast years dashed, a tooltip per year, and the
 * last value in the corner (prototype: 15/600 at the end of the line).
 */
export function MarketChart({ data, color }: { data: MarketCardData; color: string }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const { points, rows, dashFromIndex, last } = useMemo(
    () => marketSeries(data.points),
    [data.points],
  );
  const tooltipTitle = useCallback(
    (row: Record<string, unknown>) => {
      const year = (row["date"] as Date).getUTCFullYear();
      const forecast = points.find((point) => point.year === year)?.basis === "forecast";
      return forecast ? `${year} (${t("deep.cards.forecast")})` : String(year);
    },
    [points, t],
  );
  if (!last) return null;
  const amount = (value: number) => marketAmount(value, data, language, t);
  return (
    <span className="flex w-full flex-col gap-1.5">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 text-meta text-ink-3">
          {[data.label, data.geography].filter(Boolean).join(", ")}
        </span>
        <span className="ml-auto shrink-0 text-[15px] font-semibold text-ink-1 tabular-nums">
          {amount(last.value)}
          {last.basis === "forecast" ? ` (${t("deep.cards.forecast")})` : ""}
        </span>
      </span>
      <span className="block w-full" aria-hidden>
        <AreaChart
          data={rows}
          aspectRatio="auto"
          style={{ height: 290 }}
          margin={{ top: 16, right: 30, bottom: 34, left: 30 }}
          xLabel={yearLabel}
          {...(reduced ? { animationDuration: 0 } : {})}
        >
          <Grid horizontal numTicksRows={3} strokeDasharray="2,4" />
          <Area
            dataKey="value"
            fill={color}
            stroke={color}
            strokeWidth={3}
            fillOpacity={0.35}
            curve={curveMonotoneX}
            showMarkers
            markers={{
              radius: 4.5,
              fill: "var(--bg-canvas)",
              stroke: color,
              strokeWidth: 2.5,
              ringGap: 0,
            }}
            {...(dashFromIndex !== null ? { dashFromIndex } : {})}
          />
          <XAxis numTicks={Math.min(points.length, 8)} />
          <ChartTooltip
            showDatePill={false}
            title={tooltipTitle}
            rows={(row) => [
              {
                color,
                label: data.label || data.geography,
                value: amount(row["value"] as number),
              },
            ]}
          />
        </AreaChart>
      </span>
    </span>
  );
}

/**
 * Teknologi: up to two key figures with both sides, the company's bar next to the industry's. A
 * figure without the other side (no named source gives the industry's level) is a field
 * of its own, never a bar measured against itself: chips under the pairs, or, when no
 * figure has both sides, up to four fields.
 */
export function TechChart({ data, color }: { data: TechBenchmarksCardData; color: string }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const shown = (value: number, unit: string) => techValueText(value, unit, language);
  const pairs = data.items.filter((item) => item.company !== null && item.industry !== null);
  const singles = data.items.flatMap((item) =>
    item.company !== null && item.industry === null
      ? [{ label: item.metric, value: shown(item.company, item.unit) }]
      : item.company === null && item.industry !== null
        ? [
            {
              label: t("deep.data.tech.industry", { metric: item.metric }),
              value: shown(item.industry, item.unit),
            },
          ]
        : [],
  );

  if (pairs.length === 0) {
    const fields = singles.slice(0, 4);
    return (
      <span className="flex w-full flex-col gap-3">
        <span className="grid w-full grid-cols-2 gap-3">
          {fields.map((field, index) => (
            <motion.span
              key={`${field.label}-${index}`}
              className="flex min-w-0 flex-col gap-1.5 rounded-lg px-3.5 py-3.5"
              style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduced
                  ? REDUCED_FADE
                  : { duration: 0.46, ease: EASE.out, delay: 0.3 + index * 0.06 }
              }
            >
              <span className="truncate text-[30px] leading-none font-semibold tracking-title tabular-nums">
                {field.value}
              </span>
              <span className="truncate text-meta text-ink-3" title={field.label}>
                {field.label}
              </span>
            </motion.span>
          ))}
        </span>
      </span>
    );
  }

  const groups = pairs.slice(0, 2);
  const chips = singles.slice(0, 1);
  return (
    <span className="flex w-full flex-col gap-2">
      <span
        className="grid h-[280px] w-full gap-7"
        style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
      >
        {groups.map((item, groupIndex) => {
          const max = Math.max(Math.abs(item.company ?? 0), Math.abs(item.industry ?? 0)) || 1;
          const bars = [
            { key: "company", label: t("deep.cards.company"), value: item.company, fill: color },
            {
              key: "industry",
              label: t("deep.cards.industry"),
              value: item.industry,
              fill: `color-mix(in srgb, ${color} 30%, transparent)`,
            },
          ].flatMap((bar) => (bar.value === null ? [] : [{ ...bar, value: bar.value }]));
          return (
            <span
              key={`${item.metric}-${groupIndex}`}
              className="flex h-full min-w-0 flex-col gap-2.5"
            >
              <span className="flex flex-1 items-end justify-center gap-3">
                {bars.map((bar, barIndex) => (
                  <span
                    key={bar.key}
                    className="flex h-full w-14 flex-col items-center justify-end gap-1.5"
                  >
                    <span className="text-[17px] font-semibold whitespace-nowrap">
                      {shown(bar.value, item.unit)}
                    </span>
                    <motion.span
                      className="block w-full rounded-[10px_10px_4px_4px]"
                      style={{
                        height: `${Math.max(2, (Math.abs(bar.value) / max) * 78)}%`,
                        background: bar.fill,
                        transformOrigin: "bottom",
                      }}
                      initial={reduced ? { opacity: 0 } : { scaleY: 0 }}
                      animate={reduced ? { opacity: 1 } : { scaleY: 1 }}
                      transition={
                        reduced
                          ? REDUCED_FADE
                          : {
                              duration: 0.9,
                              ease: EASE.standard,
                              delay: 0.3 + groupIndex * 0.2 + barIndex * 0.09,
                            }
                      }
                    />
                    <span className="text-micro whitespace-nowrap text-ink-3">{bar.label}</span>
                  </span>
                ))}
              </span>
              <span
                className="truncate text-center text-list font-semibold text-ink-2"
                title={item.metric}
              >
                {item.metric}
              </span>
            </span>
          );
        })}
      </span>
      {chips.length > 0 && (
        <span className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          {chips.map((chip, index) => (
            <span key={`${chip.label}-${index}`} className="flex min-w-0 items-baseline gap-2">
              <span className="text-[17px] font-semibold whitespace-nowrap tabular-nums">
                {chip.value}
              </span>
              <span className="truncate text-meta text-ink-3" title={chip.label}>
                {chip.label}
              </span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** Tese og deal: the ownership shares as a ring (else the financing rounds as a short list). */
export function OwnershipChart({
  data,
  card = false,
}: {
  data: OwnershipCardData;
  /** On a card on Konklusion: a larger ring and the three largest holders only. */
  card?: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  if (data.holders.length === 0) {
    return (
      <span className="flex w-full flex-col gap-3">
        {data.rounds.slice(0, 4).map((round, index) => (
          <span
            key={`${round.name}-${index}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-list font-semibold">{round.name}</span>
              <span className="truncate text-meta text-ink-3">
                {[round.date, round.investors.join(", ")].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="text-list font-semibold whitespace-nowrap">
              {round.amount === null
                ? "–"
                : `${formatNumber(round.amount, language, 0)} ${round.currency ?? ""}`.trim()}
            </span>
          </span>
        ))}
      </span>
    );
  }
  const holders = [...data.holders].sort((a, b) => b.percent - a.percent);
  const shown = holders.slice(0, card ? 3 : 5);
  const rest = holders.slice(shown.length).reduce((sum, holder) => sum + holder.percent, 0);
  const ring = card ? 250 : 200;
  const known = holders.reduce((sum, holder) => sum + holder.percent, 0);
  const unknown = Math.max(0, 100 - known);
  const slices = [
    ...shown.map((holder, index) => ({
      label: holder.holder,
      value: holder.percent,
      color: seriesSlot(index + 1),
    })),
    ...(rest > 0
      ? [{ label: t("deep.cards.otherHolders"), value: rest, color: "var(--ink-4)" }]
      : []),
    ...(unknown >= 0.5
      ? [{ label: t("deep.cards.unknownShare"), value: unknown, color: "var(--chart-track)" }]
      : []),
  ];
  const founders = holders
    .filter((holder) => holder.holderType === "founder")
    .reduce((sum, holder) => sum + holder.percent, 0);
  const centre =
    founders > 0
      ? { value: founders, label: t("deep.cards.founders") }
      : { value: holders[0]!.percent, label: holders[0]!.holder };
  return (
    <span className="flex flex-wrap items-center justify-center gap-x-[30px] gap-y-4">
      <span className="relative flex-none" style={{ width: ring, height: ring }} aria-hidden>
        <PieChart
          data={slices}
          size={ring}
          innerRadius={card ? 86 : 70}
          padAngle={(1.4 / 100) * Math.PI * 2}
          cornerRadius={0}
          {...(reduced ? {} : { enterTransition: { duration: 1, ease: EASE.standard } })}
        >
          {slices.map((slice, index) => (
            <PieSlice key={`${slice.label}-${index}`} index={index} />
          ))}
        </PieChart>
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              "leading-none font-semibold tracking-display",
              card ? "text-[40px]" : "text-[34px]",
            )}
          >
            {formatNumber(centre.value, language)} %
          </span>
          <span className="max-w-[110px] truncate text-meta text-ink-3">{centre.label}</span>
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-2.5">
        {slices.map((slice, index) => (
          <span
            key={`${slice.label}-${index}`}
            className="flex min-w-0 items-center gap-2 text-list"
          >
            <span
              className="size-[9px] shrink-0 rounded-[3px]"
              style={{ background: slice.color }}
            />
            <span className="max-w-[160px] truncate" title={slice.label}>
              {slice.label}
            </span>
            <span className="font-semibold whitespace-nowrap">
              {formatNumber(slice.value, language)} %
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
