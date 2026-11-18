/**
 * "Sådan er det regnet" for one key figure: the formula, the inputs with year and source (the
 * annual report) and any note. The figures are calculated in code by the metrics engine
 * (financial-metrics.ts), never by AI. Used by the Økonomi sub-pages (EconomyFocus.tsx).
 */
import { isManualSource } from "@/lib/analysis/manual-financials";
import type { FinancialMetric, MetricPoint } from "@/lib/analysis/financial-metrics";
import { formatInputValue, formatMetricValue } from "@/lib/analysis/financial-format";
import { useLanguage, useT } from "@/lib/i18n/useT";

export function CalculationDetail({
  metric,
  point,
  currency,
}: {
  metric: FinancialMetric;
  point: MetricPoint;
  /** The report's currency (omitted = DKK). */
  currency?: string | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className="mt-3 space-y-1.5 border-l border-hairline pl-3 text-list leading-5 text-ink-2">
      <p>
        <span className="font-semibold text-ink">{metric.label}</span>
        {point.value !== null && ` = ${formatMetricValue(metric, point.value, language)}`}
        {point.status === "estimat" && (
          <span className="text-ink-3"> · {t("finance.kpi.estimate")}</span>
        )}
      </p>
      <p className="text-ink-3">{metric.formula}</p>
      {point.inputs.length > 0 && (
        <ul className="space-y-0.5">
          {point.inputs.map((input) => (
            <li key={`${input.metric}-${input.periodEnd}`} className="flex flex-wrap gap-x-1.5">
              <span>{input.label}</span>
              <span className="tabular-nums text-ink">
                {formatInputValue(input.metric, input.value, currency, language)}
              </span>
              <span className="text-ink-3">({input.periodEnd.slice(0, 4)},</span>
              {isManualSource(input.sourceDocumentUrl) ? (
                <span className="text-ink-3">{t("finance.kpi.enteredOnCase")}</span>
              ) : (
                <a
                  href={input.sourceDocumentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-action hover:text-action-hover"
                >
                  {t("finance.kpi.annualReport")}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {point.note && <p className="text-ink-3">{point.note}</p>}
    </div>
  );
}
