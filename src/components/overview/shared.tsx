/**
 * Shared pieces of Overblik v2 (prototype "Overblik v2.dc.html"): the clickable card, the
 * sub-page's stats, "Hvad betyder det?" and "Cases bag tallet". The card is one click area
 * with ↗ in the top right ("Overblik v2, gennemgang"); tabs inside a card stop the
 * click. Keyboard readers reach it through the title button, so the click area is not a
 * second, hidden control.
 */
import type { MouseEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, X } from "lucide-react";
import { CountUp } from "@/components/ds/CountUp";
import {
  casePhaseLabels,
  caseStatusLabels,
  type CasePhase,
  type CaseStatus,
} from "@/lib/cases/lifecycle";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n/language";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { countryName } from "@/lib/overview/meaning";
import type { CaseRef } from "@/lib/overview/snapshot";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type CardKey = "pipeline" | "geografi" | "sektor" | "tilgang" | "score" | "stadie" | "tasks";
export const CARD_KEYS: readonly CardKey[] = [
  "pipeline",
  "geografi",
  "sektor",
  "tilgang",
  "score",
  "stadie",
  "tasks",
];

/** A card that opens a sub-page. `children` is the card body. */
export function OverviewCard({
  title,
  meta,
  headerExtra,
  onOpen,
  delay = 0,
  className,
  children,
}: {
  title: string;
  /** Muted text after the title ("seneste 4 uger", "aktive cases"). */
  meta?: ReactNode;
  /** Right side of the header, before the arrow (legend, tabs). Clicks here do not open. */
  headerExtra?: ReactNode;
  onOpen: () => void;
  /** Seconds, on top of the page's stagger. */
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const t = useT();
  const open = (event: MouseEvent<HTMLElement>) => {
    // A click on something inside that has its own job (a tab, a link) never opens the card.
    if ((event.target as HTMLElement).closest("[data-no-open]")) return;
    onOpen();
  };
  return (
    <motion.section
      aria-label={title}
      onClick={open}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.56, ease: EASE.out, delay }}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col gap-3.5 overflow-hidden rounded-xl bg-canvas px-6 py-[22px] transition-[background-color,box-shadow] duration-[240ms] hover:bg-surface hover:shadow-raised",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          aria-label={t("overview.shared.open", { title })}
          className="-m-1 flex items-baseline gap-2.5 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          <span className="text-section font-semibold">{title}</span>
          {meta && <span className="text-list text-ink-4">{meta}</span>}
        </button>
        <div className="flex-1" />
        {headerExtra && <div data-no-open>{headerExtra}</div>}
        <ArrowUpRight className="size-4 text-ink-4" strokeWidth={1.75} aria-hidden />
      </div>
      {children}
    </motion.section>
  );
}

/** A card body that has too little data to draw: honest and quiet, never a row of zeros. */
export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-list leading-[1.55] text-ink-3">{children}</p>;
}

export function phaseColor(phase: CasePhase, status: CaseStatus): string {
  if (phase === "decided") return status === "invested" ? "var(--positive)" : "var(--ink-4)";
  if (phase === "committee") return "var(--warning)";
  if (phase === "deep_analysis") return "var(--ai)";
  return "var(--action)";
}

export function phaseText(
  phase: CasePhase,
  status: CaseStatus,
  language: Language = DEFAULT_LANGUAGE,
): string {
  return phase === "decided"
    ? caseStatusLabels(language)[status]
    : casePhaseLabels(language)[phase];
}

/** The numbers row on a sub-page: label above, 30 px value, counting up. */
export interface FocusStat {
  label: string;
  value: number | string;
  decimals?: number;
  suffix?: string;
}

export function FocusStats({ stats }: { stats: readonly FocusStat[] }) {
  const reduced = useReducedMotion();
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduced ? REDUCED_FADE : { duration: 0.52, ease: EASE.out, delay: 0.1 + index * 0.06 }
          }
          className="flex min-w-0 flex-col gap-1 rounded-xl bg-canvas px-[22px] py-5"
        >
          <span className="text-list text-ink-3">{stat.label}</span>
          <span className="truncate text-[30px] leading-[1.1] font-semibold tracking-display">
            {typeof stat.value === "number" ? (
              <CountUp
                value={stat.value}
                decimals={stat.decimals ?? 0}
                {...(stat.suffix ? { suffix: stat.suffix } : {})}
              />
            ) : (
              stat.value
            )}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

/** "Hvad betyder det?": sentences written in code from the real numbers; absent when empty. */
export function Meaning({ lines }: { lines: readonly string[] }) {
  const t = useT();
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-3.5 rounded-xl bg-canvas px-[26px] py-6">
      <span className="text-section font-semibold">{t("overview.meaning.title")}</span>
      {lines.map((line) => (
        <p key={line} className="m-0 max-w-[720px] text-[16px] leading-[1.7] [text-wrap:pretty]">
          {line}
        </p>
      ))}
    </div>
  );
}

/** "Cases bag tallet": exactly the cases the number counted (ids come from the same build). */
export function CasesBehind({
  ids,
  cases,
  title,
  filterLabel,
  onClearFilter,
  scoreKind = "shown",
}: {
  ids: readonly string[];
  cases: Record<string, CaseRef>;
  title?: string;
  /** "screening": the screening's score (the score distribution counts it); else the shown score. */
  scoreKind?: "shown" | "screening";
  /** Set while a filter (a country) narrows the list. */
  filterLabel?: string | null;
  onClearFilter?: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const rows = ids.map((id) => cases[id]).filter((ref): ref is CaseRef => ref !== undefined);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5 px-1.5">
        <span className="text-section font-semibold">
          {filterLabel
            ? t("overview.shared.casesIn", { filter: filterLabel })
            : (title ?? t("overview.shared.casesBehind"))}
        </span>
        <span className="text-list text-ink-4 tabular-nums">{rows.length}</span>
        {filterLabel && onClearFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="inline-flex h-7 items-center gap-1.5 rounded-pill bg-sunken px-2.5 text-meta font-medium whitespace-nowrap text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {t("overview.shared.showAll")}
            <X className="size-[11px]" aria-hidden />
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-1.5 text-list text-ink-3">{t("overview.shared.noCases")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg bg-surface p-0 shadow-card">
          {rows.map((ref, index) => (
            <li key={ref.id} className={cn(index > 0 && "border-t border-line")}>
              <Link
                to="/cases/$caseId"
                params={{ caseId: ref.id }}
                search={{ view: ref.view }}
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-3.5 px-[18px] py-1.5 transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_120px_110px_44px]"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px] font-semibold">{ref.name}</span>
                  <span className="truncate text-meta text-ink-3">
                    {[ref.sector, ref.stageLabel].filter(Boolean).join(", ") ||
                      t("overview.shared.unclassified")}
                  </span>
                </span>
                <span className="flex items-center gap-[7px] text-list whitespace-nowrap">
                  <span
                    className="size-[7px] shrink-0 rounded-full"
                    style={{ background: phaseColor(ref.phase, ref.status) }}
                    aria-hidden
                  />
                  {phaseText(ref.phase, ref.status, language)}
                </span>
                <span className="hidden truncate text-meta text-ink-3 sm:block">
                  {ref.country
                    ? countryName(ref.country, language)
                    : t("overview.shared.noCountry")}
                </span>
                <span className="text-right text-[16px] font-semibold tabular-nums">
                  {(() => {
                    const value = scoreKind === "screening" ? ref.screeningScore : ref.score;
                    return value === null ? "–" : Math.round(value);
                  })()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
