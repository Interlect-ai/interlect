/**
 * The Økonomi sub-pages (Case Dyb analyse v5 `dt`: back pill, area, title, answer, boxes).
 * Each opens from a card on the Økonomi tab and shows what the figures rest on: the formula,
 * the inputs with year and source (`CalculationDetail`), the years, and the annual reports.
 * Everything the old Økonomi section showed lives here (the years band, earnings per year, the
 * bridge from revenue to result, the threshold meters, the metric table, traction, the
 * calculations, what could not be calculated and "Hent eller skift regnskab"); nothing is lost.
 *
 * The sentence under the title is built in code from the figures (`economy-text.ts`).
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FocusPage } from "@/components/ds/FocusPage";
import { MetricArea } from "@/components/charts/primitives";
import { CalculationList } from "@/components/cases/CalculationList";
import {
  DataBand,
  EarningsChart,
  MetricTable,
  ResultBridge,
  ThresholdBullets,
} from "@/components/cases/FinancialDeepSection";
import { CalculationDetail } from "@/components/cases/CalculationDetail";
import { FinancialStatementsPanel } from "@/components/cases/FinancialStatementsPanel";
import type { FinancialMetric, FinancialMetricsReport } from "@/lib/analysis/financial-metrics";
import {
  ECONOMY_COLOR,
  ECONOMY_FOCUS,
  economyView,
  unitEconomics,
  type EconomyFocusKind,
  type EconomyView,
} from "@/lib/cases/deep-view";
import { calculationValue, cashStory, revenueStory } from "@/lib/cases/economy-text";
import { financeLabel } from "@/lib/cases/finance-labels";
import { missingDataMailto, unresolvedReason } from "@/lib/cases/missing-data";
import type { AnalysisView, CaseViewModel } from "@/lib/cases/view-model";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { useLanguage, useT } from "@/lib/i18n/useT";
import type { Language } from "@/lib/i18n/language";
import type { MessageKey, TranslateVars } from "@/lib/i18n/translate";
import { Fold } from "./blocks";
import {
  CashChart,
  RevenueMarginChart,
  RevenueMarginLegend,
  UnitEconomicsBars,
} from "./EconomyCharts";

const TITLES: Record<EconomyFocusKind, MessageKey> = {
  omsaetning: "finance.economy.cardRevenue",
  likviditet: "finance.economy.cardCash",
  "unit-economics": "finance.economy.cardUnit",
  noegletal: "finance.economy.cardMetrics",
};

function metricByKey(report: FinancialMetricsReport, key: string): FinancialMetric | null {
  return report.metrics.find((metric) => metric.key === key) ?? null;
}

/** "Sådan er det regnet" for the named metrics: formula, inputs, year and source. */
function HowItWasCalculated({
  report,
  keys,
}: {
  report: FinancialMetricsReport;
  keys: readonly string[];
}) {
  const metrics = keys.flatMap((key) => {
    const metric = metricByKey(report, key);
    return metric?.latest ? [metric] : [];
  });
  if (metrics.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {metrics.map((metric) => (
        <CalculationDetail
          key={metric.key}
          metric={metric}
          point={metric.latest!}
          currency={report.currency}
        />
      ))}
    </div>
  );
}

const UNIT_FORMULAS: Array<[string, MessageKey]> = [
  ["cac", "finance.economy.formulaCac"],
  ["ltv", "finance.economy.formulaLtv"],
  ["ltv_cac", "finance.economy.formulaLtvCac"],
  ["cac_payback", "finance.economy.formulaPayback"],
];
const UNIT_METRICS = ["ltv", "cac", "cac_payback", "ltv_cac", "revenue_per_customer"];

export function EconomyFocus({
  kind,
  model,
  analysis,
  fundId,
  report,
  reportingClass,
  now,
  onBack,
}: {
  kind: EconomyFocusKind;
  model: CaseViewModel;
  analysis: AnalysisView;
  fundId: string;
  report: FinancialMetricsReport | null | undefined;
  reportingClass: string | null;
  now: number;
  onBack: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const view = economyView(report, language);
  const unit = unitEconomics(analysis.calculations);
  let order = 0;
  const box = (title: string | null, children: ReactNode, note?: ReactNode) => {
    const delay = 0.1 + order++ * 0.06;
    return (
      <motion.section
        className="flex flex-col gap-3.5 rounded-xl bg-canvas px-5 py-5 md:px-6 md:py-[22px]"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? REDUCED_FADE : { duration: 0.56, ease: EASE.out, delay }}
      >
        {title && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h3 className="m-0 text-section font-semibold">{title}</h3>
            <div className="flex-1" />
            {note && <span className="text-meta text-ink-3">{note}</span>}
          </div>
        )}
        {children}
      </motion.section>
    );
  };

  const answer = answerFor(kind, view, unit, language, t);
  const unresolved = analysis.calculations.filter((calc) => calc.status !== "ok");
  const unitUnresolved = analysis.calculations.filter(
    (calc) => calc.status !== "ok" && UNIT_METRICS.includes(calc.metric),
  );
  const hasReport = Boolean(report && report.years.length > 0);

  return (
    <FocusPage
      backLabel={t("finance.economy.backLabel")}
      onBack={onBack}
      title={t(TITLES[kind])}
      subtitle={
        <span className="flex items-center gap-2.5">
          <span className="size-2 rounded-full" style={{ background: ECONOMY_COLOR }} aria-hidden />
          {t("finance.economy.subtitle")}
        </span>
      }
    >
      {answer && (
        <motion.p
          className="m-0 max-w-[760px] text-[18px] leading-[1.55] text-pretty text-ink-1"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? REDUCED_FADE : { duration: 0.56, ease: EASE.out, delay: 0.04 }}
        >
          {answer}
        </motion.p>
      )}

      {kind === ECONOMY_FOCUS.revenue && report && view && (
        <>
          {box(
            t(TITLES.omsaetning),
            <div className="max-w-[760px]">
              <RevenueMarginChart view={view} />
            </div>,
            <span className="flex items-center gap-4">
              <RevenueMarginLegend view={view} />
            </span>,
          )}
          {box(
            t("finance.deepSection.financialYears"),
            <DataBand report={report} reportingClass={reportingClass} />,
          )}
          {box(null, <EarningsChart report={report} />)}
          {box(null, <ResultBridge report={report} />)}
          {box(
            t("finance.kpi.howCalculated"),
            <HowItWasCalculated
              report={report}
              keys={["revenue", "gross_profit", "revenue_growth", "gross_margin"]}
            />,
          )}
        </>
      )}

      {kind === ECONOMY_FOCUS.cash && report && view && (
        <>
          {box(
            t("finance.economy.cashPerYear"),
            <div className="max-w-[560px]">
              <CashChart view={view} now={now} />
            </div>,
          )}
          {box(null, <ThresholdBullets report={report} />)}
          {box(
            t("finance.kpi.howCalculated"),
            <HowItWasCalculated
              report={report}
              keys={["cash", "operating_burn", "runway_at_balance_date", "runway_today"]}
            />,
            t("finance.economy.estimatesNote"),
          )}
        </>
      )}

      {kind === ECONOMY_FOCUS.unit && unit && (
        <>
          {box(
            t("finance.economy.figures"),
            <UnitEconomicsBars view={unit} />,
            t("finance.economy.unitNote"),
          )}
          {box(
            t("finance.kpi.howCalculated"),
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14px] leading-normal text-ink-2">
              {UNIT_FORMULAS.map(([key, formula]) => (
                <li key={key}>{t(formula)}</li>
              ))}
              <li className="text-ink-3">{t("finance.economy.unitInputsNote")}</li>
            </ul>,
          )}
          {unitUnresolved.length > 0 &&
            box(
              t("finance.economy.cannotCalculate"),
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {unitUnresolved.map((calc) => (
                  <li key={calc.metric} className="text-[14px] leading-normal text-ink-2">
                    <strong className="text-ink-1">{financeLabel(calc.metric, language)}</strong>
                    {" – "}
                    {unresolvedReason(calc, language)}
                  </li>
                ))}
              </ul>,
            )}
        </>
      )}

      {kind === ECONOMY_FOCUS.metrics && (
        <>
          {hasReport && report && (
            <>
              {box(
                t("finance.deepSection.financialYears"),
                <DataBand report={report} reportingClass={reportingClass} />,
              )}
              {box(null, <MetricTable report={report} />)}
            </>
          )}
          {model.financialSeries.length > 0 &&
            box(
              t("finance.economy.traction"),
              <div className="grid gap-5 md:grid-cols-2">
                {model.financialSeries.map((series) => (
                  <div key={series.metric}>
                    <h4 className="mb-2 text-meta font-semibold text-ink-1">
                      {series.metric.replaceAll("_", " ")}
                    </h4>
                    <MetricArea
                      points={series.points}
                      ariaLabel={t("finance.economy.overTime", { metric: series.metric })}
                    />
                  </div>
                ))}
              </div>,
              t("finance.economy.tractionNote"),
            )}
          {analysis.calculations.length > 0 &&
            box(null, <CalculationList calculations={analysis.calculations} />)}
          {unresolved.length > 0 &&
            box(
              t("finance.economy.cannotCalculate"),
              <>
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {unresolved.map((calc) => (
                    <li key={calc.metric} className="text-meta leading-4 text-ink-2">
                      <strong className="text-ink-1">{financeLabel(calc.metric, language)}</strong>
                      {" — "}
                      {unresolvedReason(calc, language)}
                    </li>
                  ))}
                </ul>
                <a
                  href={missingDataMailto(model.companyName, unresolved, language)}
                  className="w-fit text-meta font-medium text-action hover:underline"
                >
                  {t("finance.economy.sendMissing")}
                </a>
              </>,
              t(
                unresolved.length === 1
                  ? "finance.economy.unresolvedOne"
                  : "finance.economy.unresolvedMany",
                { count: unresolved.length },
              ),
            )}
          <Fold
            id="regnskabsdata"
            title={t("finance.economy.foldTitle")}
            summary={t("finance.economy.foldSummary")}
          >
            <FinancialStatementsPanel
              fundId={fundId}
              caseId={model.id}
              companyName={model.companyName}
            />
          </Fold>
        </>
      )}
    </FocusPage>
  );
}

function answerFor(
  kind: EconomyFocusKind,
  view: EconomyView | null,
  unit: ReturnType<typeof unitEconomics>,
  language: Language,
  t: (key: MessageKey, vars?: TranslateVars) => string,
): string {
  if (kind === ECONOMY_FOCUS.revenue) return view ? revenueStory(view, language) : "";
  if (kind === ECONOMY_FOCUS.cash) return view ? cashStory(view, language) : "";
  if (kind === ECONOMY_FOCUS.unit && unit) {
    const parts: string[] = [];
    if (unit.ratio !== null) {
      parts.push(
        t("finance.economy.answerRatio", {
          value: calculationValue({ value: unit.ratio, unit: null }, language),
        }),
      );
    }
    if (unit.payback !== null) {
      parts.push(
        t("finance.economy.answerPayback", {
          value: calculationValue(
            { value: unit.payback, unit: t("finance.economy.months") },
            language,
          ),
        }),
      );
    }
    return parts.length > 0 ? parts.join(" ") : t("finance.economy.answerUnitFallback");
  }
  if (kind === ECONOMY_FOCUS.metrics) {
    return t("finance.economy.answerMetrics");
  }
  return "";
}
