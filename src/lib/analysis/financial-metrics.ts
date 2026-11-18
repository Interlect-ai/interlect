/**
 * Nøgletalsmotoren (masterplan C2, research 02 F6 og 07). Regner deterministisk i
 * kode på de tal, selskabet selv har indberettet til Erhvervsstyrelsen (XBRL), og
 * aldrig med AI (princip 6). Hvert nøgletal har en formel i klartekst, en version,
 * sine input med værdi, regnskabsår og kilde, og en status:
 *  - "ok": regnet direkte på indberettede tal
 *  - "estimat": afledt med en antagelse, som står i noten (fx burn og runway)
 *  - "kan_ikke_beregnes": et input mangler; aldrig et gæt (princip 7)
 *
 * Filen er ren (ingen database, ingen netværk), så den kan testes med
 * `node --test src/lib/analysis/financial-metrics.test.ts`.
 */
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";
import { financialMetricLabel } from "./financial-labels.ts";

export const FINANCIAL_METRICS_VERSION = "interlect-financial-metrics-v1";

export interface MetricsStatementInput {
  periodStart: string;
  periodEnd: string;
  sourceDocumentUrl: string;
  reportingClassText: string | null;
  /**
   * `source` overrides the statement's document for one figure (a figure someone entered on the
   * case), so it is never shown as coming from the annual report.
   */
  lineItems: Array<{ metric: string; value: number; source?: string | undefined }>;
}

export type MetricStatus = "ok" | "estimat" | "kan_ikke_beregnes";
export type MetricUnit = "dkk" | "percent" | "ratio" | "months" | "days" | "count" | "persons";
export type MetricCategory =
  "indtjening" | "vaekst" | "balance" | "likviditet" | "kapital" | "effektivitet" | "datagrundlag";

export interface MetricInput {
  metric: string;
  label: string;
  value: number;
  periodEnd: string;
  sourceDocumentUrl: string;
}

export interface MetricPoint {
  periodEnd: string;
  value: number | null;
  status: MetricStatus;
  inputs: MetricInput[];
  note: string | null;
}

export interface FinancialMetric {
  key: string;
  label: string;
  category: MetricCategory;
  unit: MetricUnit;
  /** Formlen i klartekst, som den vises under "Sådan er det regnet". */
  formula: string;
  /** Ét punkt pr. regnskabsår, ældste først. */
  series: MetricPoint[];
  /** Seneste punkt (også når det ikke kan beregnes). */
  latest: MetricPoint | null;
  /** Kun for beløb (enhed "dkk"), når de ikke er i DKK (fx NOK fra et udenlandsk register). */
  currency?: string;
}

export interface FinancialMetricsReport {
  version: typeof FINANCIAL_METRICS_VERSION;
  asOf: string;
  /**
   * Valutaen for alle beløb (enhed "dkk"), når den ikke er DKK: et udenlandsk register giver
   * tallene i selskabets egen valuta, uden omregning. Udeladt = DKK.
   */
  currency?: string;
  /** Registrets land, når det ikke er Danmark (fx NO): styrer kildeteksten i gates og score. */
  registryCountry?: string;
  /** The language of names, formulas and notes; left out = Danish. */
  language?: Language;
  /** Regnskabsår (periodeslut), ældste først. */
  years: string[];
  metrics: FinancialMetric[];
}

interface Period {
  periodStart: string;
  periodEnd: string;
  source: string;
  reportingClassText: string | null;
  facts: Map<string, number>;
  /** Kilden for de tal, der ikke kommer fra periodens dokument (indtastet på casen). */
  itemSources: Map<string, string>;
  /** Periodens længde i måneder (12, hvis starten ikke kendes). */
  months: number;
  lengthKnown: boolean;
  /** Regnskabsåret lige før, kun når det slutter lige op til dette års start. */
  prior: Period | null;
}

/** Slutdatoer inden for en uge er samme regnskabsår (fx 28. og 29. februar). */
const SAME_PERIOD_DAYS = 7;

function daysBetween(fromIso: string, toIso: string) {
  return (
    (new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

/** Et helt regnskabsår: 11-13 måneder. Ukendt længde regnes som et helt år. */
function isFullYear(period: Period) {
  return !period.lengthKnown || (period.months >= 11 && period.months <= 13);
}

type Compute = (current: Period, prior: Period | null, all: Period[], index: number) => MetricPoint;

interface MetricDefinition {
  key: string;
  category: MetricCategory;
  unit: MetricUnit;
  compute: Compute;
  /** Nøgletal, der kun giver mening for hele serien (fx antal regnskaber). */
  seriesLevel?: boolean;
}

/**
 * The language of the report being computed: names, formulas and notes are read from
 * the dictionary (analysisServer.metrics). Set only for the length of one synchronous
 * `computeFinancialMetrics` call, so two reports never mix languages.
 */
let reportLanguage: Language = "da";

function text(key: string, vars?: TranslateVars) {
  return translate(reportLanguage, `analysisServer.metrics.${key}` as MessageKey, vars);
}

function label(metric: string) {
  return financialMetricLabel(metric, reportLanguage);
}

function input(period: Period, metric: string): MetricInput | null {
  const value = period.facts.get(metric);
  if (value === undefined || !Number.isFinite(value)) return null;
  return {
    metric,
    label: label(metric),
    value,
    periodEnd: period.periodEnd,
    sourceDocumentUrl: period.itemSources.get(metric) ?? period.source,
  };
}

function cannot(period: Period, inputs: MetricInput[], note: string | null): MetricPoint {
  return {
    periodEnd: period.periodEnd,
    value: null,
    status: "kan_ikke_beregnes",
    inputs,
    note: note ?? text("notes.inputMissing"),
  };
}

function point(
  period: Period,
  value: number,
  inputs: MetricInput[],
  note: string | null = null,
  status: MetricStatus = "ok",
): MetricPoint {
  return {
    periodEnd: period.periodEnd,
    value: Number.isFinite(value) ? round(value) : null,
    status: Number.isFinite(value) ? status : "kan_ikke_beregnes",
    inputs,
    note,
  };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** Hent flere input; returnerer null og hvilke der mangler, hvis nogen mangler. */
function need(period: Period, metrics: string[]) {
  const found: MetricInput[] = [];
  const missing: string[] = [];
  for (const metric of metrics) {
    const item = input(period, metric);
    if (item) found.push(item);
    else missing.push(label(metric));
  }
  return { found, missing };
}

function missingNote(missing: string[]) {
  return text("notes.notReported", { names: missing.join(text("notes.and")) });
}

/** Et simpelt nøgletal: brøk af to indberettede tal. */
function ratio(
  numerator: string,
  denominator: string,
  scale: number,
  options: { requirePositiveDenominator?: boolean; note?: string } = {},
): Compute {
  return (period) => {
    const { found, missing } = need(period, [numerator, denominator]);
    if (missing.length) return cannot(period, found, missingNote(missing));
    const top = found[0]!.value;
    const bottom = found[1]!.value;
    if (bottom === 0 || (options.requirePositiveDenominator && bottom < 0)) {
      return cannot(
        period,
        found,
        bottom === 0
          ? text("notes.denominatorZero", { label: label(denominator) })
          : text("notes.denominatorNegative", { label: label(denominator) }),
      );
    }
    return point(period, (top / bottom) * scale, found, options.note ?? null);
  };
}

/** Et tal direkte fra regnskabet. */
function reported(metric: string): Compute {
  return (period) => {
    const item = input(period, metric);
    return item
      ? point(period, item.value, [item])
      : cannot(period, [], missingNote([label(metric)]));
  };
}

/** EBITDA = resultat af primær drift + af- og nedskrivninger. */
function ebitdaOf(period: Period) {
  const { found, missing } = need(period, ["operating_result", "depreciation"]);
  if (missing.length) return { value: null, found, missing };
  // Afskrivninger indberettes som positiv omkostning; nogle filer bruger negativt fortegn.
  return { value: found[0]!.value + Math.abs(found[1]!.value), found, missing };
}

/** Vækst i et tal fra forrige regnskabsår til dette. */
function growth(metric: string): Compute {
  return (period, prior) => {
    const current = input(period, metric);
    if (!prior) {
      return cannot(period, current ? [current] : [], text("notes.needsPriorYear"));
    }
    const previous = input(prior, metric);
    const inputs = [previous, current].filter((item): item is MetricInput => Boolean(item));
    if (!current || !previous) {
      return cannot(period, inputs, text("notes.missingOneYear", { label: label(metric) }));
    }
    if (!isFullYear(period) || !isFullYear(prior)) {
      return cannot(period, inputs, text("notes.notFullYear"));
    }
    if (previous.value <= 0) {
      return cannot(period, inputs, text("notes.priorNotPositive", { label: label(metric) }));
    }
    return point(period, (current.value / previous.value - 1) * 100, inputs);
  };
}

/** Driftsnært burn (år) = −(årets resultat + af- og nedskrivninger), når det er positivt. */
function operatingBurnOf(period: Period) {
  const { found, missing } = need(period, ["net_result", "depreciation"]);
  const net = input(period, "net_result");
  if (!net)
    return { burn: null as number | null, found, reason: missingNote([label("net_result")]) };
  const depreciation = input(period, "depreciation");
  const burn = -(net.value + Math.abs(depreciation?.value ?? 0));
  const inputs = [net, ...(depreciation ? [depreciation] : [])];
  return {
    burn,
    found: inputs,
    reason: missing.length && !depreciation ? text("notes.depreciationMissing") : null,
  };
}

/** Over 10 års runway er i praksis "selvfinansierende"; et større tal er støj. */
const RUNWAY_CAP_MONTHS = 120;

function cappedRunway(months: number) {
  return months > RUNWAY_CAP_MONTHS
    ? {
        value: RUNWAY_CAP_MONTHS,
        extra: ` ${text("notes.runwayCapped")}`,
      }
    : { value: months, extra: "" };
}

function monthsBetween(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * (365.25 / 12));
}

function definitions(asOf: string): MetricDefinition[] {
  return [
    // Indtjening
    {
      key: "revenue",
      category: "indtjening",
      unit: "dkk",
      compute: reported("revenue"),
    },
    {
      key: "gross_profit",
      category: "indtjening",
      unit: "dkk",
      compute: reported("gross_profit"),
    },
    {
      key: "ebit",
      category: "indtjening",
      unit: "dkk",
      compute: reported("operating_result"),
    },
    {
      key: "ebitda",
      category: "indtjening",
      unit: "dkk",
      compute: (period) => {
        const { value, found, missing } = ebitdaOf(period);
        return value === null
          ? cannot(period, found, missingNote(missing))
          : point(period, value, found);
      },
    },
    {
      key: "net_result",
      category: "indtjening",
      unit: "dkk",
      compute: reported("net_result"),
    },
    {
      key: "gross_margin",
      category: "indtjening",
      unit: "percent",
      compute: (period) => {
        if (!input(period, "revenue")) {
          return cannot(period, [], text("notes.revenueHidden"));
        }
        return ratio("gross_profit", "revenue", 100)(period, null, [], 0);
      },
    },
    {
      key: "ebitda_margin",
      category: "indtjening",
      unit: "percent",
      compute: (period) => {
        const { value, found, missing } = ebitdaOf(period);
        if (value === null) return cannot(period, found, missingNote(missing));
        const revenue = input(period, "revenue");
        const base = revenue ?? input(period, "gross_profit");
        if (!base || base.value <= 0) {
          return cannot(period, found, text("notes.noPositiveBase"));
        }
        return point(
          period,
          (value / base.value) * 100,
          [...found, base],
          revenue ? null : text("notes.measuredAgainstGrossProfit"),
        );
      },
    },
    {
      key: "ebit_margin",
      category: "indtjening",
      unit: "percent",
      compute: ratio("operating_result", "revenue", 100, { requirePositiveDenominator: true }),
    },
    {
      key: "personnel_share",
      category: "indtjening",
      unit: "percent",
      compute: ratio("employee_expense", "gross_profit", 100, { requirePositiveDenominator: true }),
    },
    {
      key: "interest_coverage",
      category: "indtjening",
      unit: "ratio",
      compute: (period) => {
        const { found, missing } = need(period, ["operating_result", "finance_expenses"]);
        if (missing.length) return cannot(period, found, missingNote(missing));
        const expenses = Math.abs(found[1]!.value);
        if (expenses === 0) return cannot(period, found, text("notes.noFinanceExpenses"));
        return point(period, found[0]!.value / expenses, found);
      },
    },
    // Vækst
    {
      key: "revenue_growth",
      category: "vaekst",
      unit: "percent",
      compute: growth("revenue"),
    },
    {
      key: "gross_profit_growth",
      category: "vaekst",
      unit: "percent",
      compute: growth("gross_profit"),
    },
    {
      key: "gross_profit_cagr_3y",
      category: "vaekst",
      unit: "percent",
      compute: (period) => {
        // Tre sammenhængende regnskabsår tilbage; et hul eller omlagt år bryder kæden.
        const start = period.prior?.prior?.prior ?? null;
        const end = input(period, "gross_profit");
        const first = start ? input(start, "gross_profit") : null;
        const inputs = [first, end].filter((item): item is MetricInput => Boolean(item));
        if (!start) return cannot(period, inputs, text("notes.needsFourYears"));
        if (!isFullYear(start) || !isFullYear(period))
          return cannot(period, inputs, text("notes.cagrNotFullYear"));
        if (!end || !first) return cannot(period, inputs, text("notes.cagrMissing"));
        if (first.value <= 0 || end.value <= 0)
          return cannot(period, inputs, text("notes.cagrNotPositive"));
        const years = monthsBetween(start.periodEnd, period.periodEnd) / 12;
        return point(period, (Math.pow(end.value / first.value, 1 / years) - 1) * 100, inputs);
      },
    },
    // Balance
    {
      key: "equity",
      category: "balance",
      unit: "dkk",
      compute: reported("equity"),
    },
    {
      key: "equity_ratio",
      category: "balance",
      unit: "percent",
      compute: ratio("equity", "assets", 100),
    },
    {
      key: "debt_to_equity",
      category: "balance",
      unit: "ratio",
      compute: ratio("liabilities", "equity", 1, { requirePositiveDenominator: true }),
    },
    {
      key: "return_on_equity",
      category: "balance",
      unit: "percent",
      compute: (period, prior) => {
        const net = input(period, "net_result");
        const equity = input(period, "equity");
        const priorEquity = prior ? input(prior, "equity") : null;
        const inputs = [net, equity, priorEquity].filter((item): item is MetricInput =>
          Boolean(item),
        );
        if (!net || !equity || !priorEquity) {
          return cannot(period, inputs, text("notes.roeNeeds"));
        }
        const average = (equity.value + priorEquity.value) / 2;
        if (average <= 0) return cannot(period, inputs, text("notes.averageEquityNotPositive"));
        return point(period, (net.value / average) * 100, inputs);
      },
    },
    {
      key: "capital_loss",
      category: "balance",
      unit: "ratio",
      compute: ratio("equity", "contributed_capital", 1, { requirePositiveDenominator: true }),
    },
    {
      key: "balance_check",
      category: "datagrundlag",
      unit: "dkk",
      compute: (period) => {
        const { found, missing } = need(period, ["assets", "liabilities_and_equity"]);
        if (missing.length) return cannot(period, found, missingNote(missing));
        const difference = found[0]!.value - found[1]!.value;
        return point(
          period,
          difference,
          found,
          difference === 0 ? null : text("notes.balanceDiffers"),
        );
      },
    },
    // Likviditet
    {
      key: "cash",
      category: "likviditet",
      unit: "dkk",
      compute: reported("cash"),
    },
    {
      key: "current_ratio",
      category: "likviditet",
      unit: "ratio",
      compute: ratio("current_assets", "shortterm_liabilities", 1, {
        requirePositiveDenominator: true,
      }),
    },
    {
      key: "cash_flow_operating",
      category: "likviditet",
      unit: "dkk",
      compute: reported("cash_flow_operating"),
    },
    {
      key: "cash_conversion",
      category: "likviditet",
      unit: "percent",
      compute: (period) => {
        const cfo = input(period, "cash_flow_operating");
        const { value, found, missing } = ebitdaOf(period);
        if (!cfo) return cannot(period, found, text("notes.noOperatingCashFlow"));
        if (value === null) return cannot(period, [cfo, ...found], missingNote(missing));
        if (value <= 0) return cannot(period, [cfo, ...found], text("notes.ebitdaNotPositive"));
        return point(period, (cfo.value / value) * 100, [cfo, ...found]);
      },
    },
    {
      key: "operating_burn",
      category: "likviditet",
      unit: "dkk",
      compute: (period) => {
        const { burn, found, reason } = operatingBurnOf(period);
        if (burn === null) return cannot(period, found, reason);
        if (burn <= 0) {
          return point(period, 0, found, text("notes.noBurn"), "estimat");
        }
        return point(
          period,
          burn / period.months,
          found,
          `${text("notes.burnEstimate")}${reason ? ` ${reason}` : ""}`,
          "estimat",
        );
      },
    },
    {
      key: "runway_at_balance_date",
      category: "likviditet",
      unit: "months",
      compute: (period) => {
        const cash = input(period, "cash");
        const { burn, found, reason } = operatingBurnOf(period);
        const inputs = [...(cash ? [cash] : []), ...found];
        if (!cash) return cannot(period, inputs, missingNote([label("cash")]));
        if (burn === null) return cannot(period, inputs, reason);
        if (burn <= 0) return cannot(period, inputs, text("notes.runwayNotRelevant"));
        const runway = cappedRunway(cash.value / (burn / period.months));
        return point(
          period,
          runway.value,
          inputs,
          `${text("notes.runwayEstimate")}${runway.extra}`,
          "estimat",
        );
      },
    },
    {
      key: "runway_today",
      category: "likviditet",
      unit: "months",
      compute: (period, _prior, all, index) => {
        const cash = input(period, "cash");
        const { burn, found, reason } = operatingBurnOf(period);
        const inputs = [...(cash ? [cash] : []), ...found];
        if (index !== all.length - 1) return cannot(period, inputs, text("notes.latestOnly"));
        if (!cash) return cannot(period, inputs, missingNote([label("cash")]));
        if (burn === null) return cannot(period, inputs, reason);
        if (burn <= 0) return cannot(period, inputs, text("notes.runwayNotRelevant"));
        const elapsed = monthsBetween(period.periodEnd, asOf);
        const remaining = cash.value / (burn / period.months) - elapsed;
        if (remaining <= 0) {
          return point(
            period,
            0,
            inputs,
            text("notes.runwayRunOut", {
              ago: Math.round(-remaining),
              elapsed: Math.round(elapsed),
            }),
            "estimat",
          );
        }
        const runway = cappedRunway(remaining);
        return point(
          period,
          runway.value,
          inputs,
          `${text("notes.runwayToday", { elapsed: Math.round(elapsed) })}${runway.extra}`,
          "estimat",
        );
      },
    },
    // Kapital
    {
      key: "capital_injection",
      category: "kapital",
      unit: "dkk",
      compute: (period, prior) => {
        const equity = input(period, "equity");
        const net = input(period, "net_result");
        const priorEquity = prior ? input(prior, "equity") : null;
        const dividend = prior ? input(prior, "proposed_dividend") : null;
        const inputs = [equity, priorEquity, net, dividend].filter((item): item is MetricInput =>
          Boolean(item),
        );
        if (!equity || !net || !priorEquity)
          return cannot(period, inputs, text("notes.injectionNeeds"));
        const value = equity.value - priorEquity.value - net.value + (dividend?.value ?? 0);
        return point(
          period,
          value,
          inputs,
          value >= 0 ? text("notes.injectionPositive") : text("notes.injectionNegative"),
          "estimat",
        );
      },
    },
    {
      key: "retained_earnings",
      category: "kapital",
      unit: "dkk",
      compute: reported("retained_earnings"),
    },
    {
      key: "nibd_to_ebitda",
      category: "kapital",
      unit: "ratio",
      compute: (period) => cannot(period, [], text("notes.debtNotSplit")),
    },
    // Effektivitet
    {
      key: "employees",
      category: "effektivitet",
      unit: "persons",
      compute: reported("average_employees"),
    },
    {
      key: "gross_profit_per_employee",
      category: "effektivitet",
      unit: "dkk",
      compute: ratio("gross_profit", "average_employees", 1, { requirePositiveDenominator: true }),
    },
    {
      key: "result_per_employee",
      category: "effektivitet",
      unit: "dkk",
      compute: ratio("net_result", "average_employees", 1, { requirePositiveDenominator: true }),
    },
    {
      key: "dso",
      category: "effektivitet",
      unit: "days",
      compute: (period) =>
        ratio("trade_receivables", "revenue", period.months * (365.25 / 12), {
          requirePositiveDenominator: true,
        })(period, null, [], 0),
    },
    // Datagrundlag (hele serien)
    {
      key: "filing_count",
      category: "datagrundlag",
      unit: "count",
      seriesLevel: true,
      compute: (period, _prior, all) => point(period, all.length, []),
    },
    {
      key: "latest_filing_age",
      category: "datagrundlag",
      unit: "months",
      seriesLevel: true,
      compute: (period, _prior, all) => {
        const latest = all[all.length - 1]!;
        return point(period, monthsBetween(latest.periodEnd, asOf), []);
      },
    },
  ];
}

/**
 * Regn alle nøgletal for alle indlæste regnskabsår. `asOf` er dagens dato (ISO);
 * den styrer "runway i dag" og regnskabets alder og gives ind, så resultatet kan
 * efterregnes.
 */
export function computeFinancialMetrics(
  statements: MetricsStatementInput[],
  asOf: string,
  /**
   * Kilden, når den ikke er et dansk regnskab i DKK, og sproget for navne, formler og
   * noter (standard dansk).
   */
  source: {
    currency?: string | undefined;
    registryCountry?: string | undefined;
    language?: Language | undefined;
  } = {},
): FinancialMetricsReport {
  const previousLanguage = reportLanguage;
  reportLanguage = source.language ?? "da";
  try {
    return computeReport(statements, asOf, source);
  } finally {
    reportLanguage = previousLanguage;
  }
}

function computeReport(
  statements: MetricsStatementInput[],
  asOf: string,
  source: { currency?: string | undefined; registryCountry?: string | undefined },
): FinancialMetricsReport {
  const currency = source.currency ?? "DKK";
  const registryCountry = source.registryCountry ?? "DK";
  // Samme regnskabsår med slutdatoer inden for en uge slås sammen; det seneste gemte
  // (nyeste) regnskabs tal vinder, og tal, kun det andet har, bevares.
  const sorted = [...statements].sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
  const merged: MetricsStatementInput[] = [];
  for (const statement of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && daysBetween(previous.periodEnd, statement.periodEnd) <= SAME_PERIOD_DAYS) {
      const facts = new Map(previous.lineItems.map((item) => [item.metric, item]));
      for (const item of statement.lineItems) facts.set(item.metric, item);
      merged[merged.length - 1] = {
        ...statement,
        periodStart:
          statement.periodStart !== statement.periodEnd
            ? statement.periodStart
            : previous.periodStart,
        lineItems: [...facts.values()],
      };
    } else {
      merged.push(statement);
    }
  }
  const periods: Period[] = [];
  for (const statement of merged) {
    const lengthKnown = statement.periodStart !== statement.periodEnd;
    // Regnskabsår er hele måneder: 1. jan.-31. dec. = 12.
    const months = lengthKnown
      ? Math.max(
          1,
          Math.round((daysBetween(statement.periodStart, statement.periodEnd) + 1) / (365.25 / 12)),
        )
      : 12;
    const previous = periods[periods.length - 1] ?? null;
    // Tilstødende: året før slutter senest en uge før dette års start (eller, uden
    // kendt start, 11-13 måneder før dette års slutning).
    const adjacent =
      previous &&
      (lengthKnown
        ? Math.abs(daysBetween(previous.periodEnd, statement.periodStart) - 1) <= SAME_PERIOD_DAYS
        : Math.abs(monthsBetween(previous.periodEnd, statement.periodEnd) - 12) <= 1);
    periods.push({
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      source: statement.sourceDocumentUrl,
      reportingClassText: statement.reportingClassText,
      facts: new Map(statement.lineItems.map((item) => [item.metric, Number(item.value)])),
      itemSources: new Map(
        statement.lineItems.flatMap((item) => (item.source ? [[item.metric, item.source]] : [])),
      ),
      months,
      lengthKnown,
      prior: adjacent ? previous : null,
    });
  }
  const years = periods.map((period) => period.periodEnd);
  if (!periods.length) {
    return { version: FINANCIAL_METRICS_VERSION, asOf, years, metrics: [] };
  }
  const metrics = definitions(asOf).map((definition): FinancialMetric => {
    const series = definition.seriesLevel
      ? [
          definition.compute(
            periods[periods.length - 1]!,
            periods[periods.length - 1]!.prior,
            periods,
            periods.length - 1,
          ),
        ]
      : periods.map((period, index) => definition.compute(period, period.prior, periods, index));
    return {
      key: definition.key,
      label: text(`defs.${definition.key}.label`),
      category: definition.category,
      unit: definition.unit,
      formula: text(`defs.${definition.key}.formula`),
      series,
      latest: series[series.length - 1] ?? null,
      ...(definition.unit === "dkk" && currency !== "DKK" ? { currency } : {}),
    };
  });
  return {
    version: FINANCIAL_METRICS_VERSION,
    asOf,
    ...(currency !== "DKK" ? { currency } : {}),
    ...(registryCountry !== "DK" ? { registryCountry } : {}),
    ...(reportLanguage !== "da" ? { language: reportLanguage } : {}),
    years,
    metrics,
  };
}

export type CompactMetricUnit = Exclude<MetricUnit, "dkk"> | "amount";

/** Kompakt udgave til finansspecialisten (masterplan C4): seneste værdi og op til 5 år. */
export interface CompactFinancialMetrics {
  version: typeof FINANCIAL_METRICS_VERSION;
  asOf: string;
  /** Valutaen for alle beløb (enhed "amount"): DKK eller registrets egen valuta. */
  currency: string;
  /** Kun når beløbene ikke er i DKK; noten forklarer det for specialisten. */
  currencyNote?: string;
  years: string[];
  metrics: Array<{
    key: string;
    label: string;
    /** Beløb hedder "amount" her, så et norsk tal ikke står med enheden "dkk". */
    unit: CompactMetricUnit;
    formula: string;
    status: MetricStatus;
    latest: number | null;
    note: string | null;
    series: Array<{ year: string; value: number | null }>;
  }>;
}

// i18n-keep: an instruction to the finance specialist in its prompt, never shown to the person.
function currencyNote(currency: string) {
  return `Alle beløb er i ${currency} fra selskabets eget lands officielle register, ikke i DKK fra Erhvervsstyrelsen. Skriv dem i ${currency}, og omregn dem aldrig.`;
}

export function compactFinancialMetrics(report: FinancialMetricsReport): CompactFinancialMetrics {
  return {
    version: report.version,
    asOf: report.asOf,
    currency: report.currency ?? "DKK",
    ...(report.currency ? { currencyNote: currencyNote(report.currency) } : {}),
    years: report.years.slice(-5),
    metrics: report.metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      unit: metric.unit === "dkk" ? "amount" : metric.unit,
      formula: metric.formula,
      status: metric.latest?.status ?? "kan_ikke_beregnes",
      latest: metric.latest?.value ?? null,
      note: metric.latest?.note ?? null,
      series: metric.series.slice(-5).map((point) => ({
        year: point.periodEnd.slice(0, 4),
        value: point.value,
      })),
    })),
  };
}
