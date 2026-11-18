/**
 * The charts a specialist's card on Konklusion draws when its own chart has no data ("en graf, der
 * passer til specialisten"; "Graf-system"): no card is an
 * empty box. In order:
 *
 * - `RoundsChart` (Tese og deal without ownership shares): the financing rounds as columns on a
 *   time line in one currency; the fixed rate used for a converted round is in its tooltip.
 * - `CriteriaColumns`: the specialist's assessments per criterion as columns next to the
 *   screening's (pairs: screening in the track colour, the deep score in the specialist's).
 * - `CertaintyWaffle`: one square per finding in the specialist's colour (never by how sure it is);
 * with the specialist's own lists (a team's own specialist without findings) by
 *   what speaks for, against and what is open.
 *
 * - `HighlightsChart` (`highlights`, the 3–6 figures a specialist found when its own chart's data
 * was missing, and always for a team's own specialist): the chart that fits the figures,
 *   columns on a time line, horizontal bars, or one tile per figure (see `highlightsPlan`).
 * - `ScoreGauge` (a scored specialist with one criterion): the score on the specialist
 *   tab's gauge, wider, with the screening score as a tick ("Én score mod skala → gauge").
 * - `EmptyChart`: nothing to draw at all. Under "Ikke fundet" or "Mangler information"
 *   stand the empty columns a chart would have (dashed, on a baseline), so the card is still a
 *   chart card.
 *
 * Only what the analysis found is drawn; nothing is estimated. Columns grow from the baseline in
 * 900 ms, 300 ms + 90 ms each; squares fade in 40 ms apart; reduced motion fades only.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { CriterionRow } from "@/lib/cases/deep-view";
import type { HighlightFigure, HighlightsPlan, RoundsTimeline } from "@/lib/cases/card-fallback";
import { formatDkkCompact } from "@/lib/analysis/financial-format";
import { formatScore } from "@/lib/cases/screening-view";
import { LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";
import { cn } from "@/lib/utils";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { Gauge } from "./Gauge";

/** "149m", "1.2bn"; the same short form as Økonomi's columns, in any currency. */
function compact(value: number, language: Language): string {
  return formatDkkCompact(value, language);
}

function rateText(rate: number, language: Language): string {
  return new Intl.NumberFormat(LANGUAGE_TAGS[language], { maximumFractionDigits: 4 }).format(rate);
}

export function RoundsChart({ timeline, color }: { timeline: RoundsTimeline; color: string }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const bars = timeline.bars.slice(-5);
  const max = Math.max(...bars.map((bar) => bar.converted ?? 0), 1);
  return (
    <span className="flex w-full flex-col gap-3">
      <span className="flex h-[270px] w-full items-stretch gap-4">
        {bars.map((bar, index) => {
          const share = bar.converted === null ? 0 : bar.converted / max;
          const last = index === bars.length - 1;
          const title =
            bar.converted === null
              ? t("deep.cards.roundNotConverted", { currency: bar.currency })
              : bar.rate !== null && bar.rate !== 1
                ? t("deep.cards.roundRate", {
                    amount: compact(bar.amount, language),
                    currency: bar.currency,
                    rate: rateText(bar.rate, language),
                    target: timeline.currency,
                  })
                : undefined;
          return (
            <span
              key={`${bar.name}-${index}`}
              className="flex h-full min-w-0 flex-1 flex-col items-center gap-2"
              title={title}
            >
              <span className="text-[15px] font-semibold whitespace-nowrap">
                {bar.converted === null
                  ? `${compact(bar.amount, language)} ${bar.currency}`
                  : compact(bar.converted, language)}
              </span>
              <span className="relative w-full flex-1">
                {bar.converted === null ? (
                  <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[var(--chart-track)]" />
                ) : (
                  <motion.span
                    className="absolute inset-x-0 bottom-0 block rounded-[12px_12px_4px_4px]"
                    style={{
                      height: `${Math.max(3, share * 100)}%`,
                      background: last ? color : `color-mix(in srgb, ${color} 38%, transparent)`,
                      transformOrigin: "bottom",
                    }}
                    initial={reduced ? { opacity: 0 } : { scaleY: 0 }}
                    animate={reduced ? { opacity: 1 } : { scaleY: 1 }}
                    transition={
                      reduced
                        ? REDUCED_FADE
                        : { duration: 0.9, ease: EASE.standard, delay: 0.3 + index * 0.09 }
                    }
                  />
                )}
              </span>
              <span className="flex max-w-full flex-col items-center">
                <span className="max-w-full truncate text-meta font-medium text-ink-2">
                  {bar.name}
                </span>
                <span className="text-micro text-ink-4">{bar.year ?? "–"}</span>
              </span>
            </span>
          );
        })}
      </span>
      <span className="text-micro text-ink-4">
        {t("deep.cards.roundsIn", { currency: timeline.currency })}
      </span>
    </span>
  );
}

export function CriteriaColumns({ rows, color }: { rows: readonly CriterionRow[]; color: string }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const shown = rows.slice(0, 4);
  // One criterion gets wide columns and large numbers, so the chart fills the card.
  const one = shown.length === 1;
  const hasScreening = shown.some((row) => row.screeningScore !== null);
  let order = 0;
  const grow = () => {
    const delay = 0.3 + order++ * 0.09;
    return {
      initial: reduced ? { opacity: 0 } : { scaleY: 0 },
      animate: reduced ? { opacity: 1 } : { scaleY: 1 },
      transition: reduced ? REDUCED_FADE : { duration: 0.9, ease: EASE.standard, delay },
    };
  };
  return (
    <span className="flex w-full flex-col gap-3">
      <span className="flex h-[270px] w-full items-stretch justify-center gap-6">
        {shown.map((row) => (
          <span
            key={row.criterionKey}
            className={cn(
              "flex h-full min-w-0 flex-1 flex-col items-center gap-2",
              one ? "max-w-[220px]" : "max-w-[140px]",
            )}
          >
            <span className="flex w-full flex-1 items-end justify-center gap-1.5">
              {hasScreening && (
                <span
                  className={cn(
                    "flex h-full w-full flex-col items-center justify-end gap-1",
                    one ? "max-w-[84px]" : "max-w-[40px]",
                  )}
                >
                  <span className={cn("text-ink-3 tabular-nums", one ? "text-lead" : "text-meta")}>
                    {row.screeningScore === null ? "–" : formatScore(row.screeningScore, language)}
                  </span>
                  <motion.span
                    className="block w-full rounded-[10px_10px_4px_4px] bg-[var(--chart-track)]"
                    style={{ height: `${row.screeningScore ?? 0}%`, transformOrigin: "bottom" }}
                    {...grow()}
                  />
                </span>
              )}
              <span
                className={cn(
                  "flex h-full w-full flex-col items-center justify-end gap-1",
                  one ? "max-w-[84px]" : "max-w-[40px]",
                )}
              >
                <span
                  className={cn("font-semibold tabular-nums", one ? "text-[28px]" : "text-[15px]")}
                >
                  {formatScore(row.score, language)}
                </span>
                <motion.span
                  className="block w-full rounded-[10px_10px_4px_4px]"
                  style={{
                    height: `${row.score ?? 0}%`,
                    background: color,
                    transformOrigin: "bottom",
                  }}
                  {...grow()}
                />
              </span>
            </span>
            <span className="max-w-full truncate text-meta text-ink-2" title={row.label}>
              {row.label}
            </span>
          </span>
        ))}
      </span>
      {hasScreening && (
        <span className="flex justify-center gap-4 text-micro text-ink-3" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="size-[9px] rounded-[3px] bg-[var(--chart-track)]" />
            {t("deep.cards.screening")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-[9px] rounded-[3px]" style={{ background: color }} />
            {t("deep.cards.deepAnalysis")}
          </span>
        </span>
      )}
    </span>
  );
}

export interface WaffleGroup {
  key: string;
  label: string;
  count: number;
  color: string;
}

export function CertaintyWaffle({
  groups,
  label,
}: {
  groups: readonly WaffleGroup[];
  label: string;
}) {
  const reduced = useReducedMotion();
  const present = groups.filter((group) => group.count > 0);
  const squares = present.flatMap((group) =>
    Array.from({ length: group.count }, (_, index) => ({ key: `${group.key}-${index}`, group })),
  );
  return (
    <span className="flex w-full flex-col items-center gap-5">
      <span
        className="flex max-w-[300px] flex-wrap justify-center gap-2"
        role="img"
        aria-label={`${label}: ${present.map((group) => `${group.label} ${group.count}`).join(", ")}`}
      >
        {squares.slice(0, 24).map((square, index) => (
          <motion.span
            key={square.key}
            className="size-[36px] rounded-[10px]"
            style={{ background: square.group.color }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduced ? REDUCED_FADE : { duration: 0.46, ease: EASE.out, delay: 0.3 + index * 0.04 }
            }
          />
        ))}
      </span>
      <span className="flex flex-wrap justify-center gap-x-5 gap-y-2" aria-hidden>
        {present.map((group) => (
          <span key={group.key} className="flex items-baseline gap-2">
            <span
              className="size-[9px] self-center rounded-[3px]"
              style={{ background: group.color }}
            />
            <span className="text-[17px] font-semibold tabular-nums">{group.count}</span>
            <span className="text-meta text-ink-3">{group.label}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** Small figures whole ("2015", "180"), large ones short ("7m"); never "2k" for a year. */
function figureNumber(value: number, language: Language): string {
  if (Math.abs(value) < 10_000) {
    const whole = Number.isInteger(value) && Math.abs(value) >= 1900 && Math.abs(value) <= 2100;
    return new Intl.NumberFormat(LANGUAGE_TAGS[language], {
      maximumFractionDigits: 2,
      useGrouping: !whole,
    }).format(value);
  }
  return compact(value, language);
}

function figureText(value: number, unit: string, language: Language): string {
  const text = figureNumber(value, language);
  const trimmed = unit.trim();
  if (!trimmed) return text;
  return trimmed === "%" ? `${text}%` : `${text} ${trimmed}`;
}

function periodText(period: string | null): string | null {
  return period?.trim() || null;
}

/**
 * The figures that are in another unit than the chart's: chips beside it, never on its scale. At
 * most two on a card, without their period (little text; the rest is in the tab).
 */
function FigureChips({ figures }: { figures: readonly HighlightFigure[] }) {
  const language = useLanguage();
  if (figures.length === 0) return null;
  return (
    <span className="flex flex-wrap justify-center gap-x-5 gap-y-2">
      {figures.slice(0, 2).map((figure, index) => (
        <span key={`${figure.label}-${index}`} className="flex min-w-0 items-baseline gap-2">
          <span className="text-[17px] font-semibold tabular-nums">
            {figureText(figure.value, figure.unit, language)}
          </span>
          <span className="max-w-[160px] truncate text-meta text-ink-3" title={figure.label}>
            {figure.label}
          </span>
        </span>
      ))}
    </span>
  );
}

export function HighlightsChart({ plan, color }: { plan: HighlightsPlan; color: string }) {
  const language = useLanguage();
  const reduced = useReducedMotion();
  const grow = (axis: "scaleY" | "scaleX", index: number) => ({
    initial: reduced ? { opacity: 0 } : { [axis]: 0 },
    animate: reduced ? { opacity: 1 } : { [axis]: 1 },
    transition: reduced
      ? REDUCED_FADE
      : { duration: 0.9, ease: EASE.standard, delay: 0.3 + index * 0.09 },
  });

  if (plan.kind === "columns") {
    const bars = plan.figures.slice(-6);
    return (
      <span className="flex w-full flex-col gap-4">
        <span className="flex h-[270px] w-full items-stretch gap-4">
          {bars.map((figure, index) => {
            const last = index === bars.length - 1;
            const share = plan.scale > 0 ? Math.abs(figure.value) / plan.scale : 0;
            return (
              <span
                key={`${figure.period}-${index}`}
                className="flex h-full min-w-0 flex-1 flex-col items-center gap-2"
                title={figure.label}
              >
                <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">
                  {figureNumber(figure.value, language)}
                </span>
                <span className="relative w-full flex-1">
                  <motion.span
                    className="absolute inset-x-0 bottom-0 block rounded-[12px_12px_4px_4px]"
                    style={{
                      height: `${Math.max(3, share * 100)}%`,
                      background:
                        figure.value < 0
                          ? "var(--warning)"
                          : last
                            ? color
                            : `color-mix(in srgb, ${color} 38%, transparent)`,
                      transformOrigin: "bottom",
                    }}
                    {...grow("scaleY", index)}
                  />
                </span>
                <span className="max-w-full truncate text-meta text-ink-3">
                  {periodText(figure.period)}
                </span>
              </span>
            );
          })}
        </span>
        <span className="text-center text-micro text-ink-4">
          {plan.figures[0]?.label}
          {plan.unit ? ` · ${plan.unit}` : ""}
        </span>
        <FigureChips figures={plan.rest} />
      </span>
    );
  }

  if (plan.kind === "bars") {
    return (
      <span className="flex w-full flex-col gap-5">
        <span className="flex w-full flex-col gap-4">
          {plan.figures.slice(0, 6).map((figure, index) => (
            <span key={`${figure.label}-${index}`} className="flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-3 text-list">
                <span className="min-w-0 truncate text-ink-2" title={figure.label}>
                  {figure.label}
                  {periodText(figure.period) && (
                    <span className="text-ink-4"> · {periodText(figure.period)}</span>
                  )}
                </span>
                <span className="font-semibold tabular-nums">
                  {figureText(figure.value, plan.unit, language)}
                </span>
              </span>
              <span className="relative h-3.5 rounded-[7px] bg-[var(--chart-track)]">
                <motion.span
                  className="absolute inset-y-0 left-0 block rounded-[7px]"
                  style={{
                    width: `${plan.scale > 0 ? Math.max(2, (Math.abs(figure.value) / plan.scale) * 100) : 0}%`,
                    background: figure.value < 0 ? "var(--warning)" : color,
                    transformOrigin: "left",
                  }}
                  {...grow("scaleX", index)}
                />
              </span>
            </span>
          ))}
        </span>
        <FigureChips figures={plan.rest} />
      </span>
    );
  }

  return (
    <span className="grid w-full grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
      {plan.figures.slice(0, 6).map((figure, index) => (
        <motion.span
          key={`${figure.label}-${index}`}
          className="flex min-w-0 flex-col gap-1 rounded-lg px-3 py-3"
          style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduced ? REDUCED_FADE : { duration: 0.46, ease: EASE.out, delay: 0.3 + index * 0.06 }
          }
        >
          <span className="truncate text-[30px] leading-none font-semibold tracking-title tabular-nums">
            {figureText(figure.value, figure.unit, language)}
          </span>
          <span className="truncate text-meta text-ink-3" title={figure.label}>
            {figure.label}
            {periodText(figure.period) ? ` · ${periodText(figure.period)}` : ""}
          </span>
        </motion.span>
      ))}
    </span>
  );
}

export function ScoreGauge({
  score,
  screening,
  color,
  label,
  width = 240,
}: {
  /** The gauge's width; a card's "Måler" draws it larger. */
  width?: number;
  score: number;
  /** The same criteria's screening average; null when they were not scored at screening. */
  screening: number | null;
  color: string;
  label: string;
}) {
  const t = useT();
  const language = useLanguage();
  const atScreening =
    screening === null
      ? undefined
      : t("deep.cards.atScreening", { score: formatScore(screening, language) });
  return (
    <span className="flex w-full flex-col items-center gap-4">
      <Gauge
        value={score}
        color={color}
        label={label}
        mark={screening}
        markLabel={atScreening}
        width={width}
      />
      {screening !== null && (
        <span className="flex justify-center gap-5 text-micro text-ink-3" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="h-[11px] w-0.5 rounded-[1px] bg-ink-2" />
            {t("deep.cards.screening")}
            <span className="font-semibold text-ink-2 tabular-nums">
              {formatScore(screening, language)}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-[9px] rounded-[3px]" style={{ background: color }} />
            {t("deep.cards.deepAnalysis")}
            <span className="font-semibold text-ink-2 tabular-nums">
              {formatScore(score, language)}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

/** Heights of the empty columns, so they read as a chart and not as data (no trend). */
const EMPTY_HEIGHTS = [52, 78, 44, 66, 58];

export function EmptyChart({ bars, children }: { bars: number; children: ReactNode }) {
  return (
    <span className="flex w-full flex-col items-center gap-5">
      {children}
      <span
        className="flex h-[96px] w-full items-end gap-4 border-b border-line-strong"
        aria-hidden
      >
        {EMPTY_HEIGHTS.slice(0, bars).map((height, index) => (
          <span
            key={index}
            className="block flex-1 rounded-[12px_12px_4px_4px] border border-b-0 border-dashed border-line-strong bg-[var(--chart-track)]"
            style={{ height: `${height}%` }}
          />
        ))}
      </span>
    </span>
  );
}
