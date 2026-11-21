/**
 * "Sådan screener vi" as the case's screening page itself ("alle de kort, der er derinde, der skal
 * det være meget klart, hvor man skal gå hen for at ændre dem"). The same cards
 * a screened case shows, in the same look (ScreeningModules: canvas cards, the profile ring, the
 * mandate circles, the strengths/weaknesses bar, the finance bars), filled with the team's own
 * setup instead of a case's results. A tap on a card opens one calm sheet for that card: what it
 * shows, what Interlect looks for, and what you can change.
 *
 *   Score and threshold        ← criteria × weights, threshold (calculated in code)
 *   Profile against the thesis ← criteria and weights
 *   Mandate fit                ← your rules (binding / for assessment) and finance rules
 *   Key findings / To clarify  ← written by Interlect from your setup and your instruction
 *   Financials                 ← annual reports from the registers (no setting)
 *
 * Facts from the code (reports): scoring.ts, screening-view.ts, prompt.ts, tasks.ts,
 * finance-summary.ts, financial-gates.ts.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { InterlectMark } from "@/components/brand/InterlectMark";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { FindingBalance } from "@/components/cases/screening/ScreeningModules";
import { weightColor } from "@/components/funds/editor/WeightDonut";
import type { SaveFundConfigInput } from "@/lib/funds/config.functions";
import { financeGateTreatment, isFinanceGate } from "@/lib/analysis/financial-gates";
import { useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

type EditorState = SaveFundConfigInput;
export type ScreeningPart = "score" | "criteria" | "rules" | "findings" | "finance";

const NUMBER = "text-title leading-[1.2] font-semibold tracking-title text-ink-1";
const CARD =
  "cursor-pointer rounded-lg border-0 bg-canvas p-[22px] text-left font-[inherit] outline-none transition-[transform,box-shadow,background-color] duration-[420ms] ease-standard hover:-translate-y-[3px] hover:bg-surface hover:shadow-raised focus-visible:ring-2 focus-visible:ring-action active:scale-[.98] disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:bg-canvas disabled:hover:shadow-none disabled:active:scale-100";

/** The case page's module card, opening its sheet here. */
function MapCard({
  title,
  delay,
  onOpen,
  children,
  number,
  caption,
}: {
  title: string;
  delay: number;
  onOpen?: (() => void) | undefined;
  children: ReactNode;
  number: ReactNode;
  caption: string;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.64, ease: EASE.out, delay }}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className={cn("flex h-full w-full flex-col gap-4", CARD)}
      >
        <span className="flex items-center justify-between">
          <span className="text-list font-semibold text-ink-1">{title}</span>
          {onOpen && <ArrowUpRight className="size-4 text-ink-4" strokeWidth={1.75} aria-hidden />}
        </span>
        <span className="flex h-[104px] w-full">{children}</span>
        {number}
        <span className="text-meta leading-[1.45] text-ink-3">{caption}</span>
      </button>
    </motion.div>
  );
}

export function ScreeningMap({
  value,
  instruction,
  readOnly,
  onOpen,
}: {
  value: EditorState;
  instruction: string | null;
  readOnly?: boolean | undefined;
  /** Open a card's sheet. */
  onOpen?: ((part: ScreeningPart) => void) | undefined;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const criteria = value.criteria;
  const treatment = (gate: EditorState["gates"][number]) =>
    isFinanceGate(gate.key) ? financeGateTreatment(gate.key) : gate.treatment;
  const threshold = Math.min(100, Math.max(0, value.analysisThreshold));
  const open = (part: ScreeningPart) => (onOpen ? () => onOpen(part) : undefined);
  const hasInstruction = Boolean(instruction?.trim());
  const enter = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE }
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.64, ease: EASE.out, delay },
        };

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-list text-ink-3">
        {readOnly ? t("fundSetup.map.leadReadOnly") : t("fundSetup.map.lead")}
      </p>

      {/* The hero: Interlect's short assessment and the score against your threshold. */}
      <motion.button
        type="button"
        onClick={open("score")}
        disabled={!onOpen}
        {...enter(0.06)}
        className={cn("grid gap-6 md:grid-cols-[minmax(0,1fr)_240px]", CARD)}
      >
        <span className="flex flex-col gap-3">
          <span className="text-list font-semibold text-ink-1">
            {t("fundSetup.map.scoreTitle")}
          </span>
          <span className="max-w-[560px] text-list leading-[1.6] text-ink-3 italic">
            {t("fundSetup.map.heroExample")}
          </span>
          <span className="flex items-center gap-2 text-meta text-ink-3">
            <InterlectMark size={10} />
            {t("fundSetup.map.heroCaption")}
          </span>
        </span>
        <span className="flex flex-col items-end gap-2">
          <span className="flex items-center gap-2">
            <span className="text-[44px] leading-none font-semibold tracking-title text-ink-1 tabular-nums">
              {threshold}
            </span>
            {onOpen && (
              <ArrowUpRight className="size-4 text-ink-4" strokeWidth={1.75} aria-hidden />
            )}
          </span>
          <span className="relative mt-2 h-2 w-full rounded-pill bg-chart-track" aria-hidden>
            <motion.span
              className="absolute inset-y-0 left-0 rounded-pill"
              style={{ background: "var(--series-1)" }}
              initial={reduced ? false : { width: 0 }}
              animate={{ width: `${threshold}%` }}
              transition={reduced ? { duration: 0 } : { ...SPRING.smooth, delay: 0.3 }}
            />
            <motion.span
              className="absolute -top-1.5 h-5 w-[2px] rounded bg-ink-1"
              initial={false}
              animate={{ left: `${threshold}%` }}
              transition={reduced ? { duration: 0 } : SPRING.snappy}
            />
          </span>
          <span className="text-meta text-ink-3 tabular-nums">
            {t("fundSetup.map.thresholdCaption", { threshold })}
          </span>
        </span>
      </motion.button>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MapCard
          title={t("screening.modules.profile")}
          delay={0.14}
          onOpen={open("criteria")}
          caption={t("fundSetup.map.profileCaption")}
          number={
            <span className={NUMBER}>
              {t("fundSetup.map.criteriaCount", { count: criteria.length })}
            </span>
          }
        >
          <span className="flex w-full items-center justify-center" aria-hidden>
            {criteria.length > 0 && (
              <PieChart
                data={criteria.map((criterion, index) => ({
                  label: criterion.label,
                  value: Math.max(criterion.weight, 0.0001),
                  color: weightColor(index),
                }))}
                size={112}
                innerRadius={35}
                padAngle={(1.4 / 100) * Math.PI * 2}
                cornerRadius={0}
              >
                {criteria.map((criterion, index) => (
                  <PieSlice key={criterion.key} index={index} hoverEffect="none" />
                ))}
              </PieChart>
            )}
          </span>
        </MapCard>

        <MapCard
          title={t("screening.modules.mandate")}
          delay={0.2}
          onOpen={open("rules")}
          caption={t("fundSetup.map.mandateCaption")}
          number={
            <span className={NUMBER}>
              {t("fundSetup.map.rulesCount", { count: value.gates.length })}
            </span>
          }
        >
          <span className="flex w-full flex-wrap content-center items-center gap-2" aria-hidden>
            {value.gates.slice(0, 8).map((gate, index) => {
              const hard = treatment(gate) === "hard";
              // Neutral rings, as before a case is screened: on the case they turn green, red or
              // stay empty. A binding rule carries a small red dot.
              return (
                <motion.span
                  key={gate.key}
                  className="grid size-9 place-items-center rounded-full bg-surface"
                  style={{ boxShadow: "inset 0 0 0 1.5px var(--line-strong)" }}
                  initial={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={
                    reduced ? REDUCED_FADE : { ...SPRING.snappy, delay: 0.3 + index * 0.05 }
                  }
                >
                  {hard && <span className="size-2 rounded-full bg-critical" />}
                </motion.span>
              );
            })}
          </span>
        </MapCard>

        <MapCard
          title={t("screening.modules.findings")}
          delay={0.26}
          onOpen={open("findings")}
          caption={
            hasInstruction
              ? t("fundSetup.map.findingsCaptionOwn")
              : t("fundSetup.map.findingsCaption")
          }
          number={
            <span className="flex w-full items-baseline justify-between">
              <span className={NUMBER}>3–8</span>
              <span className="text-meta text-ink-3">{t("fundSetup.map.findingsNumber")}</span>
            </span>
          }
        >
          <span className="flex w-full flex-col justify-center gap-3.5">
            <FindingBalance up={1} down={1} height={12} />
            <span className="flex justify-between text-meta text-ink-3">
              <span>{t("screening.modules.strengths")}</span>
              <span>{t("screening.modules.weaknesses")}</span>
            </span>
          </span>
        </MapCard>

        <MapCard
          title={t("screening.modules.finance")}
          delay={0.32}
          onOpen={open("finance")}
          caption={t("fundSetup.map.financeCaption")}
          number={
            <span className="text-section font-semibold text-ink-1">
              {t("fundSetup.map.financeNumber")}
            </span>
          }
        >
          <span className="flex w-full items-end gap-2 px-1" aria-hidden>
            {[38, 52, 70, 100].map((height, index) => (
              <motion.span
                key={height}
                className="flex-1 rounded-[7px_7px_3px_3px]"
                style={{
                  height: `${height}%`,
                  background:
                    index === 3
                      ? "var(--series-1)"
                      : "color-mix(in srgb, var(--series-1) 35%, transparent)",
                  transformOrigin: "bottom",
                }}
                initial={reduced ? { opacity: 0 } : { scaleY: 0, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={
                  reduced
                    ? REDUCED_FADE
                    : { duration: 0.7, ease: EASE.out, delay: 0.3 + index * 0.07 }
                }
              />
            ))}
          </span>
        </MapCard>
      </div>

      {/* To clarify: as on the case, a list. */}
      <motion.button
        type="button"
        onClick={open("findings")}
        disabled={!onOpen}
        {...enter(0.38)}
        className={cn("flex flex-col gap-3", CARD)}
      >
        <span className="flex items-center justify-between">
          <span className="text-section font-semibold text-ink-1">
            {t("fundSetup.map.clarifyTitle")}
          </span>
          {onOpen && <ArrowUpRight className="size-4 text-ink-4" strokeWidth={1.75} aria-hidden />}
        </span>
        <span className="overflow-hidden rounded-md bg-surface">
          {[t("fundSetup.map.clarifyExample1"), t("fundSetup.map.clarifyExample2")].map(
            (label, index) => (
              <span
                key={label}
                className={cn(
                  "flex items-center gap-3 px-4 py-3.5",
                  index > 0 && "border-t border-line",
                )}
              >
                <span className="size-7 shrink-0 rounded-[9px] bg-sunken" aria-hidden />
                <span className="text-list text-ink-3 italic">{label}</span>
                <span className="ml-auto text-micro font-medium text-ink-4">
                  {t("fundSetup.map.exampleLabel")}
                </span>
              </span>
            ),
          )}
        </span>
        <span className="text-meta leading-[1.45] text-ink-3">
          {t("fundSetup.map.clarifyCaption")}
        </span>
      </motion.button>
    </div>
  );
}
