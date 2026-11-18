/**
 * The Økonomi tab ("Regnet i kode"; Case Dyb analyse v5, lines 170–215). Not a specialist: every
 * figure is calculated in code from the annual reports (financial-metrics.ts) and the deck's
 * finance inputs (finance.ts). Under "Analyserne": the key figures (revenue, gross margin, burn,
 * runway), then one card per analysis that has real figures, each opening a sub-page with the
 * formula, inputs, years and source: Omsætning og bruttomargin, Likviditet og runway, Unit
 * economics (only when the code could calculate it) and "Nøgletal og regnskaber", which holds
 * everything the old Økonomi section showed (the metric table, traction, the calculations, what
 * could not be calculated and "Hent eller skift regnskab"). The prototype's cap table has no
 * data in the product and is dropped (gap).
 *
 * Measured: key figures 1 / 2 / 4 across, gap 12, canvas radius xl, padding 20 22, label 14 ink-3,
 * value 30/600, change 12/500; cards auto-fit min 380, gap 12, canvas radius xl, padding
 * 22 24, title 17/600 with the pill "Se analysen" (30 px, surface, pill shadow, 12/500).
 */
import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Hourglass, Search } from "lucide-react";
import { formatMetricValue } from "@/lib/analysis/financial-format";
import type { FinancialMetricsReport } from "@/lib/analysis/financial-metrics";
import {
  ECONOMY_FOCUS,
  economyView,
  unitEconomics,
  type EconomyKpi,
  type UnitEconomicsView,
} from "@/lib/cases/deep-view";
import { cashStory } from "@/lib/cases/economy-text";
import {
  ECONOMY_KPI_KEYS,
  KPI_INPUTS,
  defaultInputYear,
  missingFigures,
  type EconomyKpiKey,
} from "@/lib/cases/economy-inputs";
import type {
  FinancialStatementView,
  ManualFinancialInputView,
} from "@/lib/cases/financials.functions";
import { isManualSource } from "@/lib/analysis/manual-financials";
import { EconomyInputForm } from "./EconomyInputs";
import { EconomyFindPanel } from "./FindWithBrain";
import { CardNotFound, OwnershipChart } from "./CardCharts";
import type { AnalysisView } from "@/lib/cases/view-model";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Language } from "@/lib/i18n/language";
import { useLanguage, useLocaleTag, useT } from "@/lib/i18n/useT";
import type { MessageKey, TranslateVars } from "@/lib/i18n/translate";
import {
  CashChart,
  RevenueMarginChart,
  RevenueMarginLegend,
  UnitEconomicsBars,
} from "./EconomyCharts";

type Translate = (key: MessageKey, vars?: TranslateVars) => string;

function usePercentFormat() {
  const localeTag = useLocaleTag();
  return useMemo(() => new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 }), [localeTag]);
}

function kpiValue(
  kpi: EconomyKpi,
  t: Translate,
  language: Language,
): { text: string; muted: boolean } {
  if (kpi.value === null) return { text: t("finance.economy.cannotCalculate"), muted: true };
  if (kpi.key === "operating_burn" && kpi.value === 0) {
    return { text: t("finance.economy.noBurn"), muted: false };
  }
  return { text: formatMetricValue(kpi.metric, kpi.value, language), muted: false };
}

function kpiNote(
  kpi: EconomyKpi,
  t: Translate,
  percentFormat: Intl.NumberFormat,
): { text: string; tone: string } | null {
  if (kpi.value === null) {
    return kpi.point.note ? { text: kpi.point.note, tone: "text-ink-3" } : null;
  }
  if (kpi.delta) {
    const { kind, value } = kpi.delta;
    const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
    const text = t(
      kind === "growth" ? "finance.economy.growthYear" : "finance.economy.pointsYear",
      {
        sign,
        value: percentFormat.format(Math.abs(value)),
      },
    );
    return { text, tone: value < 0 ? "text-critical" : value > 0 ? "text-positive" : "text-ink-3" };
  }
  if (kpi.point.status === "estimat") {
    return { text: t("finance.economy.estimateFromReport"), tone: "text-ink-3" };
  }
  return null;
}

function SeeButton({ label, onClick }: { label: string; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("finance.economy.seeAnalysisAria", { label })}
      className="inline-flex h-[30px] items-center gap-1.5 rounded-pill bg-surface px-3 text-meta font-medium whitespace-nowrap text-ink-1 shadow-pill outline-none transition-transform focus-visible:ring-2 focus-visible:ring-action active:scale-[.96]"
    >
      {t("finance.economy.seeAnalysis")}
      <ArrowUpRight className="size-3" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

function Card({
  title,
  onOpen,
  delay,
  aside,
  children,
}: {
  title: string;
  /** "Se analysen"; a card without a sub-page has none. */
  onOpen?: (() => void) | undefined;
  delay: number;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      aria-label={title}
      data-focus-card={onOpen ? "" : undefined}
      className="flex flex-col gap-3.5 rounded-xl bg-canvas px-5 py-5 md:px-6 md:py-[22px]"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED_FADE : { duration: 0.6, ease: EASE.out, delay }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-section font-semibold">{title}</span>
        {onOpen && <SeeButton label={title} onClick={onOpen} />}
        <div className="flex-1" />
        {aside}
      </div>
      {children}
    </motion.section>
  );
}

const KPI_LABEL: Record<EconomyKpiKey, MessageKey> = {
  revenue: "deep.economy.revenue",
  gross_margin: "deep.economy.grossMargin",
  operating_burn: "deep.economy.burn",
  runway_today: "deep.economy.runway",
};

export function EconomyTab({
  fundId,
  caseId,
  report,
  analysis,
  statementCount,
  manualInputs = [],
  inputCurrency = "DKK",
  canEnter = false,
  canFind = false,
  statements = [],
  inputsError = false,
  hiddenInputCount = 0,
  maxInputYear,
  now,
  onFocus,
}: {
  fundId: string;
  caseId: string;
  report: FinancialMetricsReport | null | undefined;
  analysis: AnalysisView;
  /** How many annual reports the case has (for "Nøgletal og regnskaber"). */
  statementCount: number;
  /** Figures entered on the case, already part of `report`. */
  manualInputs?: readonly ManualFinancialInputView[] | undefined;
  /** The currency a new figure is entered in (the reports', else DKK). */
  inputCurrency?: string | undefined;
  /** Admin, Lead and Medlem may fill in a figure that was not found (correct_evidence). */
  canEnter?: boolean | undefined;
  /** …and ask Brain to find it, when Brain is on for the fund. */
  canFind?: boolean | undefined;
  /** The annual reports the page shows: which raw figures a year already has. */
  statements?: readonly FinancialStatementView[] | undefined;
  /** The entered figures could not be read (the reports still show). */
  inputsError?: boolean | undefined;
  /** Figures entered in another currency than the reports' (not used; the page says so). */
  hiddenInputCount?: number | undefined;
  /** The latest year a figure can be entered for. */
  maxInputYear?: number | undefined;
  /** Today (ms); passed in so the page renders the same on server and client. */
  now: number;
  onFocus: (focus: string) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const percentFormat = usePercentFormat();
  const reduced = useReducedMotion();
  const view = economyView(report, language);
  const unit = unitEconomics(analysis.calculations);
  const kpis = view?.kpis ?? [];
  const [filling, setFilling] = useState<EconomyKpiKey | null>(null);
  // "Find med Brain" opens in the same place as "Udfyld"; one of them at a time.
  const [finding, setFinding] = useState<EconomyKpiKey | null>(null);
  // While Brain searches or a proposal is being decided, the panel stays open (review).
  const [findBusy, setFindBusy] = useState(false);
  const inputYear = Math.min(
    defaultInputYear(report?.years ?? [], now),
    maxInputYear ?? defaultInputYear([], now),
  );
  const labelOf = (key: EconomyKpiKey) =>
    kpis.find((entry) => entry.key === key)?.label ?? t(KPI_LABEL[key]);
  // Focus goes back to the button that opened the form or the panel (Esc, Annuller, Luk, Gem),
  // else to the next one that is still there.
  const refocus = (...selectors: string[]) =>
    requestAnimationFrame(() => {
      for (const selector of selectors) {
        const target = document.querySelector<HTMLElement>(selector);
        if (target) return target.focus();
      }
    });
  let order = 0;
  const delay = () => 0.12 + order++ * 0.06;
  const runway = view?.cashCard ? cashStory(view, language) : "";

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1.5 pt-2">
        <span className="text-section font-semibold">{t("finance.economy.analyses")}</span>
      </div>
      {/* The four key figures always show, as in the prototype; one that could not be
          found says so and can be filled in. Columns follow the count (as): 1 / 2 / 4
          across, so Runway never stands alone on a second row (iPad 1024 gave 3 + 1). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ECONOMY_KPI_KEYS.map((key, index) => {
          const kpi = kpis.find((entry) => entry.key === key) ?? null;
          const label = kpi?.label ?? t(KPI_LABEL[key]);
          const found = kpi !== null && kpi.value !== null;
          const value = found ? kpiValue(kpi, t, language) : null;
          const note = kpi ? kpiNote(kpi, t, percentFormat) : null;
          const entered =
            found && kpi.point.inputs.some((input) => isManualSource(input.sourceDocumentUrl));
          const year = found ? Number(kpi.point.periodEnd.slice(0, 4)) : null;
          // A key figure can have one figure from Brain and one typed in (gross margin): each
          // source says so.
          const enteredInputs = entered
            ? manualInputs.filter(
                (input) => input.fiscalYear === year && KPI_INPUTS[key].includes(input.metric),
              )
            : [];
          const brainInput = enteredInputs.find((input) => input.sourceKind === "brain") ?? null;
          const typedInput = enteredInputs.find((input) => input.sourceKind !== "brain") ?? null;
          // Only the raw figures the year lacks; a key figure that has them all gets no search.
          const findable =
            canFind && !inputsError && !found
              ? missingFigures(KPI_INPUTS[key], inputYear, statements, manualInputs)
              : [];
          return (
            <motion.div
              key={key}
              className="flex flex-col gap-1.5 rounded-xl bg-canvas px-[22px] py-5"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduced ? REDUCED_FADE : { duration: 0.54, ease: EASE.out, delay: index * 0.07 }
              }
            >
              <span className="text-list text-ink-3">{label}</span>
              {value ? (
                <span
                  className={cn(
                    "leading-[1.05] font-semibold tracking-display tabular-nums",
                    value.muted ? "text-[18px] text-ink-3" : "text-[30px]",
                  )}
                >
                  {value.text}
                </span>
              ) : (
                <span className="text-[18px] leading-[1.05] font-semibold text-ink-3">
                  {t("finance.economy.notFound")}
                </span>
              )}
              {note && (
                <span className={cn("line-clamp-2 text-meta font-medium", note.tone)}>
                  {note.text}
                </span>
              )}
              {brainInput && (
                <span
                  className="flex flex-wrap items-center gap-x-2 text-meta text-ink-3"
                  title={brainInput.sourceNote ?? undefined}
                >
                  {brainInput.enteredByName
                    ? t("finance.economy.find.foundByBrain", { name: brainInput.enteredByName })
                    : t("finance.economy.find.foundByBrainNoName")}
                  {brainInput.sourceUrl && (
                    <a
                      href={brainInput.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 font-medium text-action outline-none hover:underline hover:underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-action"
                    >
                      {t("finance.economy.find.source")}
                      <ArrowUpRight className="size-3" strokeWidth={1.75} aria-hidden />
                    </a>
                  )}
                </span>
              )}
              {entered && (typedInput || !brainInput) && (
                <span className="text-meta text-ink-3">
                  {typedInput?.enteredByName
                    ? t("finance.economy.enteredBy", { name: typedInput.enteredByName })
                    : t("finance.economy.enteredOnCase")}
                </span>
              )}
              {((canEnter && !inputsError && (!found || entered)) || findable.length > 0) && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {canEnter && !inputsError && (!found || entered) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFinding(null);
                        setFilling(filling === key ? null : key);
                      }}
                      aria-expanded={filling === key}
                      disabled={findBusy}
                      data-economy-fill={key}
                      aria-label={t(
                        found ? "finance.economy.editAria" : "finance.economy.fillAria",
                        { label },
                      )}
                      className="inline-flex h-[30px] items-center rounded-pill bg-surface px-3 text-meta font-medium text-ink-1 shadow-pill outline-none transition-transform focus-visible:ring-2 focus-visible:ring-action active:scale-[.96] disabled:pointer-events-none disabled:opacity-35"
                    >
                      {t(found ? "finance.economy.edit" : "finance.economy.fill")}
                    </button>
                  )}
                  {findable.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilling(null);
                        setFinding(finding === key ? null : key);
                      }}
                      aria-expanded={finding === key}
                      disabled={findBusy}
                      data-economy-find={key}
                      aria-label={t("finance.economy.find.buttonAria", { label })}
                      className="inline-flex h-[30px] items-center gap-1.5 rounded-pill bg-surface px-3 text-meta font-medium text-ink-1 shadow-pill outline-none transition-transform focus-visible:ring-2 focus-visible:ring-action active:scale-[.96] disabled:pointer-events-none disabled:opacity-35"
                    >
                      <Search className="size-3" strokeWidth={1.75} aria-hidden />
                      {t("finance.economy.find.button")}
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      {inputsError && (
        <p role="status" className="m-0 px-1.5 text-meta text-critical">
          {t("finance.economy.inputsError")}
        </p>
      )}
      {hiddenInputCount > 0 && (
        <p role="status" className="m-0 px-1.5 text-meta text-ink-3">
          {t(
            hiddenInputCount === 1
              ? "finance.economy.hiddenInputsOne"
              : "finance.economy.hiddenInputsMany",
            { count: hiddenInputCount },
          )}
        </p>
      )}
      {filling && !inputsError && (
        <EconomyInputForm
          key={filling}
          fundId={fundId}
          caseId={caseId}
          kpi={filling}
          label={labelOf(filling)}
          defaultYear={inputYear}
          maxYear={maxInputYear ?? defaultInputYear([], now)}
          currency={inputCurrency}
          inputs={manualInputs}
          onClose={() => {
            const key = filling;
            setFilling(null);
            refocus(`[data-economy-fill="${key}"]`);
          }}
        />
      )}
      {finding && !filling && !inputsError && (
        <EconomyFindPanel
          key={finding}
          fundId={fundId}
          caseId={caseId}
          label={labelOf(finding)}
          metrics={missingFigures(KPI_INPUTS[finding], inputYear, statements, manualInputs)}
          fiscalYear={inputYear}
          onBusyChange={setFindBusy}
          onFill={() => {
            setFilling(finding);
            setFinding(null);
          }}
          onClose={() => {
            const key = finding;
            setFinding(null);
            // The button may be gone once the figure is in: then the figure's own "Ret".
            refocus(`[data-economy-find="${key}"]`, `[data-economy-fill="${key}"]`);
          }}
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-3">
        {view?.revenueCard && (
          <Card
            title={t("finance.economy.cardRevenue")}
            onOpen={() => onFocus(ECONOMY_FOCUS.revenue)}
            delay={delay()}
            aside={<RevenueMarginLegend view={view} />}
          >
            <RevenueMarginChart view={view} />
          </Card>
        )}
        {view?.cashCard && (
          <Card
            title={t("finance.economy.cardCash")}
            onOpen={() => onFocus(ECONOMY_FOCUS.cash)}
            delay={delay()}
          >
            <CashChart view={view} now={now} />
            {runway && (
              <div className="flex items-center gap-2.5 rounded-md bg-warning-wash px-3.5 py-3 text-[14px] leading-snug text-ink-1">
                <Hourglass
                  className="size-4 shrink-0 text-warning"
                  strokeWidth={1.75}
                  aria-hidden
                />
                {runway}
              </div>
            )}
          </Card>
        )}
        {unit && (
          <Card
            title={t("finance.economy.cardUnit")}
            onOpen={() => onFocus(ECONOMY_FOCUS.unit)}
            delay={delay()}
            aside={<span className="text-meta text-ink-4">{t("finance.economy.unitAside")}</span>}
          >
            <UnitEconomicsBars view={unit} />
            <UnitHeadline view={unit} />
          </Card>
        )}
        {/* The prototype's cap table: the ownership shares the deep analysis sourced,
            or "Ikke fundet" with the specialist's reason; never invented. */}
        <Card title={t("finance.economy.cardCapTable")} delay={delay()}>
          <div className="flex min-h-[200px] items-center justify-center">
            {analysis.cardData?.ownership.status === "found" && analysis.cardData.ownership.data ? (
              <OwnershipChart data={analysis.cardData.ownership.data} />
            ) : (
              <CardNotFound reason={analysis.cardData?.ownership.reason ?? null} />
            )}
          </div>
        </Card>
        {(view || analysis.calculations.length > 0) && (
          <Card
            title={t("finance.economy.cardMetrics")}
            onOpen={() => onFocus(ECONOMY_FOCUS.metrics)}
            delay={delay()}
          >
            <MetricsSummary report={report} statementCount={statementCount} />
          </Card>
        )}
      </div>
    </div>
  );
}

function UnitHeadline({ view }: { view: UnitEconomicsView }) {
  const t = useT();
  const percentFormat = usePercentFormat();
  if (view.ratio === null && view.payback === null) return null;
  const payback =
    view.payback === null
      ? null
      : t("finance.economy.paybackSentence", {
          value: percentFormat.format(Math.round(view.payback * 10) / 10),
        });
  return (
    <div className="flex items-baseline gap-2.5 pt-1">
      {view.ratio !== null && (
        <span className="text-[36px] leading-none font-semibold tracking-display tabular-nums">
          {percentFormat.format(view.ratio)}×
        </span>
      )}
      <span className="text-[14px] text-ink-3">
        {view.ratio !== null ? `${t("finance.economy.ratioLead")} ` : ""}
        {payback}
      </span>
    </div>
  );
}

/** The fourth card: what the sub-page holds, in real numbers (no chart without data). */
function MetricsSummary({
  report,
  statementCount,
}: {
  report: FinancialMetricsReport | null | undefined;
  statementCount: number;
}) {
  const t = useT();
  const calculated = report
    ? report.metrics.filter((metric) => metric.latest && metric.latest.value !== null).length
    : 0;
  const lines: string[] = [];
  if (report && report.years.length > 0) {
    const first = report.years[0]!.slice(0, 4);
    const last = report.years[report.years.length - 1]!.slice(0, 4);
    lines.push(
      first === last
        ? t("finance.economy.singleYear", { year: last })
        : t("finance.economy.yearsRange", { count: report.years.length, first, last }),
    );
    lines.push(
      t(calculated === 1 ? "finance.economy.calculatedOne" : "finance.economy.calculatedMany", {
        count: calculated,
      }),
    );
  } else if (statementCount === 0) {
    lines.push(t("finance.economy.noStatements"));
  }
  return (
    <div className="flex flex-col gap-1.5 text-[14px] text-ink-2">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
      <span className="text-meta text-ink-3">{t("finance.economy.summaryNote")}</span>
    </div>
  );
}
