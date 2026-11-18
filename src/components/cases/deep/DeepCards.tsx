/**
 * The cards on Konklusion (Case Dyb analyse v5, lines 87–103; "Dyb analyse v4: Why → Therefore"):
 * one card per specialist, Økonomi ("Regnet i kode") and Risici ("Risikoanalyse").
 * A card is a claim, one chart and "Se hvorfor"; the whole card opens its tab.
 *
 * Measured: grid min 440 px, gap 14; card canvas, radius xl, padding 24 26, gap 16, min height
 * 430; header row with a 10 px dot, title 15/600, kind 12 ink-4, and the score 28/600 with its
 * change 12/600; claim 22/600, tracking -0.015em, line 1.25, max 460; chart area min 220; CTA
 * 13/500 in --action with an arrow. Hover: surface, raised shadow, y −4 over 480 ms; press .99.
 * Cards rise in 140 ms + 80 ms each.
 *
 * Only real data is drawn (gap/ choice 1): the four standard specialists draw their own chart
 * from the sourced card data (`CardCharts.tsx`), a team's own specialist its criteria (a
 * radar from three criteria, else one bar per criterion, the mark on each bar being the
 * screening score); Økonomi shows revenue per year from the annual reports; Risici the 5 × 5
 * matrix (one marker per cell) and the three worst risks.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AreaChart,
  ArrowRight,
  BarChart,
  BarChartHorizontal,
  Building2,
  CalendarRange,
  ChartSpline,
  CircleDot,
  Gauge,
  Grip,
  Hash,
  PieChart,
  Radar as RadarIcon,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SpecialistBot } from "@/components/ai/SpecialistBot";
import { useStoredChoice } from "@/components/charts/use-chart-type";
import { useSession } from "@/lib/auth/useSession";
import type { DeepCardData } from "@/lib/analysis/card-data";
import { cardDataKindFor } from "@/lib/analysis/card-data-kinds";
import { formatDkkCompact } from "@/lib/analysis/financial-format";
import { economyMiniLayout } from "@/lib/charts/layouts";
import type { FinanceSummary } from "@/lib/cases/finance-summary";
import { cardHeadline } from "@/lib/cases/card-fallback";
import { specialistChartPlan, type SpecialistChartPlan } from "@/lib/cases/card-chart-plan";
import {
  cardVariants,
  pickDefaults,
  type CardVariant,
  type CriteriaVariant,
} from "@/lib/cases/card-variants";
import {
  ECONOMY_COLOR,
  RISKS_COLOR,
  RISKS_TAB,
  ECONOMY_TAB,
  hasRiskCoordinates,
  highRiskCount,
  cellMarker,
  matrixCells,
  numberRisks,
  type SpecialistGroup,
  type TabFigure,
} from "@/lib/cases/deep-view";
import { riskTitle } from "@/lib/cases/risk-title";
import { formatScore, formatWholeScore } from "@/lib/cases/screening-view";
import type { RiskView } from "@/lib/cases/view-model";
import { useLanguage, useT } from "@/lib/i18n/useT";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { plainClick, useDeepHref } from "./deep-links";
import { HEAT_BACKGROUND, riskMarkerColor, riskMarkerInk } from "./risk-style";
import { MarketChart, OwnershipChart, TeamChart, TechChart } from "./CardCharts";
import { CertaintyWaffle, HighlightsChart, RoundsChart } from "./CardFallbackCharts";
import { CriteriaChart } from "./CardCriteriaCharts";
import { EconomyNotFound, MissingInfo, type CardFillRequest } from "./CardMissing";

function deltaText(delta: number | null): { text: string; tone: string } | null {
  if (delta === null) return null;
  return {
    text: `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta)}`,
    tone: delta < 0 ? "text-critical" : delta > 0 ? "text-positive" : "text-ink-3",
  };
}

const CARD_CLASS =
  "relative flex h-full min-h-[380px] w-full cursor-pointer flex-col gap-4 rounded-xl bg-canvas p-5 text-left transition-[transform,box-shadow,background-color] duration-[480ms] ease-standard hover:-translate-y-1 hover:bg-surface hover:shadow-raised has-[[data-card-link]:focus-visible]:ring-2 has-[[data-card-link]:focus-visible]:ring-action has-[[data-card-link]:active]:scale-[.99] md:min-h-[470px] md:px-[26px] md:py-6";

/**
 * The whole card opens its tab; the title is the link and stretches over the card, so a control
 * inside the card ("Afklar med Brain", the field under "Mangler information") is its own control
 * and not nested in a link.
 */
function OverviewCard({
  title,
  color,
  kind,
  score,
  delta,
  claim,
  cta,
  delay,
  onOpen,
  href,
  tools,
  figure,
  children,
}: {
  title: string;
  color: string;
  kind: string;
  score?: number | null;
  delta?: number | null;
  claim: string | null;
  cta: string;
  delay: number;
  onOpen: () => void;
  /** The card's own address (open in a new tab, right click). */
  href?: string | undefined;
  /** Small controls at the top of the card, right under the header (the chart type). */
  tools?: ReactNode;
  /** The specialist's figure instead of the dot (the same as in the tab bar). */
  figure?: TabFigure | null | undefined;
  children: ReactNode;
}) {
  const language = useLanguage();
  const reduced = useReducedMotion();
  const change = deltaText(delta ?? null);
  const stretch =
    "no-underline outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:no-underline";
  const name = (
    <>
      {title}
      <span className="sr-only">
        {claim ? `. ${claim}` : ""}. {cta}
      </span>
    </>
  );
  return (
    <motion.div
      className="h-full"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.64, ease: EASE.out, delay }}
    >
      <div className={CARD_CLASS}>
        <span className="flex shrink-0 items-center gap-2.5">
          {figure ? (
            <SpecialistBot kind={figure} size={32} />
          ) : (
            <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
          )}
          {href ? (
            <a
              href={href}
              data-card-link
              onClick={(event) => plainClick(event, onOpen)}
              className={cn("text-[15px] font-semibold text-ink-1", stretch)}
            >
              {name}
            </a>
          ) : (
            <button
              type="button"
              data-card-link
              onClick={onOpen}
              className={cn("text-left text-[15px] font-semibold", stretch)}
            >
              {name}
            </button>
          )}
          <span className="text-meta text-ink-4">{kind}</span>
          <span className="flex-1" />
          {score !== undefined && score !== null && (
            <span className="flex items-baseline gap-2">
              <span className="text-[28px] leading-none font-semibold tracking-title tabular-nums">
                {formatWholeScore(score, language)}
              </span>
              {change && (
                <span className={cn("text-meta font-semibold", change.tone)}>{change.text}</span>
              )}
            </span>
          )}
        </span>
        {/* Its own row right under the header, so the title and the score keep their place on
            every width. */}
        {tools && <span className="relative z-[1] -my-2 flex shrink-0 justify-end">{tools}</span>}
        {claim && (
          <span
            className="line-clamp-2 max-w-[460px] shrink-0 text-[17px] leading-snug font-semibold tracking-[-0.01em] text-balance"
            aria-hidden
          >
            {claim}
          </span>
        )}
        {/* Above the stretched link, so the charts' tooltips work; a click outside a control
            still opens the tab. */}
        <span
          className="relative z-[1] flex min-h-[300px] flex-1 items-center justify-center"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a, button, input, textarea, label")) return;
            onOpen();
          }}
        >
          {children}
        </span>
        <span
          className="flex shrink-0 items-center gap-2 text-list font-medium text-action"
          aria-hidden
        >
          {cta}
          <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
      </div>
    </motion.div>
  );
}

/** The own chart's icon and what kind of chart it looks like (so the defaults do not repeat it). */
type OwnKind = Extract<
  SpecialistChartPlan["chart"],
  "team" | "market" | "techBenchmarks" | "ownership" | "rounds" | "highlights"
>;
const OWN_LOOK: Record<OwnKind, { Icon: LucideIcon; looksLike: CriteriaVariant | null }> = {
  team: { Icon: Users, looksLike: "radar" },
  market: { Icon: AreaChart, looksLike: "slope" },
  techBenchmarks: { Icon: Hash, looksLike: null },
  ownership: { Icon: Building2, looksLike: "ring" },
  rounds: { Icon: CalendarRange, looksLike: null },
  highlights: { Icon: Hash, looksLike: null },
};

const VARIANT_ICON: Record<CriteriaVariant, LucideIcon> = {
  column: BarChart,
  bar: BarChartHorizontal,
  squares: Grip,
  radar: RadarIcon,
  slope: ChartSpline,
  ring: CircleDot,
  pie: PieChart,
  gauge: Gauge,
};

/** The plan's own chart from the sourced data, when it has one. */
function ownChart(plan: SpecialistChartPlan): OwnKind | null {
  return Object.hasOwn(OWN_LOOK, plan.chart) ? (plan.chart as OwnKind) : null;
}

/** An own chart that is tiles of figures (key figures without the industry, a team's own
 * specialist's loose figures): a card shows a chart first and keeps the tiles one click away. */
function ownIsTiles(plan: SpecialistChartPlan): boolean {
  if (plan.chart === "highlights") return plan.plan.kind === "tiles";
  if (plan.chart === "techBenchmarks")
    return !plan.data.items.some((item) => item.company !== null && item.industry !== null);
  return false;
}

/** The small buttons at the top of the card: one per chart the card can show. */
function CardChartPicker({
  variants,
  choice,
  ownIcon,
  onChoose,
  label: specialist,
}: {
  label: string;
  variants: readonly CardVariant[];
  choice: CardVariant;
  ownIcon: LucideIcon;
  onChoose: (variant: CardVariant) => void;
}) {
  const t = useT();
  return (
    <span
      className="flex items-center gap-0.5"
      role="group"
      aria-label={`${t("charts.switcher.pickType")}: ${specialist}`}
    >
      {variants.map((variant) => {
        const Icon = variant === "own" ? ownIcon : VARIANT_ICON[variant];
        const label = t(`charts.switcher.variant.${variant}`);
        return (
          <button
            key={variant}
            type="button"
            aria-pressed={choice === variant}
            title={label}
            onClick={() => onChoose(variant)}
            className={cn(
              "grid size-7 place-items-center rounded-sm border transition-colors",
              choice === variant
                ? "border-action/30 bg-action-wash text-action"
                : "border-transparent text-ink-4 hover:border-hairline hover:text-ink-2",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </span>
  );
}

/** The specialist's own chart: team radar, market line, key figures, ownership. */
function OwnChart({ plan, group }: { plan: SpecialistChartPlan; group: SpecialistGroup }) {
  if (plan.chart === "team") return <TeamChart data={plan.data} />;
  if (plan.chart === "market") return <MarketChart data={plan.data} color={group.color} />;
  if (plan.chart === "techBenchmarks") return <TechChart data={plan.data} color={group.color} />;
  if (plan.chart === "ownership") return <OwnershipChart data={plan.data} card />;
  if (plan.chart === "rounds") return <RoundsChart timeline={plan.timeline} color={group.color} />;
  if (plan.chart === "highlights") return <HighlightsChart plan={plan.plan} color={group.color} />;
  return null;
}

/**
 * A specialist without a scored criterion and without its own chart (rare): how many findings it
 * has, else what it wrote speaks for, against and is open, else "Mangler information".
 */
function UnscoredChart({
  plan,
  group,
  fundId,
  caseId,
  companyName,
  onFill,
}: {
  plan: SpecialistChartPlan;
  group: SpecialistGroup;
  fundId: string;
  caseId: string;
  companyName: string;
  onFill?: ((request: CardFillRequest) => void) | undefined;
}) {
  const t = useT();
  if (plan.chart === "findings") {
    return (
      <CertaintyWaffle
        label={t("deep.cards.balanceLabel")}
        groups={[
          {
            key: "findings",
            label: t("deep.cards.findings"),
            count: plan.count,
            color: group.color,
          },
        ]}
      />
    );
  }
  if (plan.chart === "balance") {
    return (
      <CertaintyWaffle
        label={t("deep.cards.balanceLabel")}
        groups={[
          {
            key: "for",
            label: t("deep.cards.speaksFor"),
            count: group.strengths.length,
            color: "var(--positive)",
          },
          {
            key: "against",
            label: t("deep.cards.speaksAgainst"),
            count: group.weaknesses.length,
            color: "var(--warning)",
          },
          {
            key: "open",
            label: t("deep.cards.open"),
            count: group.unknowns.length + group.questions.length,
            color: "var(--ink-4)",
          },
        ]}
      />
    );
  }
  const kind = cardDataKindFor(group.id);
  const question = t(kind ? `deep.cards.ask.${kind}` : "deep.cards.ask.own", {
    company: companyName,
    label: group.label,
  });
  return (
    <MissingInfo
      fundId={fundId}
      caseId={caseId}
      label={group.label}
      reason={plan.chart === "missing" ? plan.reason : null}
      question={question}
      onFill={
        onFill
          ? () =>
              onFill({
                title: kind
                  ? t("deep.cards.fillTitle", { what: t(`deep.cards.missing.${kind}`) })
                  : t("deep.cards.fillTitleOwn", { label: group.label }),
                description: t("deep.cards.fillWhy", { label: group.label }),
                criterionKey: group.criteria[0]?.criterionKey ?? null,
              })
          : undefined
      }
    />
  );
}

/**
 * A specialist's card: the chart fills the card, and buttons at the top
 * switch between the specialist's own chart and its criteria in several kinds of chart
 * (`cardVariants`). Each card starts on a different kind (`pickDefaults` in `DeepCards`); the
 * user's choice is kept per user and specialist. A card with a score never shows "Ikke fundet",
 * "Afklar med Brain" or "Udfyld": the score is enough to draw from.
 */
function SpecialistCard({
  group,
  plan,
  variants,
  preferred,
  fundId,
  caseId,
  companyName,
  userId,
  delay,
  onOpen,
  href,
  onFill,
}: {
  group: SpecialistGroup;
  plan: SpecialistChartPlan;
  variants: readonly CardVariant[];
  preferred: CardVariant | null;
  fundId: string;
  caseId: string;
  companyName: string;
  userId: string | null;
  delay: number;
  onOpen: () => void;
  href?: string | undefined;
  onFill?: ((request: CardFillRequest) => void) | undefined;
}) {
  const t = useT();
  const { choice, choose } = useStoredChoice<CardVariant>(
    `deep-card:${userId ?? "-"}:${group.id}`,
    variants,
    preferred ?? "own",
    "own",
  );
  const own = ownChart(plan);
  return (
    <OverviewCard
      title={group.label}
      color={group.color}
      figure={group.figure}
      kind={t("deep.cards.specialist")}
      score={group.score}
      delta={group.delta}
      claim={cardHeadline(group.headline, group.summary)}
      cta={t("deep.cards.seeWhy")}
      delay={delay}
      onOpen={onOpen}
      href={href}
      tools={
        variants.length > 1 ? (
          <CardChartPicker
            variants={variants}
            choice={choice}
            label={group.label}
            ownIcon={own ? OWN_LOOK[own].Icon : Hash}
            onChoose={choose}
          />
        ) : undefined
      }
    >
      {variants.length === 0 ? (
        <UnscoredChart
          plan={plan}
          group={group}
          fundId={fundId}
          caseId={caseId}
          companyName={companyName}
          onFill={onFill}
        />
      ) : choice === "own" ? (
        <OwnChart plan={plan} group={group} />
      ) : (
        <CriteriaChart type={choice} group={group} />
      )}
    </OverviewCard>
  );
}

/** Revenue (else gross profit) per year, the last year in the series colour. */
function EconomyMini({ finance }: { finance: FinanceSummary }) {
  const language = useLanguage();
  const reduced = useReducedMotion();
  const values = finance.years.map((year) =>
    finance.hasRevenue ? year.revenue : year.grossProfit,
  );
  // A negative year is drawn below the baseline (never mirrored upwards as if it were positive).
  const { bars, baseline, hasNegative } = economyMiniLayout(values);
  return (
    <span className="flex h-[280px] w-full items-stretch gap-[18px]">
      {finance.years.map((year, index) => {
        const value = values[index] ?? null;
        const last = index === finance.years.length - 1;
        const bar = bars[index] ?? null;
        const isNegative = bar?.isNegative ?? false;
        const size = bar?.size ?? 0;
        return (
          <span key={year.year} className="flex h-full flex-1 flex-col items-center gap-2">
            <span className="text-[15px] font-semibold">
              {value === null ? "–" : formatDkkCompact(value, language)}
            </span>
            <span className="relative w-full flex-1">
              <motion.span
                className={cn(
                  "absolute inset-x-0 block",
                  isNegative ? "rounded-[4px_4px_12px_12px]" : "rounded-[12px_12px_4px_4px]",
                )}
                style={{
                  height: `${size * 100}%`,
                  bottom: `${(bar?.bottom ?? 0) * 100}%`,
                  transformOrigin: isNegative ? "top" : "bottom",
                  background: isNegative
                    ? "var(--warning)"
                    : last
                      ? ECONOMY_COLOR
                      : `color-mix(in srgb, ${ECONOMY_COLOR} 38%, transparent)`,
                }}
                initial={reduced ? { opacity: 0 } : { scaleY: 0 }}
                animate={reduced ? { opacity: 1 } : { scaleY: 1 }}
                transition={
                  reduced
                    ? REDUCED_FADE
                    : { duration: 0.9, ease: EASE.standard, delay: 0.3 + index * 0.09 }
                }
              />
              {hasNegative && (
                <span
                  className="absolute inset-x-0 h-px bg-line"
                  style={{ bottom: `${baseline * 100}%` }}
                  aria-hidden
                />
              )}
            </span>
            <span className="text-meta text-ink-3">{year.year}</span>
          </span>
        );
      })}
    </span>
  );
}

/** The 5 × 5 matrix (numbers follow the sorted list) and the three worst risks. */
function RiskMini({ risks }: { risks: readonly RiskView[] }) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  // Same numbering, clamping and heat colours as the Risici tab and the committee pack.
  const numbered = numberRisks(risks);
  const cells = matrixCells(numbered);
  const placed = numbered.some((entry) => hasRiskCoordinates(entry.risk));
  return (
    // The matrix takes the larger part of a wide card (the chart fills the card).
    <span className="@container block w-full">
      <span className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] items-center gap-x-[22px] gap-y-5 @min-[26rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {placed && (
          <span className="flex flex-col gap-1.5">
            <span
              className="grid grid-cols-5 gap-1"
              role="img"
              aria-label={t("deep.risks.matrixLabel")}
            >
              {cells.map((cell) => (
                <span
                  key={`${cell.likelihood}-${cell.impact}`}
                  className="flex aspect-[1.1] items-center justify-center gap-[3px] rounded-lg"
                  style={{ background: HEAT_BACKGROUND[cell.band] }}
                >
                  {(() => {
                    // Several risks in one cell share one marker, "2–5".
                    const marker = cellMarker(cell.entries);
                    if (!marker) return null;
                    return (
                      <motion.span
                        className="grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-micro font-semibold whitespace-nowrap"
                        style={{
                          background: riskMarkerColor(marker.risk.level),
                          color: riskMarkerInk(marker.risk.level),
                        }}
                        title={marker.numbers.length > 1 ? marker.numbers.join(", ") : undefined}
                        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={
                          reduced
                            ? REDUCED_FADE
                            : {
                                duration: 0.46,
                                ease: EASE.out,
                                delay: 0.4 + (marker.numbers[0] ?? 0) * 0.08,
                              }
                        }
                      >
                        {marker.label}
                      </motion.span>
                    );
                  })()}
                </span>
              ))}
            </span>
            <span className="flex justify-between text-micro text-ink-4">
              <span>{t("deep.risks.low")}</span>
              <span>{t("deep.risks.likelihood")}</span>
              <span>{t("deep.risks.high")}</span>
            </span>
          </span>
        )}
        <span className="flex flex-col gap-3">
          {numbered.slice(0, 3).map(({ risk, number }) => (
            <span key={number} className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-2.5">
              <span
                className="grid size-[22px] place-items-center rounded-full text-micro font-semibold"
                style={{
                  background: riskMarkerColor(risk.level),
                  color: riskMarkerInk(risk.level),
                }}
              >
                {number}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] leading-snug font-semibold">
                  {riskTitle(risk, language)}
                </span>
                <span
                  className={cn(
                    "text-meta",
                    risk.level === "critical"
                      ? "text-critical"
                      : risk.level === "high"
                        ? "text-warning"
                        : "text-ink-3",
                  )}
                >
                  {t(`deep.level.${risk.level}`)}
                </span>
              </span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

/** A finding of the deep run (`analysis_findings`): enough to place and weigh it. */
export interface CardFinding {
  category: string;
  nature: string;
  confidence: number | null;
}

export function DeepCards({
  fundId,
  caseId,
  companyName,
  groups,
  findings,
  finance,
  risks,
  cardData,
  onOpen,
  onFill,
}: {
  fundId: string;
  caseId: string;
  /** Goes into the question "Afklar med Brain" puts in the composer. */
  companyName: string;
  groups: readonly SpecialistGroup[];
  findings: readonly CardFinding[];
  /** The specialists' sourced chart data; null for a run without any. */
  cardData: DeepCardData | null;
  /** Null: the case has no annual reports; the Økonomi card then says "Ikke fundet" over an empty chart. */
  finance: FinanceSummary | null;
  /** Sorted: critical first (the same order as the Risici tab). */
  risks: readonly RiskView[];
  onOpen: (tab: string) => void;
  /** "Udfyld": open "Ny opgave" with the gap filled in. Left out for people who cannot add tasks. */
  onFill?: ((request: CardFillRequest) => void) | undefined;
}) {
  const t = useT();
  const high = highRiskCount(risks);
  const hrefFor = useDeepHref();
  const userId = useSession().session?.user.id ?? null;
  // Each card's own chart and the charts it can switch to; then one first chart per card, varied
  // across the screen.
  const cards = groups.map((group) => {
    const plan = specialistChartPlan(group, cardData, findings);
    const own = ownChart(plan);
    return { group, plan, own, variants: cardVariants(group, own !== null) };
  });
  const defaults = pickDefaults(
    cards.map((card) => ({
      variants: card.variants,
      ownLooksLike: card.own ? OWN_LOOK[card.own].looksLike : null,
      ownIsTiles: ownIsTiles(card.plan),
    })),
  );
  let order = 0;
  const delay = () => 0.14 + order++ * 0.08;
  return (
    <div className="grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3.5 xl:grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))]">
      {cards.map(({ group, plan, variants }, index) => (
        <SpecialistCard
          key={group.id}
          group={group}
          plan={plan}
          variants={variants}
          preferred={defaults[index] ?? null}
          fundId={fundId}
          caseId={caseId}
          companyName={companyName}
          userId={userId}
          delay={delay()}
          onOpen={() => onOpen(group.id)}
          href={hrefFor?.({ tab: group.id })}
          onFill={onFill}
        />
      ))}
      {
        <OverviewCard
          title={t("deep.cards.economyTitle")}
          color={ECONOMY_COLOR}
          figure="finance"
          kind={t("deep.cards.economyKind")}
          claim={finance ? `${finance.headline.label}: ${finance.headline.value}` : null}
          cta={t("deep.cards.seeWhy")}
          delay={delay()}
          onOpen={() => onOpen(ECONOMY_TAB)}
          href={hrefFor?.({ tab: ECONOMY_TAB })}
        >
          {finance ? (
            <EconomyMini finance={finance} />
          ) : (
            <EconomyNotFound
              question={t("deep.cards.ask.economy", { company: companyName })}
              onFill={
                onFill
                  ? () =>
                      onFill({
                        title: t("deep.cards.fillTitleEconomy"),
                        description: t("deep.cards.fillWhy", {
                          label: t("deep.cards.economyTitle"),
                        }),
                        criterionKey: null,
                      })
                  : undefined
              }
            />
          )}
        </OverviewCard>
      }
      {risks.length > 0 && (
        <OverviewCard
          title={t("deep.cards.risksTitle")}
          color={RISKS_COLOR}
          kind={t("deep.cards.risksKind")}
          claim={
            high === 0
              ? t(risks.length === 1 ? "deep.cards.riskFoundOne" : "deep.cards.riskFoundMany", {
                  count: risks.length,
                })
              : t(high === 1 ? "deep.cards.riskHighOne" : "deep.cards.riskHighMany", {
                  count: high,
                })
          }
          cta={t("deep.cards.seeAllRisks")}
          delay={delay()}
          onOpen={() => onOpen(RISKS_TAB)}
          href={hrefFor?.({ tab: RISKS_TAB })}
        >
          <RiskMini risks={risks} />
        </OverviewCard>
      )}
    </div>
  );
}
