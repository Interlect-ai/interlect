/**
 * A specialist's tab (Case Dyb analyse v5, lines 134–155; "Dyb analyse v3": "Fanen giver
 * begrundelsen"): the gauge with the change since screening and a short reading, what
 * pulls up and down, and "Kriterierne mod tesen", the one place a criterion's reasoning stands.
 *
 * Measured: hero card canvas, radius xl, padding 26 28, gap 32, gauge 160 × 94; "Specialist: X"
 * 13 ink-3 with the change 13/600; reading 17/1.6, max 640. Criteria: one surface (radius lg,
 * card shadow) with hairlines; rows min 62 px, padding 8 22, grid 200 / 70 / bar / 40 / 18,
 * gap 16; name 15/600, "vægt N %" 12 ink-4, bar 8 px on the chart track with a 2 px mark at
 * the screening score, score 17/600; open row on canvas; text 16/1.72 in paragraphs (max 720),
 * "Det trækker op / ned" in surface boxes with a 1 px ring, "Mangler at blive bekræftet".
 *
 * "Analyserne" (`Analyses.tsx`): cards → sub-pages from the specialist's sourced data
 * and from the categories it has findings in; none when it has neither. The tab and its
 * sub-pages draw in the specialist's colour, the criteria's bars too.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  FileText,
  MessageCircleQuestion,
} from "lucide-react";
import { Collapse } from "@/components/ds/Collapse";
import {
  rationaleParagraphs,
  type CriterionRow,
  type SpecialistGroup,
} from "@/lib/cases/deep-view";
import { formatScore } from "@/lib/cases/screening-view";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AnalysesSection, type AnalysisCard } from "./Analyses";
import { Gauge } from "./Gauge";

// Measured after layout in the browser; on the server there is nothing to measure.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The reading at the top of the tab: two lines as in the prototype, and "Læs mere"
 * folds out the whole thorough description ("det er vigtigt man kan folde ud og læse og det ikke
 * kun er de 2 linjer"). The button is only there when the text is longer than two lines.
 */
function ReadingTop({ text }: { text: string }) {
  const t = useT();
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const id = useId();
  useBrowserLayoutEffect(() => {
    const node = ref.current;
    if (!node || open) return;
    const measure = () => setClipped(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [text, open]);
  return (
    <div className="flex max-w-[640px] flex-col items-start gap-1.5">
      <p
        ref={ref}
        id={id}
        className={cn(
          "m-0 text-[17px] leading-[1.6] text-pretty text-ink-1",
          !open && "line-clamp-2",
        )}
      >
        {text}
      </p>
      {(clipped || open) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 text-list font-medium text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
        >
          {open ? t("deep.specialist.readLess") : t("deep.specialist.readMore")}
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-300 ease-standard",
              open && "rotate-180",
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
      )}
    </div>
  );
}

function deltaParts(delta: number | null): { text: string; tone: string } | null {
  if (delta === null) return null;
  return {
    text: `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta)}`,
    tone: delta < 0 ? "text-critical" : delta > 0 ? "text-positive" : "text-ink-3",
  };
}

export function SpecialistTab({
  group,
  cards,
  returnTo,
  onTopic,
  onEvidence,
}: {
  group: SpecialistGroup;
  /** "Analyserne": the specialist's data and the categories it has findings in. */
  cards: readonly AnalysisCard[];
  /** The card whose sub-page was just closed (focus goes back to it). */
  returnTo?: string | null | undefined;
  onTopic: (key: string) => void;
  /** "se evidens": the sources behind the score (the "Hvorfor?" page). */
  onEvidence: () => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const change = deltaParts(group.delta);
  const rise = (delay: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: reduced ? REDUCED_FADE : { duration: 0.56, ease: EASE.out, delay },
  });
  return (
    <div className="flex flex-col gap-[22px]">
      <motion.section
        className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-8 gap-y-5 rounded-xl bg-canvas p-5 max-sm:grid-cols-1 md:px-7 md:py-[26px]"
        {...rise(0)}
      >
        <Gauge value={group.score} color={group.color} label={group.label} />
        <div className="flex min-w-0 flex-col gap-2">
          <span className="flex flex-wrap items-center gap-x-2.5 text-list text-ink-3">
            {t("deep.specialist.specialistName", { label: group.label })}
            {change && (
              <span className={cn("font-semibold", change.tone)}>
                {change.text} {t("deep.specialist.sinceScreening")}
              </span>
            )}
          </span>
          {group.summary && <ReadingTop text={group.summary} />}
        </div>
      </motion.section>

      {(group.strengths.length > 0 || group.weaknesses.length > 0) && (
        <motion.div
          className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3"
          {...rise(0.1)}
        >
          <DriverBox
            title={t("deep.specialist.strengths")}
            items={group.strengths}
            tone="positive"
          />
          <DriverBox
            title={t("deep.specialist.weaknesses")}
            items={group.weaknesses}
            tone="warning"
          />
        </motion.div>
      )}

      {group.criteria.length === 0 ? (
        <motion.section className="flex flex-col gap-3" {...rise(0.16)}>
          <p className="m-0 max-w-[720px] px-1.5 text-meta text-ink-3">
            {t("deep.specialist.noCriteria")}
          </p>
          <OwnList
            title={t("deep.specialist.questions")}
            items={group.questions}
            icon={MessageCircleQuestion}
          />
          <OwnList
            title={t("deep.specialist.unconfirmed")}
            items={group.unknowns}
            icon={CircleHelp}
          />
        </motion.section>
      ) : (
        <motion.section className="flex flex-col gap-2.5" {...rise(0.16)}>
          <span className="flex flex-wrap items-baseline justify-between gap-3 px-1.5">
            <span className="text-section font-semibold">{t("deep.specialist.criteria")}</span>
            <span className="text-meta text-ink-3">{t("deep.specialist.criteriaHint")}</span>
          </span>
          <div className="flex flex-col overflow-hidden rounded-lg bg-surface shadow-card">
            {group.criteria.map((row, index) => (
              <CriterionLine
                key={row.criterionKey}
                row={row}
                color={group.color}
                first={index === 0}
                delay={index * 0.05}
                onEvidence={onEvidence}
              />
            ))}
          </div>
        </motion.section>
      )}

      <AnalysesSection cards={cards} color={group.color} onOpen={onTopic} returnTo={returnTo} />
    </div>
  );
}

/** A specialist without criteria: its own questions or open points, in the drivers' box style. */
function OwnList({
  title,
  items,
  icon: Icon,
}: {
  title: string;
  items: readonly string[];
  icon: typeof CircleHelp;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-canvas p-5">
      <span className="flex items-center gap-[7px] text-list font-semibold text-ink-2">
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        {title}
      </span>
      {items.map((item) => (
        <span key={item} className="text-[14px] leading-normal text-ink-2">
          {item}
        </span>
      ))}
    </div>
  );
}

function DriverBox({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly string[];
  tone: "positive" | "warning";
}) {
  if (items.length === 0) return null;
  const Icon = tone === "positive" ? CircleCheck : CircleAlert;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-canvas p-5">
      <span
        className={cn(
          "flex items-center gap-[7px] text-list font-semibold",
          tone === "positive" ? "text-positive" : "text-warning",
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        {title}
      </span>
      {items.slice(0, 5).map((item) => (
        <span key={item} className="text-[14px] leading-normal text-ink-2">
          {item}
        </span>
      ))}
    </div>
  );
}

function CriterionLine({
  row,
  color,
  first,
  delay,
  onEvidence,
}: {
  row: CriterionRow;
  /** The specialist's colour: every chart on its tab uses it. */
  color: string;
  first: boolean;
  delay: number;
  onEvidence: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const change = deltaParts(row.delta);
  const paragraphs = rationaleParagraphs(row.rationale);
  const evidence = row.evidenceIds.length;
  return (
    <div
      className={cn(
        "transition-colors duration-300",
        !first && "border-t border-line",
        open ? "bg-canvas" : "bg-transparent",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="grid min-h-[62px] w-full grid-cols-[minmax(0,1fr)_44px_20px] items-center gap-x-4 gap-y-1 px-4 py-2 text-left outline-none transition-colors duration-[var(--dur-quick)] hover:bg-hover focus-visible:ring-2 focus-visible:ring-action md:grid-cols-[minmax(140px,200px)_70px_minmax(0,1fr)_40px_18px] md:px-[22px]"
      >
        <span className="min-w-0 truncate text-[15px] font-semibold text-ink-1">{row.label}</span>
        <span className="hidden text-meta whitespace-nowrap text-ink-4 md:inline">
          {t("deep.specialist.weight", { weight: Math.round(row.weight) })}
        </span>
        <span className="relative order-last col-span-3 h-2 rounded-[4px] bg-[var(--chart-track)] md:order-none md:col-span-1">
          <motion.span
            className="absolute inset-y-0 left-0 block rounded-[4px]"
            style={{ width: `${row.score ?? 0}%`, background: color, transformOrigin: "left" }}
            initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
            animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
            transition={reduced ? REDUCED_FADE : { duration: 0.8, ease: EASE.out, delay }}
          />
          {row.screeningScore !== null && (
            <span
              className="absolute -top-1 -bottom-1 w-0.5 rounded-[1px] bg-ink-3"
              style={{ left: `${row.screeningScore}%` }}
              title={t("deep.specialist.atScreening")}
            />
          )}
        </span>
        <span className="text-right text-[17px] font-semibold tabular-nums text-ink-1">
          {formatScore(row.score, language)}
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
        <div className="flex max-w-[820px] flex-col gap-4 px-4 pt-1 pb-6 md:px-[22px]">
          {row.description && (
            <span className="text-list text-ink-3">
              <span className="font-semibold text-ink-2">{t("deep.specialist.weAssess")}</span>
              {row.description}
            </span>
          )}
          <div className="flex max-w-[720px] flex-col gap-3.5">
            {row.verdict && (
              <p className="m-0 text-base leading-[1.72] font-medium text-pretty text-ink-1">
                {row.verdict}
              </p>
            )}
            {paragraphs.length > 0 ? (
              paragraphs.map((paragraph, index) => (
                <p key={index} className="m-0 text-base leading-[1.72] text-pretty text-ink-1">
                  {paragraph}
                </p>
              ))
            ) : (
              <p className="m-0 text-base leading-[1.72] text-ink-3">
                {t("deep.specialist.notEnoughEvidence")}
              </p>
            )}
          </div>
          {(row.positiveDrivers.length > 0 || row.negativeDrivers.length > 0) && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
              <DetailColumn
                title={t("deep.specialist.pullsUp")}
                items={row.positiveDrivers}
                tone="positive"
                icon={CircleCheck}
              />
              <DetailColumn
                title={t("deep.specialist.pullsDown")}
                items={row.negativeDrivers}
                tone="warning"
                icon={CircleAlert}
              />
            </div>
          )}
          {change && row.screeningScore !== null && (
            <span className="flex items-center gap-2.5 text-meta text-ink-3">
              <span className={cn("font-semibold", change.tone)}>{change.text}</span>
              {t("deep.hero.sinceScreening", { score: formatScore(row.screeningScore, language) })}
            </span>
          )}
          {row.unknowns.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <span className="flex items-center gap-[7px] text-list font-semibold text-ink-2">
                <CircleHelp className="size-4" strokeWidth={1.75} aria-hidden />
                {t("deep.specialist.unconfirmed")}
              </span>
              {row.unknowns.map((unknown) => (
                <span key={unknown} className="text-[14px] leading-normal text-ink-2">
                  {unknown}
                </span>
              ))}
            </div>
          )}
          <span className="flex items-center gap-1.5 text-meta text-ink-4">
            <FileText className="size-[13px]" strokeWidth={1.75} aria-hidden />
            {evidence === 0
              ? t("deep.specialist.noCitation")
              : t(evidence === 1 ? "deep.specialist.evidenceOne" : "deep.specialist.evidenceMany", {
                  count: evidence,
                })}
            ,{" "}
            <button
              type="button"
              onClick={onEvidence}
              className="text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
            >
              {t("deep.specialist.seeEvidence")}
            </button>
          </span>
        </div>
      </Collapse>
    </div>
  );
}

function DetailColumn({
  title,
  items,
  tone,
  icon: Icon,
}: {
  title: string;
  items: readonly string[];
  tone: "positive" | "warning";
  icon: typeof CircleCheck;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface p-4 shadow-[0_0_0_1px_var(--line)]">
      <span
        className={cn(
          "flex items-center gap-[7px] text-list font-semibold",
          tone === "positive" ? "text-positive" : "text-warning",
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        {title}
      </span>
      {items.map((item) => (
        <span key={item} className="text-[14px] leading-[1.55] text-ink-2">
          {item}
        </span>
      ))}
    </div>
  );
}
