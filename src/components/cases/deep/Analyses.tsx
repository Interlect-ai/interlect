/**
 * "Analyserne" on a specialist's tab and the sub-page each card opens (Case Dyb analyse v5, lines
 * 54–67 and 152–153). Two kinds of topic card, nothing invented:
 *
 * - Data cards: the sourced data the specialist delivered for its card,
 *   e.g. "Founders og ledelse: 3 personer" with a bar per person (`analysis-data.ts`). A figure
 *   with nothing to compare it with (Teknologi without the industry's level) is a field, never
 *   a bar measured against itself.
 * - Findings cards: the categories the specialist really has findings in, with the real count
 *   of findings by type. A category without findings has no card.
 *
 * Everything on the tab and its sub-pages is drawn in the specialist's own colour (lilla for Tese
 * og deal), passed in once as `color`: the strong bar full, the others mixed down, as
 * in the prototype (cards 35 %, the sub-page's rows 45 %). The sub-page stands inside the case
 * under the tabs, not over the whole page: back pill, the area with its dot, title
 * 36/600, the answer 18/1.55 (max 760) and the chart (the prototype's method box beside it is left
 * out), "Det fandt vi" on a surface card, then the columns.
 *
 * Measured: cards auto-fill min 280, gap 12, min height 190, padding 20, canvas radius lg; title
 * 15/600 with an arrow, the chart min 70 px with bars radius 6 6 3 3 growing from the bottom,
 * the headline 20/600. Hover: surface, raised shadow, y −3; press .98.
 */
import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowUpRight, CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { useBackPill } from "@/components/ds/useBackPill";
import type { DataField, DataTopic } from "@/lib/cases/analysis-data";
import {
  type AnalysisTopic,
  type FindingInput,
  type SpecialistGroup,
  analysisFocusKey,
} from "@/lib/cases/deep-view";
import { useT } from "@/lib/i18n/useT";
import { plainClick, useDeepHref } from "./deep-links";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** One card under "Analyserne": the specialist's data or one category of its findings. */
export type AnalysisCard =
  { kind: "data"; topic: DataTopic } | { kind: "findings"; topic: AnalysisTopic };

/** The specialist's colour, mixed down for the bars that are not the strong one. */
function shade(color: string, percent: number): string {
  return percent >= 100 ? color : `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** Findings by type: up in full colour, down and open mixed down (labels say which is which). */
const TYPE_BARS = [
  { key: "up", label: "deep.analyses.barUp", mix: 100 },
  { key: "down", label: "deep.analyses.barDown", mix: 60 },
  { key: "open", label: "deep.analyses.barOpen", mix: 30 },
] as const;

function counts(topic: AnalysisTopic) {
  return { up: topic.up.length, down: topic.down.length, open: topic.open.length };
}

/** A real address when the page has one; otherwise a button-like anchor (never `href="#"`). */
function topicLink(href: string | undefined, open: () => void) {
  if (href) return { href };
  return {
    role: "button",
    tabIndex: 0,
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
  } as const;
}

/** The small chart on a card: bars growing from the bottom (data cards show at most 10). */
function CardBars({
  bars,
  label,
}: {
  bars: readonly { key: string; height: number; color: string; caption?: string }[];
  label: string;
}) {
  const reduced = useReducedMotion();
  return (
    <span className="flex min-h-[70px] flex-1 items-end gap-1.5" role="img" aria-label={label}>
      {bars.map((bar, index) => (
        <span key={bar.key} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
          <motion.span
            className="block rounded-[6px_6px_3px_3px]"
            style={{ height: `${bar.height}%`, background: bar.color, transformOrigin: "bottom" }}
            initial={reduced ? { opacity: 0 } : { scaleY: 0 }}
            animate={reduced ? { opacity: 1 } : { scaleY: 1 }}
            transition={
              reduced
                ? REDUCED_FADE
                : { duration: 0.7, ease: EASE.standard, delay: 0.2 + index * 0.06 }
            }
          />
          {bar.caption && <span className="text-center text-micro text-ink-4">{bar.caption}</span>}
        </span>
      ))}
    </span>
  );
}

/**
 * The small card's fields: figures with nothing to compare them with, one field each in
 * the specialist's colour, never bars measured against themselves (at most four).
 */
function CardFields({
  fields,
  color,
  label,
}: {
  fields: readonly DataField[];
  color: string;
  label: string;
}) {
  const reduced = useReducedMotion();
  return (
    <span className="grid flex-1 grid-cols-2 content-end gap-1.5" role="img" aria-label={label}>
      {fields.slice(0, 4).map((field, index) => (
        <motion.span
          key={index}
          className="flex min-w-0 flex-col gap-1 rounded-sm px-2.5 py-2"
          style={{ background: shade(color, 12) }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduced ? REDUCED_FADE : { duration: 0.46, ease: EASE.out, delay: 0.2 + index * 0.06 }
          }
        >
          <span className="truncate text-[15px] leading-none font-semibold tabular-nums text-ink-1">
            {field.value}
          </span>
          <span className="truncate text-micro text-ink-3" title={field.label}>
            {field.label}
          </span>
        </motion.span>
      ))}
    </span>
  );
}

/** The card grid under "Analyserne"; nothing at all when the specialist has neither. */
export function AnalysesSection({
  cards,
  color,
  onOpen,
  returnTo,
}: {
  cards: readonly AnalysisCard[];
  /** The specialist's colour. */
  color: string;
  onOpen: (key: string) => void;
  /** The card whose sub-page was just closed: it gets focus back (the tab was remounted). */
  returnTo?: string | null | undefined;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const hrefFor = useDeepHref();
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!returnTo) return;
    const card = grid.current?.querySelector<HTMLElement>(`[data-topic="${CSS.escape(returnTo)}"]`);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
  }, [returnTo]);
  if (cards.length === 0) return null;
  return (
    <>
      <span className="px-1.5 text-section font-semibold">{t("deep.analyses.heading")}</span>
      <div
        ref={grid}
        className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-3"
      >
        {cards.map((card, index) => {
          const { topic } = card;
          let bars: { key: string; height: number; color: string; caption?: string }[];
          // Figures with nothing to compare: fields instead of bars, when there are no bars.
          let fields: readonly DataField[] = [];
          let chartLabel: string;
          let headline: string;
          if (card.kind === "data") {
            bars = card.topic.bars.slice(0, 10).map((bar, barIndex) => ({
              key: String(barIndex),
              height: bar.fraction === 0 ? 4 : Math.max(12, bar.fraction * 100),
              color:
                bar.fraction === 0 ? "var(--chart-track)" : shade(color, bar.strong ? 100 : 35),
            }));
            if (bars.length === 0) fields = card.topic.fields;
            chartLabel = [...card.topic.bars, ...card.topic.fields]
              .map((entry) => `${entry.label}: ${entry.value}`)
              .join(", ");
            headline = card.topic.headline;
          } else {
            const tally = counts(card.topic);
            const max = Math.max(1, tally.up, tally.down, tally.open);
            bars = TYPE_BARS.map((bar) => {
              const value = tally[bar.key];
              return {
                key: bar.key,
                height: value === 0 ? 4 : Math.max(12, (value / max) * 100),
                color: value === 0 ? "var(--chart-track)" : shade(color, bar.mix),
                caption: t(bar.label),
              };
            });
            chartLabel = t("deep.analyses.countAria", {
              total: card.topic.findings.length,
              up: tally.up,
              down: tally.down,
              open: tally.open,
            });
            headline = t(
              card.topic.findings.length === 1
                ? "deep.analyses.findingsOne"
                : "deep.analyses.findingsMany",
              { count: card.topic.findings.length },
            );
          }
          return (
            <motion.a
              key={topic.key}
              data-topic={topic.key}
              data-focus-card
              {...topicLink(hrefFor?.({ fokus: analysisFocusKey(topic.key) }), () =>
                onOpen(topic.key),
              )}
              onClick={(event) => plainClick(event, () => onOpen(topic.key))}
              aria-label={t("deep.analyses.openAnalysis", { label: topic.label })}
              className="flex min-h-[190px] flex-col items-stretch gap-3.5 rounded-lg bg-canvas p-5 text-left no-underline outline-none hover:no-underline transition-[transform,box-shadow,background-color] duration-[420ms] ease-standard hover:-translate-y-[3px] hover:bg-surface hover:shadow-raised focus-visible:ring-2 focus-visible:ring-action active:scale-[.98]"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduced ? REDUCED_FADE : { duration: 0.56, ease: EASE.out, delay: index * 0.06 }
              }
            >
              <span className="flex items-center justify-between gap-2 text-list font-semibold text-ink-1">
                {topic.label}
                <ArrowUpRight
                  className="size-4 shrink-0 text-ink-4"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </span>
              {fields.length > 0 ? (
                <CardFields fields={fields} color={color} label={chartLabel} />
              ) : (
                <CardBars bars={bars} label={chartLabel} />
              )}
              <span className="text-[20px] font-semibold tracking-title text-ink-1 tabular-nums">
                {headline}
              </span>
            </motion.a>
          );
        })}
      </div>
    </>
  );
}

function StatementColumn({
  title,
  items,
  tone,
  icon: Icon,
}: {
  title: string;
  /** A finding or a plain line. */
  items: readonly (FindingInput | string)[];
  tone: "positive" | "warning" | "neutral";
  icon: typeof CircleCheck;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-canvas p-5">
      <span
        className={cn(
          "flex items-center gap-[7px] text-list font-semibold",
          tone === "positive"
            ? "text-positive"
            : tone === "warning"
              ? "text-warning"
              : "text-ink-2",
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        {title}
      </span>
      {items.map((item, index) =>
        typeof item === "string" ? (
          <span key={index} className="text-[14px] leading-normal text-ink-2">
            {item}
          </span>
        ) : (
          <span key={index} className="flex flex-col gap-0.5">
            <span className="text-[14px] leading-normal text-ink-2">{item.statement}</span>
          </span>
        ),
      )}
    </div>
  );
}

interface ChartRow {
  key: string;
  label: string;
  value: string;
  fraction: number;
  strong: boolean;
}

/**
 * The sub-page of one card (prototype `dt`), inside the case under the tabs: what the
 * specialist found, every bar in the specialist's colour. Never how the analysis was made
 * (no "Sådan analyserede Interlect det").
 */
export function AnalysisFocus({
  group,
  card,
  backLabel,
  onBack,
}: {
  group: SpecialistGroup;
  card: AnalysisCard;
  /** The tab the sub-page belongs to ("Team"). */
  backLabel: string;
  onBack: () => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const backRef = useBackPill(onBack);
  const color = group.color;
  const rise = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE }
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.56, ease: EASE.out, delay },
        };

  const { topic } = card;
  let chartTitle: string;
  let rows: ChartRow[];
  let fields: readonly DataField[] = [];
  let chartNote: string;
  let found: readonly (FindingInput | string)[];
  let up: readonly (FindingInput | string)[];
  let down: readonly (FindingInput | string)[];
  let open: readonly FindingInput[];
  if (card.kind === "data") {
    chartTitle = card.topic.chartTitle;
    rows = card.topic.bars.map((bar, index) => ({ key: String(index), ...bar }));
    fields = card.topic.fields;
    chartNote = card.topic.note;
    found = card.topic.found;
    // The prototype repeats the specialist's general strengths and weaknesses here; they say
    // nothing about this data set, so a data page shows only its own figures.
    up = [];
    down = [];
    open = [];
  } else {
    const tally = counts(card.topic);
    const max = Math.max(1, tally.up, tally.down, tally.open);
    chartTitle = t("deep.analyses.byType");
    rows = [
      { key: "up", label: t("deep.analyses.pullsUpRow") },
      { key: "down", label: t("deep.analyses.pullsDownRow") },
      { key: "open", label: t("deep.analyses.openRow") },
    ].map((row, index) => {
      const value = tally[row.key as keyof typeof tally];
      return { ...row, value: String(value), fraction: value / max, strong: index === 0 };
    });
    chartNote = t("deep.analyses.tallyNote");
    found = card.topic.assessments;
    up = card.topic.up;
    down = card.topic.down;
    open = card.topic.open;
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <motion.button
        ref={backRef}
        type="button"
        onClick={onBack}
        className="inline-flex h-[34px] items-center gap-2 self-start rounded-pill bg-sunken pr-3.5 pl-2.5 text-list font-medium whitespace-nowrap text-ink-2 outline-none transition-transform active:scale-[.97] focus-visible:ring-2 focus-visible:ring-action"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.36, ease: EASE.out }}
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
        {backLabel}
      </motion.button>

      <motion.div className="flex flex-col gap-2.5" {...rise(0.04)}>
        <span className="flex items-center gap-2.5 text-list text-ink-3">
          <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
          {group.label}
        </span>
        <h2 className="m-0 text-[30px] leading-[1.1] font-semibold tracking-display md:text-[36px]">
          {topic.label}
        </h2>
        <p className="m-0 max-w-[760px] text-[18px] leading-[1.55] text-pretty text-ink-1">
          {topic.answer}
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-3 md:max-w-[560px]">
        <motion.div
          className="flex flex-col gap-4 rounded-xl bg-canvas px-6 py-[22px]"
          {...rise(0.1)}
        >
          <span className="text-section font-semibold">{chartTitle}</span>
          {rows.length > 0 && (
            <div className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[minmax(96px,200px)_minmax(0,1fr)_auto] items-center gap-3 text-list"
                >
                  <span className="truncate text-ink-2" title={row.label}>
                    {row.label}
                  </span>
                  <span className="h-3.5 overflow-hidden rounded-[7px] bg-[var(--chart-track)]">
                    <motion.span
                      className="block h-full rounded-[7px]"
                      style={{
                        width: `${row.fraction * 100}%`,
                        background: shade(color, row.strong ? 100 : 45),
                        transformOrigin: "left",
                      }}
                      initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
                      animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
                      transition={
                        reduced
                          ? REDUCED_FADE
                          : { duration: 0.9, ease: EASE.out, delay: 0.2 + index * 0.09 }
                      }
                    />
                  </span>
                  <span className="text-right font-semibold whitespace-nowrap tabular-nums">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          )}
          {fields.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
              {fields.map((field, index) => (
                <motion.div
                  key={index}
                  className="flex min-w-0 flex-col gap-1.5 rounded-md px-4 py-3.5"
                  style={{ background: shade(color, 12) }}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduced
                      ? REDUCED_FADE
                      : { duration: 0.46, ease: EASE.out, delay: 0.2 + index * 0.06 }
                  }
                >
                  <span className="truncate text-[22px] leading-none font-semibold tracking-title tabular-nums">
                    {field.value}
                  </span>
                  <span className="line-clamp-2 text-meta text-ink-2" title={field.label}>
                    {field.label}
                  </span>
                </motion.div>
              ))}
            </div>
          )}
          <span className="text-meta text-ink-3">{chartNote}</span>
        </motion.div>
      </div>

      {found.length > 0 && (
        <motion.div
          className="flex flex-col gap-2.5 rounded-lg bg-surface px-6 py-[22px] shadow-card"
          {...rise(0.22)}
        >
          <span className="text-meta font-semibold text-ink-3">{t("deep.analyses.found")}</span>
          {found.map((item, index) =>
            typeof item === "string" ? (
              <p key={index} className="m-0 max-w-[780px] text-[15px] leading-[1.7] text-ink-1">
                {item}
              </p>
            ) : (
              <div key={index} className="flex max-w-[780px] flex-col gap-0.5">
                <p className="m-0 text-[15px] leading-[1.7] text-ink-1">{item.statement}</p>
              </div>
            ),
          )}
        </motion.div>
      )}

      <motion.div
        className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3"
        {...rise(0.28)}
      >
        <StatementColumn
          title={t("deep.analyses.pullsUp")}
          items={up}
          tone="positive"
          icon={CircleCheck}
        />
        <StatementColumn
          title={t("deep.analyses.pullsDown")}
          items={down}
          tone="warning"
          icon={CircleAlert}
        />
        <StatementColumn
          title={t("deep.analyses.stillOpen")}
          items={open}
          tone="neutral"
          icon={CircleHelp}
        />
      </motion.div>
    </div>
  );
}
