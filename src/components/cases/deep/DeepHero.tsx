/**
 * The top of Konklusion (Case Dyb analyse v5, lines 70–85): the overall score with the change
 * since screening and one sentence, and the bridge "Fra screening til dyb analyse" ("Dyb analyse
 * v5"; gap/ choice: no risk deduction, one step per specialist).
 *
 * Measured in the prototype: card canvas, radius xl, padding 30 32, grid min 340 px with gaps
 * 28 / 40; label 13/600 ink-2; score 104/600, tracking -0.055em, leading .82; delta 18/600 with
 * a trend icon, "siden screening (N)" 12 ink-3; text 16/1.6, max 460; bridge rows 26 px high,
 * grid 140 px / bar / 46 px with gap 10, bars 12 px (totals) and 10 px (steps), radius 6, the
 * threshold as a dashed 1.5 px line in --action; caption 12 ink-3. Bars grow from the left in
 * 700 ms, 200 ms + 110 ms per row.
 *
 * ("som prototypen"): the top says the conclusion in about two lines; the rest of the
 * assessment and "Det stærkeste modargument" fold out under "Læs mere" instead of standing as a
 * long block under the score.
 */
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapse } from "@/components/ds/Collapse";
import { motion, useReducedMotion } from "motion/react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { CountUp } from "@/components/ds/CountUp";
import { bridgeDomain, type BridgeStep } from "@/lib/cases/deep-view";
import {
  formatScore,
  formatSignedPoints,
  formatWholeScore,
  scoreChange,
  wholeScore,
} from "@/lib/cases/screening-view";
import type { Language } from "@/lib/i18n/language";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";

function stepValue(step: BridgeStep, language: Language): string {
  return step.kind === "total"
    ? formatScore(step.value, language)
    : formatSignedPoints(step.value, language);
}

export function DeepHero({
  score,
  screeningScore,
  threshold,
  conclusion,
  conclusionMore = null,
  recommendation,
  onWhy,
  counterThesis,
  bridge,
  onOpenStep,
}: {
  score: number | null;
  screeningScore: number | null;
  threshold: number | null;
  /** About two lines: the deep analysis's conclusion. */
  conclusion: string;
  /** The rest of the assessment, folded out under "Læs mere"; null when there is none. */
  conclusionMore?: string | null;
  /** "Gå videre" etc., or null. */
  recommendation: string | null;
  onWhy: () => void;
  counterThesis: string | null;
  bridge: readonly BridgeStep[] | null;
  /** A specialist step opens that specialist's tab. */
  onOpenStep: (key: string) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const [more, setMore] = useState(false);
  const moreId = useId();
  const hasMore = Boolean(conclusionMore || counterThesis);
  const delta =
    score !== null && screeningScore !== null ? scoreChange(score, screeningScore) : null;
  const deltaTone =
    delta === null || delta === 0 ? "text-ink-3" : delta > 0 ? "text-positive" : "text-critical";
  const Trend = delta !== null && delta < 0 ? TrendingDown : TrendingUp;
  return (
    <motion.section
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-x-10 gap-y-7 rounded-xl bg-canvas p-5 md:px-8 md:py-[30px]",
        // Folded out, the bridge stays where it was instead of moving to the new middle.
        more ? "items-start" : "items-center",
      )}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.6, ease: EASE.out, delay: 0.06 }}
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <span className="text-list font-semibold text-ink-2">{t("deep.hero.totalScore")}</span>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <span
            className="text-[80px] leading-[.82] font-semibold tracking-[-0.055em] tabular-nums md:text-[104px]"
            aria-label={
              score === null
                ? t("deep.hero.noScore")
                : t("deep.hero.score", { score: formatWholeScore(score, language) })
            }
          >
            {score === null ? (
              "–"
            ) : (
              <CountUp value={wholeScore(score)} decimals={0} duration={1300} />
            )}
          </span>
          {delta !== null && screeningScore !== null && (
            <span className="flex flex-col gap-0.5 pb-1">
              <span
                className={cn("flex items-center gap-1.5 text-[18px] font-semibold", deltaTone)}
              >
                <Trend className="size-[18px]" strokeWidth={1.75} aria-hidden />
                {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
                {formatScore(Math.abs(delta), language)}
              </span>
              <span className="text-meta text-ink-3">
                {t("deep.hero.sinceScreening", {
                  score: formatWholeScore(screeningScore, language),
                })}
              </span>
            </span>
          )}
        </div>
        <p className="m-0 max-w-[460px] text-base leading-[1.6] text-pretty text-ink-1">
          {conclusion}
        </p>
        {recommendation && (
          <div className="flex flex-wrap items-center gap-x-2 text-meta text-ink-3">
            {recommendation}
            <button
              type="button"
              onClick={onWhy}
              className="text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
            >
              {t("deep.hero.why")}
            </button>
          </div>
        )}
        {hasMore && (
          <div className="flex max-w-[460px] flex-col">
            <button
              type="button"
              aria-expanded={more}
              aria-controls={moreId}
              onClick={() => setMore((value) => !value)}
              className="flex w-fit items-center gap-1.5 text-meta font-medium text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
            >
              {more ? t("deep.hero.readLess") : t("deep.hero.readMore")}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-300 ease-standard",
                  more && "rotate-180",
                )}
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
            <Collapse open={more} id={moreId} className="flex flex-col gap-3 pt-3">
              {conclusionMore && (
                <p className="m-0 text-list leading-[1.6] text-pretty text-ink-1">
                  {conclusionMore}
                </p>
              )}
              {counterThesis && (
                <div className="flex flex-col gap-1 border-t border-line-strong/60 pt-3">
                  <span className="text-meta font-semibold text-ink-3">
                    {t("deep.hero.counterThesis")}
                  </span>
                  <p className="m-0 text-list leading-[1.55] text-ink-2">{counterThesis}</p>
                </div>
              )}
            </Collapse>
          </div>
        )}
      </div>
      {bridge && (
        <Bridge steps={bridge} threshold={threshold} onOpenStep={onOpenStep} reduced={!!reduced} />
      )}
    </motion.section>
  );
}

function Bridge({
  steps,
  threshold,
  onOpenStep,
  reduced,
}: {
  steps: readonly BridgeStep[];
  threshold: number | null;
  onOpenStep: (key: string) => void;
  reduced: boolean;
}): ReactNode {
  const t = useT();
  const language = useLanguage();
  const { lo, hi } = bridgeDomain(steps, threshold);
  const at = (value: number) => ((Math.max(lo, Math.min(hi, value)) - lo) / (hi - lo)) * 100;
  const thresholdAt = threshold === null ? null : at(threshold) / 100;
  // A step that belongs to a specialist opens its tab; Screening, the remainder and Dyb
  // analyse are not links.
  const linkable = (step: BridgeStep) => step.kind === "delta" && step.key !== "ovrige-aendringer";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className="text-list font-semibold text-ink-2">{t("deep.hero.bridgeTitle")}</span>
      <div className="relative flex flex-col gap-1.5">
        {thresholdAt !== null && (
          <div
            className="absolute -top-1 -bottom-1 z-[1] border-l-[1.5px] border-dashed border-action"
            style={{ left: `calc(150px + (100% - 206px) * ${thresholdAt})` }}
            aria-hidden
          >
            <span className="absolute -top-3.5 left-1 text-micro whitespace-nowrap text-action">
              {t("deep.hero.threshold", { score: formatScore(threshold, language) })}
            </span>
          </div>
        )}
        {steps.map((step, index) => {
          const total = step.kind === "total";
          const start = total ? lo : Math.min(step.from, step.to);
          const end = Math.max(step.from, step.to);
          const left = at(start);
          const width = Math.max(0.8, at(end) - left);
          const tone =
            total || step.value === 0
              ? "text-ink-1"
              : step.value > 0
                ? "text-positive"
                : "text-critical";
          const label = (
            <span
              className={cn(
                "truncate text-[13px]",
                total ? "font-semibold text-ink-1" : "text-ink-2",
              )}
            >
              {step.label}
            </span>
          );
          return (
            <div
              key={step.key}
              className="grid h-[26px] grid-cols-[140px_minmax(0,1fr)_46px] items-center gap-2.5"
            >
              {linkable(step) ? (
                <button
                  type="button"
                  onClick={() => onOpenStep(step.key)}
                  className="min-w-0 text-left outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
                >
                  {label}
                </button>
              ) : (
                label
              )}
              <div className={cn("relative", total ? "h-3" : "h-2.5")}>
                <motion.div
                  className="absolute inset-y-0 rounded-md"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: step.color,
                    transformOrigin: "left",
                  }}
                  initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
                  animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
                  transition={
                    reduced
                      ? REDUCED_FADE
                      : { duration: 0.7, ease: EASE.out, delay: 0.2 + index * 0.11 }
                  }
                />
              </div>
              <span className={cn("text-right text-[13px] font-semibold", tone)}>
                {stepValue(step, language)}
              </span>
            </div>
          );
        })}
      </div>
      <span className="text-meta text-ink-3">{t("deep.hero.bridgeNote")}</span>
    </div>
  );
}
