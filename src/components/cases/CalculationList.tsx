import { financeLabel } from "@/lib/cases/finance-labels";
import type { CalculationView } from "@/lib/cases/view-model";
import { LANGUAGE_TAGS, type Language } from "@/lib/i18n/language";
import { translate } from "@/lib/i18n/translate";
import { useLanguage, useT } from "@/lib/i18n/useT";

/** One calculation's value as the app shows it (da-DK, at most two decimals, the unit after). */
export function formatCalculationValue(calculation: CalculationView, language: Language = "da") {
  if (calculation.value === null) return translate(language, "caseView.calculations.notCalculable");
  const value = new Intl.NumberFormat(LANGUAGE_TAGS[language], { maximumFractionDigits: 2 }).format(
    calculation.value,
  );
  return calculation.unit ? `${value} ${calculation.unit}` : value;
}

/** Deterministiske beregninger. Manglende input skjules aldrig bag et tal. */
export function CalculationList({ calculations }: { calculations: CalculationView[] }) {
  const t = useT();
  const language = useLanguage();
  if (calculations.length === 0) {
    return (
      <section className="memo-section">
        <h2 className="text-section font-medium text-ink">{t("caseView.calculations.title")}</h2>
        <p className="mt-2 text-list text-ink-3">{t("caseView.calculations.empty")}</p>
      </section>
    );
  }

  return (
    <section className="memo-section">
      <h2 className="text-section font-medium text-ink">{t("caseView.calculations.title")}</h2>
      <ul className="mt-4 divide-y divide-border-subtle">
        {calculations.map((calculation) => (
          <li key={calculation.metric} className="flex flex-wrap gap-x-6 gap-y-1 py-3">
            <span className="w-[12rem] text-body text-ink">
              {financeLabel(calculation.metric, language)}
            </span>
            <span
              data-numeric
              className={calculation.value === null ? "text-body text-ink-3" : "text-body text-ink"}
            >
              {formatCalculationValue(calculation, language)}
            </span>
            <span className="min-w-0 flex-1 text-meta text-ink-3">
              {calculation.missingInputs.length > 0 &&
                `${t("caseView.calculations.missingInput", {
                  inputs: calculation.missingInputs
                    .map((metric) => financeLabel(metric, language))
                    .join(", "),
                })} `}
              {calculation.warnings.join(" ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
