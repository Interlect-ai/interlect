/**
 * Finanser as a focus page (Case Screening v5, lines 372–385; "Screening = grundtal": four key
 * figures and one chart; the whole picture is in the deep analysis).
 *
 * Measured: max 1020 px, gap 24; subtitle "Grundtal fra årsregnskaberne. Uddybes i den dybe
 * analyse."; figures auto-fit min 200 px, gap 12, canvas radius xl, padding 20/22, 13 px ink-3
 * over 32/600; the chart box canvas radius xl, padding 24/26, 17/600 title with a legend
 * (8 px squares, series-1 revenue, series-8 gross profit), four year columns in 220 px with two
 * bars each (34 %, radius 8 8 3 3) growing from the bottom, the year in 12 px ink-3. The bars
 * are the prototype's own HTML. All figures come from the code (financial-metrics.ts).
 */
import { motion, useReducedMotion } from "motion/react";
import { FocusPage } from "@/components/ds/FocusPage";
import type { FinanceSummary } from "@/lib/cases/finance-summary";
import { currencySuffix, formatDkkCompact } from "@/lib/analysis/financial-format";
import { EASE, REDUCED_FADE } from "@/lib/motion";
import { useLanguage, useT } from "@/lib/i18n/useT";

export function FinanceFocus({
  companyName,
  onBack,
  finance,
}: {
  companyName: string;
  onBack: () => void;
  finance: FinanceSummary;
}) {
  const t = useT();
  const language = useLanguage();
  const reduced = useReducedMotion();
  const max = Math.max(
    1,
    ...finance.years.flatMap((year) => [
      Math.abs(year.revenue ?? 0),
      Math.abs(year.grossProfit ?? 0),
    ]),
  );
  const series = [
    ...(finance.hasRevenue
      ? [{ key: "revenue" as const, label: t("finance.kpi.revenue"), color: "var(--series-1)" }]
      : []),
    { key: "grossProfit" as const, label: t("finance.kpi.grossProfit"), color: "var(--series-8)" },
  ];
  const rise = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED_FADE }
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.56, ease: EASE.out, delay },
        };
  return (
    <FocusPage
      backLabel={companyName}
      onBack={onBack}
      title={t("finance.summary.title")}
      subtitle={t("finance.summary.subtitle")}
      className="max-w-[1020px]"
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {finance.kpis.map((kpi, index) => (
          <motion.div
            key={kpi.label}
            className="flex flex-col gap-1 rounded-xl bg-canvas px-[22px] py-5"
            {...rise(0.1 + index * 0.06)}
          >
            <span className="text-list text-ink-3">{kpi.label}</span>
            <span className="text-[32px] leading-[1.1] font-semibold tracking-display">
              {kpi.value}
            </span>
          </motion.div>
        ))}
      </div>
      <motion.div
        className="flex flex-col gap-[18px] rounded-xl bg-canvas px-[26px] py-6"
        {...rise(0.2)}
      >
        <div className="flex flex-wrap items-center gap-[18px]">
          <span className="text-section font-semibold">
            {finance.hasRevenue ? t("finance.summary.chartBoth") : t("finance.kpi.grossProfit")}
          </span>
          <div className="flex-1" />
          {series.map((entry) => (
            <span key={entry.key} className="flex items-center gap-1.5 text-meta text-ink-3">
              <span className="size-2 rounded-[2px]" style={{ background: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
        <div
          className="grid h-[220px] items-end gap-6"
          style={{ gridTemplateColumns: `repeat(${finance.years.length}, minmax(0, 1fr))` }}
        >
          {finance.years.map((year, yearIndex) => (
            <div key={year.year} className="flex h-full flex-col items-center justify-end gap-2.5">
              <div className="flex h-full w-full items-end justify-center gap-1.5">
                {series.map((entry, seriesIndex) => {
                  const value = year[entry.key];
                  return (
                    <motion.div
                      key={entry.key}
                      title={
                        value === null
                          ? t("finance.summary.seriesNotReported", { label: entry.label })
                          : `${entry.label}: ${formatDkkCompact(value, language)} ${currencySuffix(finance.currency, language)}`
                      }
                      className="w-[34%] rounded-[8px_8px_3px_3px]"
                      style={{
                        height: `${value === null ? 0 : Math.max(2, (Math.abs(value) / max) * 100)}%`,
                        background: entry.color,
                        transformOrigin: "bottom",
                      }}
                      initial={reduced ? { opacity: 0 } : { scaleY: 0 }}
                      animate={reduced ? { opacity: 1 } : { scaleY: 1 }}
                      transition={
                        reduced
                          ? REDUCED_FADE
                          : {
                              duration: 0.8,
                              ease: EASE.out,
                              delay: 0.25 + yearIndex * 0.09 + seriesIndex * 0.05,
                            }
                      }
                    />
                  );
                })}
              </div>
              <span className="text-meta text-ink-3">{year.year}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </FocusPage>
  );
}
