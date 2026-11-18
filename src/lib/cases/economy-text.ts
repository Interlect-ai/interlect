/**
 * The one-sentence answers on the Økonomi sub-pages (Case Dyb analyse v5 `DET`, "answer"). They
 * are built in code from the figures the code calculated (`economyView`), never written by AI,
 * and only state what the figures show: a missing figure leaves the sentence out.
 */
import {
  currencySuffix,
  formatByUnit,
  formatDkkCompact,
  formatRunway,
} from "../analysis/financial-format.ts";
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate } from "../i18n/translate.ts";
import type { EconomyView } from "./deep-view.ts";

function percent(value: number, language: Language): string {
  return formatByUnit("percent", value, language);
}

/** "Omsætningen er gået fra 3,1 mio. i 2022 til 14,2 mio. i 2025. Bruttomarginen er steget …" */
export function revenueStory(view: EconomyView, language: Language = "da"): string {
  const card = view.revenueCard;
  if (!card) return "";
  const pick = (year: EconomyView["years"][number]) =>
    card.series === "revenue" ? year.revenue : year.grossProfit;
  const withValue = view.years.filter((year) => pick(year) !== null);
  const noun = translate(
    language,
    card.series === "revenue" ? "finance.story.nounRevenue" : "finance.story.nounGrossProfit",
  );
  const unit = currencySuffix(view.currency, language);
  const parts: string[] = [];
  const first = withValue[0];
  const last = withValue[withValue.length - 1];
  if (first && last) {
    parts.push(
      first === last
        ? translate(language, "finance.story.single", {
            noun,
            amount: formatDkkCompact(pick(last)!, language),
            unit,
            year: last.year,
          })
        : translate(language, "finance.story.range", {
            noun,
            from: formatDkkCompact(pick(first)!, language),
            unit,
            fromYear: first.year,
            to: formatDkkCompact(pick(last)!, language),
            toYear: last.year,
          }),
    );
  }
  const margins = view.years.filter((year) => year.margin !== null);
  const marginFirst = margins[0];
  const marginLast = margins[margins.length - 1];
  if (marginFirst && marginLast && marginFirst !== marginLast) {
    const change = marginLast.margin! - marginFirst.margin!;
    parts.push(
      change === 0
        ? translate(language, "finance.story.marginUnchanged", {
            value: percent(marginLast.margin!, language),
          })
        : translate(language, change > 0 ? "finance.story.marginUp" : "finance.story.marginDown", {
            from: percent(marginFirst.margin!, language),
            fromYear: marginFirst.year,
            to: percent(marginLast.margin!, language),
            toYear: marginLast.year,
          }),
    );
  } else if (marginLast) {
    parts.push(
      translate(language, "finance.story.marginWas", {
        value: percent(marginLast.margin!, language),
        year: marginLast.year,
      }),
    );
  }
  return parts.join(" ");
}

/** A finance calculation's value with the unit the code calculated it in ("4,2 x", "9 måneder"). */
export function calculationValue(
  row: { value: number; unit: string | null },
  language: Language = "da",
): string {
  const value = new Intl.NumberFormat(LANGUAGE_TAGS[language], { maximumFractionDigits: 2 }).format(
    row.value,
  );
  return row.unit ? `${value} ${row.unit}` : value;
}

/** The runway sentence: from today if calculable, else from the balance date, else the cash. */
export function cashStory(view: EconomyView, language: Language = "da"): string {
  const card = view.cashCard;
  if (!card) return "";
  const projection = card.projection;
  if (projection?.monthsFromToday != null) {
    return translate(language, "finance.story.cashFromToday", {
      runway: formatRunway(projection.monthsFromToday, language),
    });
  }
  if (projection) {
    return translate(language, "finance.story.cashAtBalance", {
      year: projection.fromPeriodEnd.slice(0, 4),
      runway: formatRunway(projection.months, language),
    });
  }
  const lastCash = [...view.years].reverse().find((year) => year.cash !== null);
  return lastCash
    ? translate(language, "finance.story.cashOnly", {
        amount: formatDkkCompact(lastCash.cash!, language),
        unit: currencySuffix(view.currency, language),
        year: lastCash.year,
      })
    : "";
}
