/**
 * The top of the screening (Case Screening v5, lines 48–77): the case top (phase switcher,
 * status chip, split button), the breadcrumb, the company name, the summary with "Læs mere om
 * virksomheden", Interlect's recommendation with "Hvorfor?", and the score on the right with
 * the bar and the threshold.
 *
 * Measured in the prototype: row wrap-reverse, gap 24/48; left column flex 1 1 440, gap 14;
 * name 44/600 display tracking, 1.05; meta 15 ink-3; summary 17/1.65 ink-2, max 680; sections
 * 13/600 over 16/1.65 ink-2, gap 14, fold-out 560 ms; recommendation 12 px ink-3 with the mark
 * in --ai. Score 104/600, tracking -0.055em, leading .85; bar 200 × 8 on the chart track with a
 * series-5 → series-1 gradient and a 2 px ink threshold mark (±5 px); "Tærskel N" 12 ink-3.
 * "Genberegner" (orb) stands above the score while a team answer is recalculated; the score
 * dims to.3 and then counts to its new value (never "+N point").
 *
 * The summary stands at most three lines; a longer one is cut with "…" and "Læs mere"
 * shows the rest with the profile sections. The score's tight tracking paints the last digit
 * past its box, so the block clips 8 px further out and the digit is never cut.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AiOrb } from "@/components/ai/AiOrb";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { Collapse } from "@/components/ds/Collapse";
import { CountUp } from "@/components/ds/CountUp";
import { formatScore, formatWholeScore, wholeScore } from "@/lib/cases/screening-view";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

export function ScreeningHero({
  top,
  companyName,
  meta,
  summary,
  profileSections,
  recommendation,
  onWhy,
  score,
  threshold,
  recalculating,
}: {
  /** CaseTop: phase switcher, status chip and split button. */
  top: ReactNode;
  companyName: string;
  /** "Seed, Aquatech, Danmark". */
  meta: string;
  summary: string | null;
  profileSections: readonly { heading: string; text: string }[];
  recommendation: string | null;
  onWhy: () => void;
  score: number | null;
  threshold: number | null;
  recalculating: boolean;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const moreId = useId();
  const [more, setMore] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const [summaryCut, setSummaryCut] = useState(false);

  // Measured only while folded: unfolded, the paragraph has no clamp to overflow.
  useEffect(() => {
    const el = summaryRef.current;
    if (!el || more) return;
    const measure = () => setSummaryCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [summary, more]);

  return (
    <div className="flex flex-wrap-reverse items-start gap-x-12 gap-y-6">
      <motion.div
        className="flex min-w-0 flex-[1_1_440px] flex-col gap-3.5"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.6, ease: EASE.out }}
      >
        {top}
        <nav
          aria-label={t("screening.hero.breadcrumb")}
          className="flex items-center gap-2 text-meta whitespace-nowrap text-ink-4"
        >
          <Link to="/cases" className="text-ink-4 hover:text-ink-1 hover:no-underline">
            {t("nav.cases")}
          </Link>
          <ChevronRight className="size-[11px]" strokeWidth={1.75} aria-hidden />
          <span>{t("screening.hero.screened")}</span>
        </nav>
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h1 className="m-0 text-[34px] leading-[1.05] font-semibold tracking-display [overflow-wrap:anywhere] md:text-[44px]">
            {companyName}
          </h1>
          {meta && <span className="min-w-0 text-[15px] text-ink-3">{meta}</span>}
        </div>
        {summary && (
          <p
            ref={summaryRef}
            className={cn(
              "m-0 max-w-[680px] text-[17px] leading-[1.65] text-pretty text-ink-2",
              !more && "line-clamp-3",
            )}
          >
            {summary}
          </p>
        )}
        {(profileSections.length > 0 || summaryCut) && (
          <>
            <Collapse open={more} id={moreId}>
              <div className="flex max-w-[680px] flex-col gap-3.5 pt-1.5">
                {profileSections.map((section) => (
                  <div key={section.heading} className="flex flex-col gap-1">
                    <span className="text-list font-semibold text-ink-1">{section.heading}</span>
                    <p className="m-0 text-base leading-[1.65] text-pretty text-ink-2">
                      {section.text}
                    </p>
                  </div>
                ))}
              </div>
            </Collapse>
            <button
              type="button"
              onClick={() => setMore((open) => !open)}
              aria-expanded={more}
              aria-controls={moreId}
              className="inline-flex h-8 items-center gap-1.5 self-start pr-3 text-list font-medium whitespace-nowrap text-ink-1 outline-none transition-colors duration-[var(--dur-quick)] hover:text-action focus-visible:ring-2 focus-visible:ring-action"
            >
              {more ? t("screening.hero.readLess") : t("screening.hero.readMore")}
              <motion.span
                className="inline-flex"
                animate={{ rotate: more ? 180 : 0 }}
                transition={reduced ? { duration: 0 } : SPRING.smooth}
              >
                <ChevronDown className="size-[13px]" strokeWidth={1.75} aria-hidden />
              </motion.span>
            </button>
          </>
        )}
        {recommendation && (
          <div className="flex items-center gap-2 text-meta text-ink-3">
            <InterlectMark size={13} tone="current" className="text-ai" />
            {recommendation}
            <button
              type="button"
              onClick={onWhy}
              className="text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
            >
              {t("screening.hero.why")}
            </button>
          </div>
        )}
      </motion.div>
      <ScoreBlock score={score} threshold={threshold} recalculating={recalculating} />
    </div>
  );
}

function ScoreBlock({
  score,
  threshold,
  recalculating,
}: {
  score: number | null;
  threshold: number | null;
  recalculating: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const width = score === null ? 0 : Math.max(0, Math.min(100, score));
  // The counting number paints its hidden digits beside it; the block clips them, so the page
  // never scrolls sideways. The clip edge sits 8 px outside the layout (padding with a negative
  // margin; overflow-clip-margin needs clip on both axes and is missing in Safari), because the
  // -0.055em tracking paints the last digit past its box.
  return (
    <div className="-mr-2 ml-auto flex max-w-full flex-none flex-col items-end gap-2.5 overflow-x-clip pr-2">
      <div
        className="flex h-[18px] items-center gap-2 text-meta whitespace-nowrap"
        aria-live="polite"
      >
        {recalculating && (
          <motion.span
            className="inline-flex items-center gap-2 text-ink-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <AiOrb size={20} tone="ai" state="working" />
            {t("screening.hero.recalculating")}
          </motion.span>
        )}
      </div>
      <span
        className={cn(
          "text-[80px] leading-[.85] font-semibold tracking-[-0.055em] tabular-nums transition-opacity duration-300 md:text-[104px]",
          // NumberFlow fades everything outside its number box; give the last digit's overhang
          // room inside the box without moving the number.
          "[&_number-flow-react]:-mr-[0.08em] [&_number-flow-react::part(number)]:pr-[0.08em]",
          recalculating && "opacity-30",
        )}
        aria-label={
          score === null
            ? t("screening.hero.noScore")
            : t("screening.hero.score", { score: formatWholeScore(score, language) })
        }
      >
        {score === null ? "–" : <CountUp value={wholeScore(score)} decimals={0} duration={1300} />}
      </span>
      <div className="relative h-2 w-[200px] rounded-[4px] bg-[var(--chart-track)]" aria-hidden>
        <motion.div
          className="absolute inset-y-0 left-0 rounded-[4px] bg-[linear-gradient(90deg,var(--series-5),var(--series-1))]"
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={reduced ? { duration: 0 } : { duration: 1.3, ease: EASE.out, delay: 0.25 }}
        />
        {threshold !== null && (
          <div
            className="absolute -top-[5px] -bottom-[5px] w-0.5 rounded-[1px] bg-ink-1"
            style={{ left: `${Math.max(0, Math.min(100, threshold))}%` }}
          />
        )}
      </div>
      {threshold !== null && (
        <span className="text-meta whitespace-nowrap text-ink-3">
          {t("screening.hero.threshold", { score: formatScore(threshold, language) })}
        </span>
      )}
    </div>
  );
}
