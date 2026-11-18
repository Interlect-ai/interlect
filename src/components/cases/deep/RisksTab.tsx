/**
 * The Risici tab ("Risikoanalyse"; Case Dyb analyse v5, lines 115–130, script `matrix` and
 * `risks`): the 5 × 5 matrix with numbered markers and the list of risks. Matrix and list share
 * one order and one numbering (critical first, `numberRisks`); hovering or focusing a marker
 * highlights its row and the other way round; a click folds the row out with "Begrundelse" and
 * "Det skal afklares eller reduceres".
 *
 * Measured: max 820, the box canvas radius xl, padding 22 24, gap 14; the matrix cells
 * aspect 1.6, radius 8, gap 4, markers 22 px (11/600, white on ink, critical on red); the list
 * on a surface card (radius lg) with hairlines, rows min 52 px, padding 8 14, grid
 * 24 / 1fr / auto / 18, name 14/600, a four-step meter (6 × 12, radius 2) and the level; open
 * content padding 0 16 18 50 with two axis boxes (radius 10, five 4 px segments), then the two
 * texts at 14/1.6.
 *
 * Risks without coordinates are in the list only (no invented position). Every text is the
 * model's own (`statement`, `mitigation`), the level is its own rating.
 */
import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { Collapse } from "@/components/ds/Collapse";
import {
  hasRiskCoordinates,
  matrixCells,
  numberRisks,
  rationaleParagraphs,
  riskLevelSteps,
  type NumberedRisk,
} from "@/lib/cases/deep-view";
import { riskTitle } from "@/lib/cases/risk-title";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { HEAT_BACKGROUND, riskMarkerColor, riskMarkerInk } from "./risk-style";
import type { RiskView } from "@/lib/cases/view-model";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function RisksTab({ risks }: { risks: readonly RiskView[] }) {
  const t = useT();
  const reduced = useReducedMotion();
  const listId = useId();
  const numbered = numberRisks(risks);
  const cells = matrixCells(numbered);
  const placed = numbered.some((entry) => hasRiskCoordinates(entry.risk));
  const [open, setOpen] = useState<number | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const rows = useRef(new Map<number, HTMLElement>());

  const openRisk = (number: number) => setOpen((current) => (current === number ? null : number));
  // A marker click folds its row out and brings it into view once the row has expanded (the
  // fold-out tweens the height, so scrolling at once would aim at the closed row).
  useEffect(() => {
    if (open === null) return;
    const timer = window.setTimeout(
      () =>
        rows.current
          .get(open)
          ?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }),
      reduced ? 0 : 320,
    );
    return () => window.clearTimeout(timer);
  }, [open, reduced]);

  return (
    <div className="flex flex-col gap-3.5">
      <motion.div
        className="flex flex-col gap-3.5 rounded-xl bg-canvas px-4 py-5 md:px-6 md:py-[22px]"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.6, ease: EASE.out, delay: 0.06 }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-section font-semibold">
            {placed ? t("deep.risks.matrix") : t("deep.risks.profile")}
          </span>
          <span className="text-meta text-ink-3">
            {t("deep.risks.found", { count: numbered.length })}
          </span>
        </div>
        {/* Wide screens: the matrix stands beside the list instead of leaving an empty margin. */}
        <div
          className={cn(
            "flex flex-col gap-3.5",
            placed &&
              "lg:grid lg:grid-cols-[minmax(360px,1fr)_minmax(0,1.2fr)] lg:items-start lg:gap-7",
          )}
        >
          {placed && (
            <div className="flex flex-col gap-3.5 lg:sticky lg:top-20">
              <div className="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2">
                <span className="text-center text-micro text-ink-4 [transform:rotate(180deg)] [writing-mode:vertical-rl]">
                  {t("deep.risks.impact")}
                </span>
                <div
                  className="grid grid-cols-5 gap-1"
                  role="group"
                  aria-label={t("deep.risks.matrixLabel")}
                >
                  {cells.map((cell) => (
                    <div
                      key={`${cell.likelihood}-${cell.impact}`}
                      className="relative flex aspect-[1.4] items-center justify-center gap-[3px] rounded-[8px]"
                      style={{ background: HEAT_BACKGROUND[cell.band] }}
                    >
                      {cell.entries.map((entry) => (
                        <Marker
                          key={entry.number}
                          entry={entry}
                          active={hot === entry.number || open === entry.number}
                          onHot={setHot}
                          onOpen={openRisk}
                          controls={open === entry.number ? `${listId}-${entry.number}` : undefined}
                          reduced={Boolean(reduced)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-between pl-[26px] text-micro text-ink-4">
                <span>{t("deep.risks.low")}</span>
                <span>{t("deep.risks.likelihood")}</span>
                <span>{t("deep.risks.high")}</span>
              </div>
            </div>
          )}
          <div className="flex flex-col overflow-hidden rounded-lg bg-surface shadow-card">
            {numbered.map((entry, index) => (
              <RiskRow
                key={entry.number}
                entry={entry}
                first={index === 0}
                open={open === entry.number}
                hot={hot === entry.number}
                panelId={`${listId}-${entry.number}`}
                onHot={setHot}
                onToggle={openRisk}
                register={(element) => {
                  if (element) rows.current.set(entry.number, element);
                  else rows.current.delete(entry.number);
                }}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Marker({
  entry,
  active,
  onHot,
  onOpen,
  controls,
  reduced,
}: {
  entry: NumberedRisk<RiskView>;
  active: boolean;
  onHot: (number: number | null) => void;
  onOpen: (number: number) => void;
  controls: string | undefined;
  reduced: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const color = riskMarkerColor(entry.risk.level);
  return (
    <motion.button
      type="button"
      aria-label={t("deep.risks.marker", {
        number: entry.number,
        title: riskTitle(entry.risk, language),
      })}
      aria-controls={controls}
      onClick={() => onOpen(entry.number)}
      onMouseEnter={() => onHot(entry.number)}
      onMouseLeave={() => onHot(null)}
      onFocus={() => onHot(entry.number)}
      onBlur={() => onHot(null)}
      className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full border-0 text-micro font-semibold outline-none focus-visible:ring-2 focus-visible:ring-action"
      style={{
        background: color,
        color: riskMarkerInk(entry.risk.level),
        boxShadow: active
          ? `0 0 0 3px var(--bg-surface), 0 0 0 5px ${color}`
          : "0 0 0 0 transparent",
      }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: active && !reduced ? 1.18 : 1 }}
      transition={
        reduced ? REDUCED_FADE : { ...SPRING.snappy, delay: active ? 0 : 0.4 + entry.number * 0.08 }
      }
    >
      {entry.number}
    </motion.button>
  );
}

function RiskRow({
  entry,
  first,
  open,
  hot,
  panelId,
  onHot,
  onToggle,
  register,
}: {
  entry: NumberedRisk<RiskView>;
  first: boolean;
  open: boolean;
  hot: boolean;
  panelId: string;
  onHot: (number: number | null) => void;
  onToggle: (number: number) => void;
  register: (element: HTMLElement | null) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const { risk, number } = entry;
  const steps = riskLevelSteps(risk.level);
  const paragraphs = rationaleParagraphs(risk.statement);
  const axes = hasRiskCoordinates(risk)
    ? ([
        [t("deep.risks.likelihood"), risk.likelihood as number],
        [t("deep.risks.impact"), risk.impact as number],
      ] as const)
    : null;
  return (
    <div
      ref={register}
      onMouseEnter={() => onHot(number)}
      onMouseLeave={() => onHot(null)}
      className={cn(
        "transition-colors duration-200",
        !first && "border-t border-line",
        open || hot ? "bg-canvas" : "bg-transparent",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(number)}
        onFocus={() => onHot(number)}
        onBlur={() => onHot(null)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="grid min-h-[52px] w-full grid-cols-[24px_minmax(0,1fr)_auto_18px] items-center gap-x-3 px-3.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-inset"
      >
        <span
          className="grid size-[22px] place-items-center rounded-full text-micro font-semibold"
          style={{ background: riskMarkerColor(risk.level), color: riskMarkerInk(risk.level) }}
        >
          {number}
        </span>
        <span className="min-w-0 text-[14px] font-semibold text-ink-1">
          {riskTitle(risk, language)}
        </span>
        <span className="flex items-center gap-2 text-meta text-ink-3">
          <span className="inline-flex gap-0.5" aria-hidden>
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className="h-3 w-1.5 rounded-[2px]"
                style={{
                  background:
                    step <= steps
                      ? risk.level === "critical"
                        ? "var(--critical)"
                        : "var(--warning)"
                      : "var(--chart-track)",
                }}
              />
            ))}
          </span>
          {t(`deep.level.${risk.level}`)}
        </span>
        <motion.span
          className="inline-flex text-ink-4"
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduced ? { duration: 0 } : SPRING.smooth}
        >
          <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
        </motion.span>
      </button>
      <Collapse open={open} id={panelId}>
        <div className="flex flex-col gap-3 px-4 pt-0 pb-[18px] md:pl-[50px]">
          {axes && (
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              {axes.map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-col gap-1.5 rounded-[10px] bg-canvas px-3 py-2.5"
                >
                  <span className="flex justify-between text-meta">
                    <span className="text-ink-3">{label}</span>
                    <span className="font-semibold tabular-nums">{value}/5</span>
                  </span>
                  <span className="grid grid-cols-5 gap-[3px]" aria-hidden>
                    {[1, 2, 3, 4, 5].map((step) => (
                      <span
                        key={step}
                        className="h-1 rounded-[2px]"
                        style={{
                          background: step <= value ? "var(--ink-2)" : "var(--chart-track)",
                        }}
                      />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-meta font-semibold text-ink-3">{t("deep.risks.reasoning")}</span>
            <div className="flex max-w-[720px] flex-col gap-2.5">
              {paragraphs.map((paragraph, index) => (
                <p key={index} className="m-0 text-[14px] leading-[1.6] text-ink-1">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
          {risk.mitigation && (
            <div className="flex flex-col gap-1">
              <span className="text-meta font-semibold text-ink-3">
                {t("deep.risks.mitigation")}
              </span>
              <p className="m-0 max-w-[720px] text-[14px] leading-[1.6] text-ink-2">
                {risk.mitigation}
              </p>
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}
