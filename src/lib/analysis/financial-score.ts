/**
 * C8: kode-score for "finansiel styrke" (research 02 afsnit 6). Fem delmål omsættes til
 * 0-100 med stykkevis lineære kurver og vægtes efter casens stadie, så et seed-selskab
 * ikke straffes for manglende omsætning (princip 7). Er under halvdelen af vægten dækket
 * af data, gives ingen kode-score, og den nuværende metode bruges. Ren fil med tests.
 */
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey } from "../i18n/translate.ts";
import type { FinancialMetricsReport } from "./financial-metrics.ts";

export const FINANCIAL_SCORE_VERSION = "interlect-financial-score-v2";
/** AI'en må justere kode-scoren så meget op eller ned (hybrid-tilstand). */
export const FINANCIAL_SCORE_AI_BAND = 10;

type Curve = Array<[value: number, score: number]>;

export const CURVES: Record<SubMetricKey, Curve> = {
  growth: [
    [-10, 10],
    [0, 35],
    [15, 60],
    [40, 85],
    [80, 95],
  ],
  ebitda_margin: [
    [-30, 15],
    [0, 45],
    [10, 65],
    [20, 85],
    [30, 95],
  ],
  equity_ratio: [
    [0, 5],
    [10, 30],
    [30, 65],
    [50, 85],
  ],
  runway: [
    [6, 10],
    [12, 50],
    [18, 70],
    [24, 90],
  ],
  current_ratio: [
    [0.8, 20],
    [1, 45],
    [1.5, 70],
    [2, 85],
  ],
};

export type SubMetricKey = "growth" | "ebitda_margin" | "equity_ratio" | "runway" | "current_ratio";

/** The sub-metric's name in the report's language. */
function subMetricLabel(key: SubMetricKey, language: Language) {
  return translate(language, `analysisServer.financeScore.labels.${key}` as MessageKey);
}

/** Stykkevis lineær: flad under første og over sidste punkt. */
export function applyCurve(curve: Curve, value: number): number {
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (value <= first[0]) return first[1];
  if (value >= last[0]) return last[1];
  for (let index = 1; index < curve.length; index += 1) {
    const [x1, y1] = curve[index]!;
    const [x0, y0] = curve[index - 1]!;
    if (value <= x1) return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/**
 * Vægte pr. stadie (summer til 100). Seed: vækst og margin flyttes til runway og soliditet.
 * Ukendt stadie får Series A-vægtene (midten), ligesom stage-prioren behandler ukendt.
 */
export function stageWeights(stage: string | null): Record<SubMetricKey, number> {
  if (stage === "pre_seed" || stage === "seed") {
    return { growth: 0, ebitda_margin: 0, equity_ratio: 45, runway: 40, current_ratio: 15 };
  }
  if (stage === "series_a" || stage === "unknown" || stage === null) {
    return { growth: 25, ebitda_margin: 12.5, equity_ratio: 20, runway: 27.5, current_ratio: 15 };
  }
  return { growth: 25, ebitda_margin: 25, equity_ratio: 20, runway: 15, current_ratio: 15 };
}

export interface FinancialScoreComponent {
  key: SubMetricKey;
  label: string;
  value: number | null;
  score: number | null;
  weight: number;
}

export interface FinancialScore {
  version: typeof FINANCIAL_SCORE_VERSION;
  /** Null, når under halvdelen af vægten er dækket af data. */
  score: number | null;
  /** Andel af vægten med data (0-1). */
  coverage: number;
  /** Datatillid: stiger med dækningen, falder når seneste regnskab er over 18 måneder gammelt. */
  confidence: number;
  components: FinancialScoreComponent[];
  /** Registrets land, når regnskabet ikke er dansk (fx NO); styrer kildeteksten. */
  registryCountry?: string;
  /** The language of the labels and the rationale; left out = Danish. */
  language?: Language;
}

function latestPoint(report: FinancialMetricsReport, key: string) {
  return report.metrics.find((metric) => metric.key === key)?.latest ?? null;
}

function latest(report: FinancialMetricsReport, key: string): number | null {
  return latestPoint(report, key)?.value ?? null;
}

/** Tillid til kode-scoren: 0,4 + 0,4 × dækning, minus 0,2 ved et regnskab over 18 måneder. */
export function financialScoreConfidence(coverage: number, filingAgeMonths: number | null) {
  const stale = filingAgeMonths !== null && filingAgeMonths > 18 ? 0.2 : 0;
  return Math.round(Math.max(0.2, 0.4 + 0.4 * coverage - stale) * 100) / 100;
}

export function computeFinancialScore(
  report: FinancialMetricsReport,
  stage: string | null,
): FinancialScore {
  const weights = stageWeights(stage);
  const growth = latest(report, "revenue_growth") ?? latest(report, "gross_profit_growth");
  const burn = report.metrics.find((metric) => metric.key === "operating_burn")?.latest;
  // Selvfinansierende (intet driftsnært burn) scorer som lang runway.
  const runway = burn?.value === 0 ? 24 : latest(report, "runway_today");
  // Margin målt mod bruttofortjeneste (klasse B uden omsætning) passer ikke på kurven,
  // som er lavet til omsætning; den udelades, og vægten fordeles på resten.
  const margin = latestPoint(report, "ebitda_margin");
  const marginOnRevenue = margin?.inputs.some((item) => item.metric === "revenue") ?? false;
  const values: Record<SubMetricKey, number | null> = {
    growth,
    ebitda_margin: marginOnRevenue ? (margin?.value ?? null) : null,
    equity_ratio: latest(report, "equity_ratio"),
    runway,
    current_ratio: latest(report, "current_ratio"),
  };
  const components = (Object.keys(weights) as SubMetricKey[]).map((key) => {
    const value = values[key];
    return {
      key,
      label: subMetricLabel(key, report.language ?? "da"),
      value,
      score: value === null ? null : Math.round(applyCurve(CURVES[key], value) * 10) / 10,
      weight: weights[key],
    };
  });
  const covered = components.filter((item) => item.score !== null && item.weight > 0);
  const coveredWeight = covered.reduce((sum, item) => sum + item.weight, 0);
  const coverage = Math.round((coveredWeight / 100) * 100) / 100;
  const score =
    coverage >= 0.5
      ? Math.round(
          (covered.reduce((sum, item) => sum + item.score! * item.weight, 0) / coveredWeight) * 10,
        ) / 10
      : null;
  const confidence = financialScoreConfidence(coverage, latest(report, "latest_filing_age"));
  return {
    version: FINANCIAL_SCORE_VERSION,
    score,
    coverage,
    confidence,
    components,
    ...(report.registryCountry ? { registryCountry: report.registryCountry } : {}),
    ...(report.language && report.language !== "da" ? { language: report.language } : {}),
  };
}

/** A decimal as the language writes it: "1,5" in Danish, "1.5" in English. */
function decimalComma(value: string, language: Language) {
  return language === "da" ? value.replace(".", ",") : value;
}

function formatComponent(item: FinancialScoreComponent, language: Language): string {
  const value = item.value!;
  const shown =
    item.key === "runway"
      ? translate(language, "finance.format.months", { value: Math.round(value) })
      : item.key === "current_ratio"
        ? decimalComma(value.toFixed(2), language)
        : translate(language, "finance.format.percent", { value: Math.round(value) });
  return `${item.label.toLowerCase()} ${shown}`;
}

/**
 * Begrundelsen, der gemmes ved et kriterium forankret i kode-scoren, så teksten aldrig
 * siger "kan ikke vurderes" ved siden af en score regnet fra regnskabet. Den siger ikke,
 * hvordan scoren blev regnet eller justeret (beslutningslog 15. okt), kun tallene
 * med kildemærket og AI'ens begrundelse.
 */
export function financialScoreRationale(
  financeScore: FinancialScore,
  finalScore: number,
  aiRationale: string | null,
): string {
  const language = financeScore.language ?? "da";
  const text = (key: string, vars: Record<string, string | number>) =>
    translate(language, `analysisServer.financeScore.${key}` as MessageKey, vars);
  const used = financeScore.components.filter((item) => item.weight > 0 && item.value !== null);
  const components = used.map((item) => formatComponent(item, language)).join(", ");
  const base = text(financeScore.registryCountry ? "fromRegistry" : "fromCvr", {
    components: components.charAt(0).toUpperCase() + components.slice(1),
    score: String(financeScore.score),
  });
  const adjustment = Math.round((finalScore - financeScore.score!) * 10) / 10;
  if (adjustment === 0 || !aiRationale) return base;
  return text("adjusted", { base, rationale: aiRationale });
}

/** Ældre gemte begrundelser med metodeteksten foran tallene og ved justeringen. */
const LEGACY_METHOD_PREFIX =
  /^(?:Calculated in code from the (?:CVR annual report|registry's annual report)|Regnet i kode fra (?:CVR-regnskabet|registrets regnskab)): /;
const LEGACY_ADJUSTMENT =
  / (?:Adjusted [+-]?[\d.,]+ based on the evidence|Justeret [+-]?[\d.,]+ ud fra evidensen): /;

/**
 * Fjerner metodeteksten fra en begrundelse gemt, så gamle analyser heller ikke
 * siger "regnet i kode" eller "justeret ud fra evidensen". Andre tekster røres ikke.
 */
export function withoutMethodNote(rationale: string): string {
  const prefixed = rationale.match(LEGACY_METHOD_PREFIX);
  let value = rationale;
  if (prefixed) {
    const rest = rationale.slice(prefixed[0].length);
    value = rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return value.replace(LEGACY_ADJUSTMENT, " ");
}

/** Hybrid: AI'ens forslag holdes inden for ±10 point af kode-scoren. */
export function blendFinancialScore(codeScore: number, aiScore: number | null): number {
  if (aiScore === null) return codeScore;
  const low = Math.max(0, codeScore - FINANCIAL_SCORE_AI_BAND);
  const high = Math.min(100, codeScore + FINANCIAL_SCORE_AI_BAND);
  return Math.round(Math.min(high, Math.max(low, aiScore)) * 10) / 10;
}
