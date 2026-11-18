/**
 * Finans-gates i kode (masterplan C7, research 07 afsnit 3). En fond kan have mandatgates
 * med disse faste nøgler; så regnes resultatet deterministisk af nøgletalsmotoren og
 * overskriver AI'ens bud, før scoren regnes (princip 6: finansiel matematik aldrig af AI).
 * Manglende data er "ukendt" (passed: null), aldrig et brud (princip 7).
 *
 * Ren fil (ingen database), så den kan testes med node --test.
 */
import { LANGUAGE_TAGS, type Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";
import type { FinancialMetricsReport } from "./financial-metrics.ts";

// i18n-keep: names and descriptions are saved in the fund's setup as the fund's own text.
export const FINANCE_GATES = [
  {
    key: "finance_positive_equity",
    label: "Positiv egenkapital",
    description:
      "Egenkapitalen i seneste godkendte årsrapport er positiv. Regnes i kode fra CVR-regnskabet; kun bindende, når CVR-matchet er sikkert.",
    treatment: "hard",
  },
  {
    key: "finance_runway_12m",
    label: "Runway på mindst 12 måneder i dag",
    description:
      "Likvider rækker mindst 12 måneder fra i dag med samme driftsnære burn, eller selskabet brænder ikke penge af. Estimat fra regnskabet.",
    treatment: "review",
  },
  {
    key: "finance_min_filings",
    label: "Mindst 2 godkendte regnskabsår (3 for etablerede selskaber)",
    description: "Antal indlæste årsregnskaber for CVR-nummeret.",
    treatment: "review",
  },
  {
    key: "finance_filing_age_18m",
    label: "Seneste regnskab højst 18 måneder gammelt",
    description: "Måneder fra seneste balancedag til i dag. Ældre tal giver falsk tryghed.",
    treatment: "review",
  },
  {
    key: "finance_no_going_concern",
    label: "Ingen going concern-note i seneste regnskab",
    description:
      "Seneste årsrapport har ingen note om væsentlig usikkerhed om fortsat drift. Læses i kode fra CVR-regnskabet; uden oplysningen er reglen ukendt, ikke brudt.",
    treatment: "review",
  },
  {
    key: "finance_nibd_ebitda_3x",
    label: "Nettogæld højst 3 × EBITDA",
    description: "Kræver rentebærende gæld opdelt i regnskabet. Ellers ukendt, aldrig et gæt.",
    treatment: "review",
  },
] as const;

export type FinanceGateKey = (typeof FINANCE_GATES)[number]["key"];

const FINANCE_GATE_KEYS = new Set<string>(FINANCE_GATES.map((gate) => gate.key));

export function isFinanceGate(key: string): key is FinanceGateKey {
  return FINANCE_GATE_KEYS.has(key);
}

export interface FinanceGateResult {
  passed: boolean | null;
  confidence: number;
  rationale: string;
}

export interface FinanceGateContext {
  report: FinancialMetricsReport | null;
  /** Regnskaberne kunne ikke læses (teknisk fejl) — aldrig det samme som "ingen regnskaber". */
  loadError?: boolean;
  /** CVR-matchet er sikkert (identitetsstatus "confirmed"). */
  identityConfirmed: boolean;
  /** Selskabets stadie; etablerede selskaber skal have 3 regnskabsår. */
  stage: string | null;
  /** Going concern-note i seneste regnskab (0030); null/udeladt = ukendt. */
  latestGoingConcernNote?: boolean | null | undefined;
  /** The language the rationale is written in; Danish when left out. */
  language?: Language | undefined;
}

/** "later" i dag; vækst og buyout/generationsskifte tilføjes med stadierne i P1. */
const ESTABLISHED_STAGES = new Set(["later", "growth", "buyout"]);

/** Behandlingen er låst pr. finans-gate: kun positiv egenkapital er bindende. */
export function financeGateTreatment(key: FinanceGateKey): "hard" | "review" {
  return FINANCE_GATES.find((gate) => gate.key === key)!.treatment;
}

function formats(language: Language) {
  const tag = LANGUAGE_TAGS[language];
  return {
    decimal: new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }),
    whole: new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }),
    date: new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeZone: "UTC" }),
  };
}

function latestOf(report: FinancialMetricsReport, key: string) {
  return report.metrics.find((metric) => metric.key === key)?.latest ?? null;
}

function unknown(rationale: string): FinanceGateResult {
  return { passed: null, confidence: 0, rationale };
}

/** Beløb i rapportens valuta: "kr." for DKK, ellers koden (NOK); aldrig omregnet. */
function amount(value: number, report: FinancialMetricsReport, language: Language) {
  const unit =
    report.currency && report.currency !== "DKK"
      ? report.currency
      : translate(language, "finance.format.dkk");
  return `${value < 0 ? "−" : ""}${formats(language).whole.format(Math.abs(value))} ${unit}`;
}

/** Kildeteksten: "CVR-regnskab" for danske tal, ellers registrets regnskab (fx Brønnøysund). */
function sourceLabel(report: FinancialMetricsReport, language: Language) {
  return translate(
    language,
    report.registryCountry
      ? "analysisServer.gates.registrySource"
      : "analysisServer.gates.cvrSource",
  );
}

export function evaluateFinanceGate(
  key: FinanceGateKey,
  context: FinanceGateContext,
): FinanceGateResult {
  const report = context.report;
  const language = context.language ?? "da";
  const text = (key: string, vars?: TranslateVars) =>
    translate(language, `analysisServer.gates.${key}` as MessageKey, vars);
  const { decimal, whole, date } = formats(language);
  if (context.loadError) {
    return unknown(text("loadError"));
  }
  if (!report || report.years.length === 0) {
    return unknown(text("noReports"));
  }
  // Tal fra et CVR, vi ikke er sikre på er selskabets, må aldrig afgøre et krav.
  if (!context.identityConfirmed) {
    return unknown(text(report.registryCountry ? "registryMatchUnsure" : "cvrMatchUnsure"));
  }
  switch (key) {
    case "finance_positive_equity": {
      const equity = latestOf(report, "equity");
      if (!equity || equity.value === null) {
        return unknown(text("equityNotReported"));
      }
      const when = date.format(new Date(`${equity.periodEnd}T00:00:00Z`));
      const vars = {
        amount: amount(equity.value, report, language),
        date: when,
        source: sourceLabel(report, language),
      };
      return {
        passed: equity.value > 0,
        confidence: 1,
        rationale: equity.value > 0 ? text("equityPositive", vars) : text("equityNegative", vars),
      };
    }
    case "finance_runway_12m": {
      const runway = latestOf(report, "runway_today");
      const burn = latestOf(report, "operating_burn");
      if (burn?.value === 0) {
        return {
          passed: true,
          confidence: 0.7,
          rationale: text("noBurn"),
        };
      }
      if (!runway || runway.value === null) {
        return unknown(runway?.note ?? text("runwayUnknown"));
      }
      const months = runway.value;
      const label =
        months >= 120
          ? text("overTenYears")
          : text("aboutMonths", { months: whole.format(months) });
      return {
        passed: months >= 12,
        confidence: 0.6,
        rationale: text("runwayToday", { runway: label }),
      };
    }
    case "finance_min_filings": {
      const count = report.years.length;
      const required = context.stage && ESTABLISHED_STAGES.has(context.stage) ? 3 : 2;
      return {
        passed: count >= required,
        confidence: 1,
        rationale: text("filings", { count, required }),
      };
    }
    case "finance_filing_age_18m": {
      const age = latestOf(report, "latest_filing_age");
      if (!age || age.value === null) return unknown(text("ageUnknown"));
      return {
        passed: age.value <= 18,
        confidence: 1,
        rationale: text("age", { months: decimal.format(age.value) }),
      };
    }
    case "finance_no_going_concern": {
      const note = context.latestGoingConcernNote ?? null;
      if (note === null && report.registryCountry) {
        return unknown(text("goingConcernRegistryUnknown"));
      }
      if (note === null) {
        return unknown(text("goingConcernNotRead"));
      }
      return {
        passed: !note,
        confidence: 1,
        rationale: note ? text("goingConcernNote") : text("goingConcernNone"),
      };
    }
    case "finance_nibd_ebitda_3x":
      return unknown(text("debtNotSplit"));
  }
}

/**
 * Overskriv AI'ens vurdering af finans-gates med kodens resultat. Andre gates røres ikke.
 */
export function applyFinanceGates<
  T extends {
    gateKey: string;
    passed: boolean | null;
    confidence: number;
    rationale: string;
    evidenceIds: string[];
  },
>(gates: T[], context: FinanceGateContext): T[] {
  return gates.map((gate) => {
    if (!isFinanceGate(gate.gateKey)) return gate;
    const result = evaluateFinanceGate(gate.gateKey, context);
    // Koden har ikke brugt AI'ens evidens-ID'er; de må ikke stå som belæg for kodens svar.
    return { ...gate, ...result, evidenceIds: [] };
  });
}
