/**
 * Henter og aflæser danske selskabers offentligt tilgængelige regnskaber fra
 * Erhvervsstyrelsens system-til-system-adgang (distribution.virk.dk +
 * regnskaber.virk.dk) -- gratis, ingen nøgle, ingen login. Tallene læses
 * direkte fra den strukturerede XBRL-fil (fsa:-navnerum), aldrig fra en AI,
 * så et tal enten er det tallet virksomheden faktisk har indberettet, eller
 * det findes slet ikke. Se db/README.md for kildehenvisning.
 *
 * Vigtig begrænsning, bekræftet ved rigtige stikprøver: mange små danske
 * selskaber ("regnskabsklasse B") slår lovligt omsætning og vareforbrug
 * sammen til én post ("bruttofortjeneste") -- der findes derfor ofte ingen
 * omsætningstal at hente, uanset hvor godt man leder.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";
import { FINANCIAL_METRIC_LABELS_DA } from "./financial-labels.ts";
import { registryDataPoints } from "./registry-data-points.ts";
import { requestLanguage, serverText } from "../i18n/server-text.ts";
import type { MessageKey, TranslateVars } from "../i18n/translate.ts";
import {
  compactFinancialMetrics,
  computeFinancialMetrics,
  type CompactFinancialMetrics,
  type FinancialMetricsReport,
  type MetricsStatementInput,
} from "./financial-metrics.ts";
import { applyFinanceGates, isFinanceGate, type FinanceGateContext } from "./financial-gates.ts";
import { computeFinancialScore, type FinancialScore } from "./financial-score.ts";
import type { RegistryAnchor } from "./financial-input-check.ts";
import {
  registryAdapter,
  type ForeignRegistryCountry,
  type RegistryCountry,
  type RegistryStatement,
} from "./registries/index.ts";

const SEARCH_ENDPOINT = "http://distribution.virk.dk/offentliggoerelser/_search";
const USER_AGENT = "interlect.ai/1.0 (+https://interlect.ai)";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_DOCUMENT_BYTES = 8_000_000;
/** Masterplan C1: så mange regnskabsår hentes (research 07: 5-10 år). */
export const MAX_FILING_YEARS = 8;
/** Samtidige downloads fra Erhvervsstyrelsen, så vi er en høflig bruger af den gratis tjeneste. */
const FILING_FETCH_CONCURRENCY = 3;

/**
 * Kendte fsa:-fakta vi genkender, og deres normaliserede metriknavn. Flere
 * tags kan pege på samme metrik (fx skiftede taksonomien fra
 * `GrossProfitLoss` til `GrossResult` i 2022) -- første tag i listen vinder,
 * hvis begge findes for samme periode.
 */
const KNOWN_TAGS: Array<[tag: string, metric: string]> = [
  ["Revenue", "revenue"],
  ["GrossProfitLoss", "gross_profit"],
  ["GrossResult", "gross_profit"],
  ["CostOfSales", "cost_of_sales"],
  ["RawMaterialsAndConsumablesUsed", "raw_materials"],
  ["OtherExternalExpenses", "other_external_expenses"],
  ["EmployeeBenefitsExpense", "employee_expense"],
  [
    "DepreciationAmortisationExpenseAndImpairmentLossesOfPropertyPlantAndEquipmentAndIntangibleAssetsRecognisedInProfitOrLoss",
    "depreciation",
  ],
  ["DepreciationAmortisationExpenseAndImpairmentLosses", "depreciation"],
  ["ProfitLossFromOrdinaryOperatingActivities", "operating_result"],
  ["OtherFinanceIncome", "finance_income"],
  ["OtherFinanceExpenses", "finance_expenses"],
  ["ProfitLossFromOrdinaryActivitiesBeforeTax", "result_before_tax"],
  ["TaxExpense", "tax_expense"],
  ["TaxExpenseOnOrdinaryActivities", "tax_expense"],
  ["ProfitLoss", "net_result"],
  ["Assets", "assets"],
  ["NoncurrentAssets", "noncurrent_assets"],
  ["CurrentAssets", "current_assets"],
  ["Inventories", "inventories"],
  ["ShorttermTradeReceivables", "trade_receivables"],
  ["CashAndCashEquivalents", "cash"],
  ["Equity", "equity"],
  ["ContributedCapital", "contributed_capital"],
  ["RetainedEarnings", "retained_earnings"],
  ["ProposedDividendRecognisedInEquity", "proposed_dividend"],
  ["Provisions", "provisions"],
  ["LiabilitiesOtherThanProvisions", "liabilities"],
  ["LongtermLiabilitiesOtherThanProvisions", "longterm_liabilities"],
  ["ShorttermLiabilitiesOtherThanProvisions", "shortterm_liabilities"],
  ["ShorttermTradePayables", "trade_payables"],
  ["LiabilitiesAndEquity", "liabilities_and_equity"],
  ["CashFlowsFromUsedInOperatingActivities", "cash_flow_operating"],
  ["CashFlowsFromUsedInInvestingActivities", "cash_flow_investing"],
  ["CashFlowsFromUsedInFinancingActivities", "cash_flow_financing"],
  ["AverageNumberOfEmployees", "average_employees"],
];

const FSA_NAMESPACE = "http://xbrl.dcca.dk/fsa";
const XBRLI_NAMESPACE = "http://www.xbrl.org/2003/instance";

export interface FilingReference {
  cvrNumber: string;
  periodStart: string;
  periodEnd: string;
  approvedAt: string | null;
  documentUrl: string;
  documentMimeType: string;
}

/**
 * Søger Erhvervsstyrelsens offentlige regnskabsindeks efter et CVR-nummer.
 * Returnerer højst ét regnskab pr. regnskabsperiode (det senest godkendte, fx en
 * rettet årsrapport), nyeste periode først.
 */
export async function searchVirkFilings(cvrNumber: string): Promise<FilingReference[]> {
  const response = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({
      query: { term: { cvrNummer: Number(cvrNumber) } },
      sort: [{ "regnskab.regnskabsperiode.slutDato": { order: "desc" } }],
      size: MAX_FILING_YEARS * 2,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(text("indexStatus", { status: response.status }));
  }
  const body = (await response.json()) as {
    hits?: { hits?: Array<{ _source?: Record<string, unknown> }> };
  };
  const hits = body.hits?.hits ?? [];
  const filings: FilingReference[] = [];
  for (const hit of hits) {
    const source = hit._source;
    if (!source) continue;
    const regnskab = source["regnskab"] as Record<string, unknown> | undefined;
    const periode = regnskab?.["regnskabsperiode"] as Record<string, unknown> | undefined;
    const godkendelse = regnskab?.["godkendelse"] as Record<string, unknown> | undefined;
    const startDato = periode?.["startDato"];
    const slutDato = periode?.["slutDato"];
    const dokumenter = source["dokumenter"] as
      Array<{ dokumentUrl?: string; dokumentMimeType?: string; dokumentType?: string }> | undefined;
    const xmlDoc = (dokumenter ?? []).find(
      (doc) => doc.dokumentMimeType === "application/xml" && doc.dokumentType === "AARSRAPPORT",
    );
    if (typeof startDato !== "string" || typeof slutDato !== "string" || !xmlDoc?.dokumentUrl) {
      continue;
    }
    filings.push({
      cvrNumber,
      periodStart: startDato,
      periodEnd: slutDato,
      approvedAt: (godkendelse?.["godkendelsesdato"] as string | undefined) ?? null,
      documentUrl: xmlDoc.dokumentUrl,
      documentMimeType: xmlDoc.dokumentMimeType ?? "application/xml",
    });
  }
  const byPeriod = new Map<string, FilingReference>();
  for (const filing of filings) {
    const existing = byPeriod.get(filing.periodEnd);
    if (!existing || (filing.approvedAt ?? "") > (existing.approvedAt ?? "")) {
      byPeriod.set(filing.periodEnd, filing);
    }
  }
  return [...byPeriod.values()]
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))
    .slice(0, MAX_FILING_YEARS);
}

interface ParsedContext {
  isPure: boolean;
  instant: string | null;
  start: string | null;
  end: string | null;
}

interface ParsedFact {
  metric: string;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
}

/** Regnskabsklasse-tekst + fakta pr. periode, direkte fra XBRL-filens fsa:-tags. */
export interface ParsedStatementPeriod {
  periodStart: string;
  periodEnd: string;
  facts: ParsedFact[];
}

export interface ParsedFiling {
  reportingClassText: string | null;
  /** Selskabet har en note om usikkerhed om fortsat drift (going concern). */
  goingConcernNote: boolean;
  periods: ParsedStatementPeriod[];
}

type XmlNode = Record<string, unknown>;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Alle børn af roden som lister, så et enkelt faktum og mange fakta læses ens.
  isArray: (_name, jpath) => String(jpath).split(".").length === 2,
});

function asArray(value: unknown): XmlNode[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as XmlNode[];
}

function textOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object" && "#text" in (value as XmlNode)) {
    return String((value as XmlNode)["#text"]).trim();
  }
  return null;
}

/** Finder et barn uanset hvilket præfiks (eller intet) filen bruger for navnerummet. */
function child(node: XmlNode, names: string[]): unknown {
  for (const name of names) {
    if (name in node) return node[name];
  }
  return undefined;
}

/**
 * Aflæser en XBRL-årsrapport til fakta pr. periode. Ingen AI -- ren
 * udtræk. Navnerumspræfikser læses fra filens egne `xmlns`-erklæringer, fordi
 * danske regnskaber bruger `fsa:`, `d:`, `c:` m.fl. for samme taksonomi, og
 * attributter kan stå i vilkårlig rækkefølge.
 */
export function parseXbrlFiling(xml: string): ParsedFiling {
  const document = xmlParser.parse(xml) as XmlNode;
  const rootKey = Object.keys(document).find(
    (key) => !key.startsWith("?") && (key === "xbrl" || key.endsWith(":xbrl")),
  );
  const root = (rootKey ? document[rootKey] : undefined) as XmlNode | undefined;
  if (!root) return { reportingClassText: null, goingConcernNote: false, periods: [] };

  const prefixes = new Map<string, string[]>();
  for (const [key, value] of Object.entries(root)) {
    if (!key.startsWith("@_xmlns")) continue;
    const prefix = key === "@_xmlns" ? "" : key.slice("@_xmlns:".length);
    const list = prefixes.get(String(value)) ?? [];
    list.push(prefix);
    prefixes.set(String(value), list);
  }
  const qualified = (namespace: string, local: string): string[] => {
    const known = prefixes.get(namespace) ?? [];
    const names = known.map((prefix) => (prefix ? `${prefix}:${local}` : local));
    // Nogle ældre filer erklærer navnerummet uden præfiks på elementerne.
    return names.length > 0 ? names : [local, `xbrli:${local}`];
  };
  const xbrli = (local: string) => qualified(XBRLI_NAMESPACE, local);
  const fsa = (local: string) => qualified(FSA_NAMESPACE, local);

  const contexts = new Map<string, ParsedContext>();
  for (const context of asArray(child(root, xbrli("context")))) {
    const id = String(context["@_id"] ?? "");
    if (!id) continue;
    const entity = (asArray(child(context, xbrli("entity")))[0] ?? {}) as XmlNode;
    const period = (asArray(child(context, xbrli("period")))[0] ?? {}) as XmlNode;
    const hasScenario = child(context, xbrli("scenario")) !== undefined;
    const hasSegment = child(entity, xbrli("segment")) !== undefined;
    contexts.set(id, {
      isPure: !hasScenario && !hasSegment,
      instant: textOf(child(period, xbrli("instant"))),
      start: textOf(child(period, xbrli("startDate"))),
      end: textOf(child(period, xbrli("endDate"))),
    });
  }

  const units = new Map<string, string>();
  for (const unit of asArray(child(root, xbrli("unit")))) {
    const id = String(unit["@_id"] ?? "");
    const measure = textOf(child(unit, xbrli("measure"))) ?? "";
    if (id) units.set(id, measure.split(":").pop() ?? measure);
  }

  const reportingClassText = textOf(
    asArray(child(root, fsa("ClassOfReportingEntity")))[0] ?? undefined,
  );
  const goingConcernNote =
    child(root, fsa("DisclosureOfUncertaintiesRelatingToGoingConcern")) !== undefined;

  const factsByPeriodEnd = new Map<string, ParsedFact[]>();
  const periodStartByEnd = new Map<string, string>();
  for (const [tag, metric] of KNOWN_TAGS) {
    for (const element of asArray(child(root, fsa(tag)))) {
      const contextRef = String(element["@_contextRef"] ?? "");
      const context = contexts.get(contextRef);
      if (!context || !context.isPure) continue;
      const periodEnd = context.instant ?? context.end;
      if (!periodEnd) continue;
      const value = Number(textOf(element));
      if (!Number.isFinite(value)) continue;
      const unitRef = String(element["@_unitRef"] ?? "");
      const existing = factsByPeriodEnd.get(periodEnd) ?? [];
      // Samme metrik kan optræde flere gange (alias-tags eller dubletter uden
      // dimension) -- første fund vinder, ingen dublet.
      if (existing.some((item) => item.metric === metric)) continue;
      existing.push({
        metric,
        value,
        unit: units.get(unitRef) ?? "DKK",
        periodStart: context.start,
        periodEnd,
      });
      factsByPeriodEnd.set(periodEnd, existing);
      if (context.start && !periodStartByEnd.has(periodEnd)) {
        periodStartByEnd.set(periodEnd, context.start);
      }
    }
  }

  const periods: ParsedStatementPeriod[] = [...factsByPeriodEnd.entries()]
    .map(([periodEnd, facts]) => ({
      periodEnd,
      periodStart: periodStartByEnd.get(periodEnd) ?? periodEnd,
      facts,
    }))
    // En "periode" med kun en primo-saldo (fx egenkapital ved årets start) er
    // ikke et regnskabsår og må ikke bruges som "forrige år".
    .filter(isRealStatementPeriod)
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));

  return { reportingClassText, goingConcernNote, periods };
}

const BALANCE_METRICS = new Set(["assets", "equity", "liabilities_and_equity"]);
const RESULT_METRICS = new Set(["net_result", "operating_result", "gross_profit", "revenue"]);

function isRealStatementPeriod(period: ParsedStatementPeriod): boolean {
  if (period.facts.length >= 5) return true;
  const hasBalance = period.facts.some((fact) => BALANCE_METRICS.has(fact.metric));
  const hasResult = period.facts.some((fact) => RESULT_METRICS.has(fact.metric));
  return hasBalance && hasResult;
}

const CURRENCY_UNIT = /^[A-Z]{3}$/;

/**
 * The currency a filing reports its amounts in: the most common ISO currency among its
 * amounts, from the XBRL units. A Danish company may report in EUR; then the statements are EUR.
 */
export function filingCurrency(parsed: ParsedFiling): string {
  const counts = new Map<string, number>();
  for (const period of parsed.periods) {
    for (const fact of period.facts) {
      if (CURRENCY_UNIT.test(fact.unit)) counts.set(fact.unit, (counts.get(fact.unit) ?? 0) + 1);
    }
  }
  let best = "DKK";
  let bestCount = 0;
  for (const [unit, count] of counts) {
    if (count > bestCount) [best, bestCount] = [unit, count];
  }
  return best;
}

/** Henter og pakker en offentliggjort regnskabsfil ud (Erhvervsstyrelsen sender gzip). */
export async function fetchAndParseFiling(documentUrl: string): Promise<ParsedFiling> {
  const response = await fetch(documentUrl, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(text("fileStatus", { status: response.status }));
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(text("fileTooLarge"));
  }
  const bytes = new Uint8Array(buffer);
  // gzip-magic-bytes: 0x1f 0x8b
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const xml = isGzip
    ? new TextDecoder().decode(
        await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer(),
      )
    : new TextDecoder().decode(bytes);
  return parseXbrlFiling(xml);
}

export interface FinancialRatio {
  key: string;
  label: string;
  value: number | null;
  unit: "percent" | "ratio" | "dkk";
  status: "ok" | "kan_ikke_beregnes";
  note: string | null;
}

function factValue(facts: ParsedFact[], metric: string): number | null {
  return facts.find((fact) => fact.metric === metric)?.value ?? null;
}

/**
 * Rene, deterministiske nøgletal fra de faktisk indberettede tal -- aldrig
 * gæt. En periode uden de nødvendige input giver "kan_ikke_beregnes", aldrig
 * et halvt eller antaget tal.
 */
export function computeFinancialRatios(
  current: ParsedStatementPeriod,
  prior: ParsedStatementPeriod | null,
): FinancialRatio[] {
  const assets = factValue(current.facts, "assets");
  const equity = factValue(current.facts, "equity");
  const liabilities = factValue(current.facts, "liabilities");
  const grossProfit = factValue(current.facts, "gross_profit");
  const netResult = factValue(current.facts, "net_result");
  const employees = factValue(current.facts, "average_employees");
  const priorEquity = prior ? factValue(prior.facts, "equity") : null;

  const ratios: FinancialRatio[] = [];

  ratios.push({
    key: "equity_ratio",
    label: text("ratios.equityRatio"),
    value: assets && assets !== 0 && equity !== null ? (equity / assets) * 100 : null,
    unit: "percent",
    status: assets && equity !== null ? "ok" : "kan_ikke_beregnes",
    note: null,
  });

  ratios.push({
    key: "solvency_ratio",
    label: text("ratios.solvencyRatio"),
    value: equity && equity !== 0 && liabilities !== null ? liabilities / equity : null,
    unit: "ratio",
    status: equity && liabilities !== null ? "ok" : "kan_ikke_beregnes",
    note: equity !== null && equity < 0 ? text("ratios.negativeEquity") : null,
  });

  ratios.push({
    key: "equity_growth",
    label: text("ratios.equityGrowth"),
    value:
      priorEquity !== null && priorEquity !== 0 && equity !== null
        ? ((equity - priorEquity) / Math.abs(priorEquity)) * 100
        : null,
    unit: "percent",
    status: priorEquity !== null && equity !== null ? "ok" : "kan_ikke_beregnes",
    note: prior === null ? text("ratios.onePeriod") : null,
  });

  ratios.push({
    key: "result_per_employee",
    label: text("ratios.resultPerEmployee"),
    value: employees && employees !== 0 && netResult !== null ? netResult / employees : null,
    unit: "dkk",
    status: employees && netResult !== null ? "ok" : "kan_ikke_beregnes",
    note: employees === null ? text("ratios.noEmployees") : null,
  });

  ratios.push({
    key: "gross_margin",
    label: text("ratios.grossMargin"),
    value: null,
    unit: "percent",
    status: "kan_ikke_beregnes",
    note: grossProfit !== null ? text("ratios.grossMarginCombined") : text("ratios.noGrossProfit"),
  });

  return ratios;
}

export interface StoredFinancialStatement {
  id: string;
  /** Registernummeret i `registryCountry` (DK: CVR, NO: org.nr.). */
  cvrNumber: string;
  registryCountry: RegistryCountry;
  reportingClassText: string | null;
  periodStart: string;
  periodEnd: string;
  currency: string;
  sourceDocumentUrl: string;
  fetchedAt: string;
  lineItems: Array<{ metric: string; value: number; unit: string }>;
}

/** Omsætter et gemt regnskab til nøgletalsmotorens input. */
export function toMetricsInput(statement: StoredFinancialStatement): MetricsStatementInput {
  return {
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    sourceDocumentUrl: statement.sourceDocumentUrl,
    reportingClassText: statement.reportingClassText,
    lineItems: statement.lineItems.map((item) => ({ metric: item.metric, value: item.value })),
  };
}

export interface FetchAndStoreFinancialsResult {
  statements: StoredFinancialStatement[];
  ratios: FinancialRatio[];
  /** C2: alle nøgletal for alle år med formel, input og status. */
  metrics: FinancialMetricsReport;
  /** Ikke-blokerende problemer, fx at evidens ikke kunne gemmes. Vises til brugeren. */
  warnings: string[];
}

const METRIC_LABELS_DA = FINANCIAL_METRIC_LABELS_DA;

/** The messages to the person, in the language of the page or the fund's run. */
function text(key: string, vars?: TranslateVars) {
  return serverText(`analysisServer.statements.${key}` as MessageKey, vars);
}

/** Kildetypen for regnskaber fra et udenlandsk register (danske hedder `cvr_regnskab`). */
export const REGISTRY_STATEMENT_SOURCE_TYPE = "registry_regnskab";

/**
 * Henter, gemmer og udregner et selskabs offentlige regnskab ud fra et
 * CVR-nummer -- delt kerne, som både det manuelle "Hent regnskab"-klik og den
 * automatiske opslags-kæde (se applyDiscoveredCompanyProfile) kalder, så der
 * kun er ét sted at holde denne logik korrekt. Skriver også regnskabstallene
 * som rigtige evidence_items (kilde: Erhvervsstyrelsen, status "verified"),
 * så specialistanalysen kan citere dem -- uden det kan et tal her aldrig
 * bruges i selve vurderingen, kun vises i panelet.
 */
/** Slutdatoer inden for en uge er samme regnskabsår (fx 28. og 29. februar). */
const SAME_PERIOD_DAYS = 7;

/**
 * Selskabet har ingen regnskaber, vi kan bruge (typisk et ungt selskab uden årsrapport
 * endnu). Det er "ikke fundet", ikke en fejl, man skal prøve igen.
 */
export class FinancialsNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialsNotFoundError";
  }
}

function daysApart(a: string, b: string) {
  return (
    Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) /
    86_400_000
  );
}

/** En reel rettelse, ikke blot afrunding til hele tusinder i sammenligningstallene. */
function isRestatement(existing: number, newer: number) {
  const difference = Math.abs(existing - newer);
  return difference > 1_000 && difference > Math.abs(existing) * 0.01;
}

interface MergedPeriod {
  periodStart: string;
  periodEnd: string;
  sourceDocumentUrl: string;
  reportingClassText: string | null;
  fromOwnFiling: boolean;
  /** Kun kendt fra årets eget regnskab; null, når året kun kendes fra sammenligningstal. */
  goingConcernNote: boolean | null;
  facts: Map<string, { value: number; unit: string }>;
}

/**
 * Henter, gemmer og udregner et selskabs offentlige regnskaber (op til 8 år) ud fra et
 * CVR-nummer -- delt kerne for det manuelle "Hent regnskab"-klik og den automatiske
 * opslags-kæde. Hvert regnskabsår samles i hukommelsen og skrives én gang: årets eget
 * regnskab går forud, et nyere regnskabs sammenligningstal udfylder manglende tal og
 * vinder kun ved en reel rettelse. Skriver også det seneste regnskabs tal som
 * evidence_items (kilde: Erhvervsstyrelsen, status "verified"), så analysen kan citere dem.
 */
export async function fetchAndStoreCompanyFinancials(
  service: SupabaseClient,
  input: {
    fundId: string;
    caseId: string;
    cvrNumber: string;
    actorId: string | null;
    /** Regnskabsindekset, hvis kalderen allerede har hentet det. */
    filings?: FilingReference[];
  },
): Promise<FetchAndStoreFinancialsResult> {
  const filings = input.filings ?? (await searchVirkFilings(input.cvrNumber));
  if (filings.length === 0) {
    throw new FinancialsNotFoundError(text("noneForCvr"));
  }
  const latestFiling = filings[0]!;
  const warnings: string[] = [];

  // C1: alle regnskabsår, ikke kun det seneste. Det seneste hentes først og skal
  // lykkes; først derefter hentes de ældre få ad gangen, så et ulæseligt nyt
  // regnskab ikke koster otte downloads for ingenting.
  const parsedByUrl = new Map<string, ParsedFiling>();
  let parsed: ParsedFiling;
  try {
    parsed = await fetchAndParseFiling(latestFiling.documentUrl);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.warn(`[financial-statements] ${input.cvrNumber} ${latestFiling.periodEnd}: ${reason}`);
    throw new Error(text("latestNotFetched", { reason }));
  }
  if (parsed.periods.length === 0) {
    throw new FinancialsNotFoundError(text("latestNoFigures"));
  }
  parsedByUrl.set(latestFiling.documentUrl, parsed);
  const olderFilings = filings.slice(1);
  for (let index = 0; index < olderFilings.length; index += FILING_FETCH_CONCURRENCY) {
    const batch = olderFilings.slice(index, index + FILING_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((filing) => fetchAndParseFiling(filing.documentUrl)),
    );
    results.forEach((result, offset) => {
      const filing = batch[offset]!;
      if (result.status === "fulfilled" && result.value.periods.length > 0) {
        parsedByUrl.set(filing.documentUrl, result.value);
        return;
      }
      const reason =
        result.status === "rejected"
          ? String(result.reason?.message ?? result.reason)
          : text("noRecognisedFigures");
      console.warn(`[financial-statements] ${input.cvrNumber} ${filing.periodEnd}: ${reason}`);
      warnings.push(text("periodSkipped", { periodEnd: filing.periodEnd }));
    });
  }

  // Valutaen er det seneste regnskabs; et ældre regnskabs beløb i en anden valuta blandes ikke ind.
  const currency = filingCurrency(parsed);

  // Saml hvert regnskabsår i hukommelsen, ældste regnskab først.
  const merged = new Map<string, MergedPeriod>();
  for (const filing of [...filings].reverse()) {
    const filingParsed = parsedByUrl.get(filing.documentUrl);
    if (!filingParsed) continue;
    for (const period of filingParsed.periods) {
      const own = daysApart(period.periodEnd, filing.periodEnd) <= SAME_PERIOD_DAYS;
      // Nøglen er indeksets slutdato for året, når et regnskab dækker det.
      const key =
        filings.find(
          (candidate) => daysApart(candidate.periodEnd, period.periodEnd) <= SAME_PERIOD_DAYS,
        )?.periodEnd ??
        [...merged.keys()].find(
          (existing) => daysApart(existing, period.periodEnd) <= SAME_PERIOD_DAYS,
        ) ??
        period.periodEnd;
      const target =
        merged.get(key) ??
        ({
          periodStart: period.periodStart,
          periodEnd: key,
          sourceDocumentUrl: filing.documentUrl,
          reportingClassText: filingParsed.reportingClassText,
          fromOwnFiling: own,
          goingConcernNote: own ? filingParsed.goingConcernNote : null,
          facts: new Map(),
        } satisfies MergedPeriod);
      if (own && !target.fromOwnFiling) {
        target.fromOwnFiling = true;
        target.sourceDocumentUrl = filing.documentUrl;
        target.reportingClassText = filingParsed.reportingClassText;
        target.goingConcernNote = filingParsed.goingConcernNote;
        target.periodStart = period.periodStart;
      }
      for (const fact of period.facts) {
        if (CURRENCY_UNIT.test(fact.unit) && fact.unit !== currency) continue;
        const existing = target.facts.get(fact.metric);
        if (!existing || isRestatement(existing.value, fact.value)) {
          target.facts.set(fact.metric, { value: fact.value, unit: fact.unit });
        }
      }
      merged.set(key, target);
    }
  }

  // Det seneste regnskabs egne år bliver evidens med præcis de tal, det dokument angiver.
  const stored = await storeRegistryStatements(
    service,
    { fundId: input.fundId, caseId: input.caseId, actorId: input.actorId },
    {
      country: "DK",
      registryNumber: input.cvrNumber,
      currency,
      sourceKind: "xbrl_structured",
      source: {
        url: latestFiling.documentUrl,
        title: `Offentligt regnskab, CVR ${input.cvrNumber}`,
        sourceType: "cvr_regnskab",
        date: dateOrNull(latestFiling.approvedAt),
      },
      statedBy: "Erhvervsstyrelsen (CVR/offentligt regnskab)",
      statements: [...merged.values()].map((period) => ({
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        sourceDocumentUrl: period.sourceDocumentUrl,
        reportingClassText: period.reportingClassText,
        goingConcernNote: period.goingConcernNote,
        facts: [...period.facts.entries()].map(([metric, fact]) => ({
          metric,
          tag: metric,
          ...fact,
        })),
      })),
      evidencePeriods: parsed.periods,
    },
  );
  warnings.push(...stored.warnings);
  const ratios = computeFinancialRatios(parsed.periods[0]!, parsed.periods[1] ?? null);
  const metrics = computeFinancialMetrics(
    stored.statements.map(toMetricsInput),
    new Date().toISOString().slice(0, 10),
    { currency, registryCountry: "DK", language: requestLanguage() },
  );
  return { statements: stored.statements, ratios, metrics, warnings };
}

/** Ét regnskabsår, klar til at blive gemt, fra Erhvervsstyrelsen eller et udenlandsk register. */
export interface StatementToStore {
  periodStart: string;
  periodEnd: string;
  sourceDocumentUrl: string;
  reportingClassText: string | null;
  /** null: ukendt; en tidligere gemt værdi bevares. */
  goingConcernNote: boolean | null;
  /** `tag` er kildens eget navn for tallet (XBRL-tag eller registrets felt). */
  facts: Array<{ metric: string; value: number; unit: string; tag: string }>;
}

export interface StatementSetToStore {
  country: RegistryCountry;
  registryNumber: string;
  currency: string;
  sourceKind: "xbrl_structured" | "registry_json" | "ixbrl_structured";
  /** Kilden, evidensen peger på (det seneste regnskab). */
  source: { url: string; title: string; sourceType: string; date: string | null };
  /** Hvem tallene kommer fra, som det står i evidensen. */
  statedBy: string;
  statements: StatementToStore[];
  /** Årene, der skrives som evidens: det seneste regnskabs egne tal. */
  evidencePeriods: Array<{
    periodStart: string;
    periodEnd: string;
    facts: Array<{ metric: string; value: number; unit: string }>;
  }>;
}

// i18n-keep: the evidence is the registry's own figures, cited by the analysis (register data).
function registryEvidenceClaim(
  metric: string,
  value: number,
  unit: string,
  period: { periodStart: string; periodEnd: string },
): string {
  return `${METRIC_LABELS_DA[metric] ?? metric}: ${value.toLocaleString("da-DK")} ${unit} for perioden ${period.periodStart} til ${period.periodEnd}.`;
}

/**
 * Revenue and cash from the register become finance data points on the case, so a
 * screening shows them without any AI. Each point points at the register evidence row it comes
 * from; a point already saved for the same evidence is not saved again (a re-fetch is safe).
 */
async function storeRegistryDataPoints(
  service: SupabaseClient,
  input: { fundId: string; caseId: string },
  sourceId: string,
  evidencePeriods: StatementSetToStore["evidencePeriods"],
): Promise<void> {
  const wanted = registryDataPoints(evidencePeriods, registryEvidenceClaim);
  if (wanted.length === 0) return;
  const { data: evidence, error: evidenceError } = await service
    .from("evidence_items")
    .select("id, claim")
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId)
    .eq("source_id", sourceId);
  if (evidenceError) throw evidenceError;
  const evidenceByClaim = new Map(
    (evidence ?? []).map((row) => [row["claim"] as string, row["id"] as string]),
  );
  const rows = wanted.flatMap((point) => {
    const evidenceId = evidenceByClaim.get(point.claim);
    return evidenceId
      ? [
          {
            fund_id: input.fundId,
            case_id: input.caseId,
            metric: point.metric,
            value: point.value,
            unit: point.unit,
            period_start: point.periodStart,
            period_end: point.periodEnd,
            evidence_id: evidenceId,
          },
        ]
      : [];
  });
  if (rows.length === 0) return;
  const { data: existing, error: existingError } = await service
    .from("financial_data_points")
    .select("metric, evidence_id")
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId)
    .in("evidence_id", [...new Set(rows.map((row) => row.evidence_id))]);
  if (existingError) throw existingError;
  const have = new Set((existing ?? []).map((row) => `${row["metric"]}|${row["evidence_id"]}`));
  const fresh = rows.filter((row) => !have.has(`${row.metric}|${row.evidence_id}`));
  if (fresh.length === 0) return;
  const { error } = await service.from("financial_data_points").insert(fresh);
  if (error) throw error;
}

/**
 * Fælles lagring for alle registre: kilden registreres én gang pr. regnskabsfil, gamle
 * dubletter af samme år ryddes op, hvert år skrives én gang med sine linjer, og det seneste
 * regnskabs tal bliver evidens (status "verified"), så analysen kan citere dem. Evidensen
 * skrives kun første gang, så en genhentning ikke giver dubletter, der både forvirrer AI'en og
 * tæller dobbelt i datatilliden. Nyeste år først.
 */
export async function storeRegistryStatements(
  service: SupabaseClient,
  input: { fundId: string; caseId: string; actorId: string | null },
  set: StatementSetToStore,
): Promise<{ statements: StoredFinancialStatement[]; warnings: string[] }> {
  const warnings: string[] = [];
  const { data: existingSource, error: existingSourceError } = await service
    .from("sources")
    .select("id")
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId)
    .eq("url", set.source.url)
    .maybeSingle();
  if (existingSourceError) throw new Error(text("sourceNotLookedUp"));
  const sourceAlreadyStored = Boolean(existingSource);
  const { data: sourceRow, error: sourceError } = existingSource
    ? { data: existingSource, error: null }
    : await service
        .from("sources")
        .insert({
          fund_id: input.fundId,
          case_id: input.caseId,
          url: set.source.url,
          title: set.source.title,
          source_type: set.source.sourceType,
          entity_match_status: "confirmed",
          source_date: set.source.date,
          fetched_at: new Date().toISOString(),
        })
        .select("id")
        .single();
  if (sourceError || !sourceRow) throw new Error(text("sourceNotRegistered"));
  const sourceId = sourceRow["id"] as string;

  // Fjern tidligere gemte dubletter af samme år med en anden slutdato (fx 29. februar).
  const periodEnds = set.statements.map((statement) => statement.periodEnd);
  const { data: storedRows, error: storedError } = await service
    .from("financial_statements")
    .select("id, period_end")
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId)
    .eq("registry_country", set.country)
    .eq("cvr_number", set.registryNumber);
  if (storedError) throw new Error(text("storedNotRead"));
  const staleIds = (storedRows ?? [])
    .filter((row) => {
      const end = row["period_end"] as string;
      return (
        !periodEnds.includes(end) &&
        periodEnds.some((key) => daysApart(key, end) <= SAME_PERIOD_DAYS)
      );
    })
    .map((row) => row["id"] as string);
  if (staleIds.length) {
    const { error: staleError } = await service
      .from("financial_statements")
      .delete()
      .in("id", staleIds);
    if (staleError) throw new Error(text("duplicatesNotRemoved"));
  }

  const statements: StoredFinancialStatement[] = [];
  for (const period of set.statements) {
    const { data: statementRow, error: statementError } = await service
      .from("financial_statements")
      .upsert(
        {
          fund_id: input.fundId,
          case_id: input.caseId,
          cvr_number: set.registryNumber,
          registry_country: set.country,
          currency: set.currency,
          source_kind: set.sourceKind,
          reporting_class_text: period.reportingClassText,
          // Kun når årets eget regnskab er læst; ellers bevares en tidligere gemt værdi.
          ...(period.goingConcernNote !== null
            ? { going_concern_note: period.goingConcernNote }
            : {}),
          period_start: period.periodStart,
          period_end: period.periodEnd,
          source_document_url: period.sourceDocumentUrl,
          created_by: input.actorId,
        },
        { onConflict: "case_id,cvr_number,period_end" },
      )
      .select(
        "id, cvr_number, registry_country, reporting_class_text, period_start, period_end, currency, source_document_url, fetched_at",
      )
      .single();
    if (statementError || !statementRow) throw new Error(text("statementNotSaved"));
    const statementId = statementRow["id"] as string;
    // Erstat tidligere linjer for året med det samlede, sammenflettede sæt.
    const { error: deleteError } = await service
      .from("financial_statement_line_items")
      .delete()
      .eq("statement_id", statementId);
    if (deleteError) throw new Error(text("linesNotReplaced"));
    if (period.facts.length > 0) {
      const { error: lineItemsError } = await service.from("financial_statement_line_items").insert(
        period.facts.map((fact) => ({
          statement_id: statementId,
          taxonomy_tag: fact.tag,
          metric: fact.metric,
          value: fact.value,
          unit: fact.unit,
        })),
      );
      if (lineItemsError) throw new Error(text("linesNotSaved"));
    }
    statements.push({
      id: statementId,
      cvrNumber: statementRow["cvr_number"] as string,
      registryCountry: statementRow["registry_country"] as RegistryCountry,
      reportingClassText: statementRow["reporting_class_text"] as string | null,
      periodStart: statementRow["period_start"] as string,
      periodEnd: statementRow["period_end"] as string,
      currency: statementRow["currency"] as string,
      sourceDocumentUrl: statementRow["source_document_url"] as string,
      fetchedAt: statementRow["fetched_at"] as string,
      lineItems: period.facts.map(({ metric, value, unit }) => ({ metric, value, unit })),
    });
  }

  // Evidens kun fra det seneste regnskab og med præcis de tal, det dokument angiver, så et
  // citat altid passer med kilden. De ældre år bruges af nøgletalsmotoren og graferne, ikke
  // som evidens, så AI'en ikke drukner i gamle linjer.
  // i18n-keep: the evidence is the registry's own figures, cited by the analysis (register data).
  const evidenceRows = set.evidencePeriods.flatMap((period) =>
    period.facts.map((fact) => ({
      fund_id: input.fundId,
      case_id: input.caseId,
      source_id: sourceId,
      claim: registryEvidenceClaim(fact.metric, fact.value, fact.unit, period),
      source_date: dateOrNull(period.periodEnd),
      observation_date: dateOrNull(period.periodEnd),
      stated_by: set.statedBy,
      confidence: 1,
      status: "verified",
      created_by: input.actorId,
    })),
  );
  let evidenceSaved = sourceAlreadyStored;
  if (evidenceRows.length > 0 && !sourceAlreadyStored) {
    const { error: evidenceError } = await service.from("evidence_items").insert(evidenceRows);
    if (evidenceError) {
      console.error("[financial-statements] evidence insert failed", evidenceError);
      warnings.push(text("evidenceNotSaved"));
    } else {
      evidenceSaved = true;
    }
  }
  if (evidenceSaved && evidenceRows.length > 0) {
    try {
      await storeRegistryDataPoints(service, input, sourceId, set.evidencePeriods);
    } catch (error) {
      // The statements and evidence are saved; only the finance figures on the case are missing.
      console.error("[financial-statements] data points failed", error);
      warnings.push(text("dataPointsNotSaved"));
    }
  }

  statements.sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
  if (statements.length === 0) warnings.push(text("noYearsSaved"));
  return { statements, warnings };
}

/**
 * Henter, gemmer og udregner et udenlandsk selskabs regnskaber fra landets register.
 * Ingen regnskaber i registret er "ikke tilgængeligt" (FinancialsNotFoundError), ikke en fejl:
 * analysen bruger så websøgningens tal, som for et selskab uden dansk CVR.
 */
export async function fetchAndStoreForeignFinancials(
  service: SupabaseClient,
  input: {
    fundId: string;
    caseId: string;
    country: ForeignRegistryCountry;
    registryNumber: string;
    actorId: string | null;
  },
): Promise<FetchAndStoreFinancialsResult> {
  const adapter = registryAdapter(input.country);
  const { statements: found, warnings } = await adapter.fetchStatements(input.registryNumber);
  if (found.length === 0) {
    throw new FinancialsNotFoundError(
      text("foreignNotAvailable", {
        registry: adapter.registryName,
        numberLabel: adapter.numberLabel,
        number: input.registryNumber,
        warnings: warnings.map((warning) => `${warning} `).join(""),
      }),
    );
  }
  const latest = found[0]!;
  const currency = latest.currency;
  const toFacts = (statement: RegistryStatement) =>
    statement.lineItems.map((item) => ({ ...item, unit: statement.currency }));
  const stored = await storeRegistryStatements(
    service,
    { fundId: input.fundId, caseId: input.caseId, actorId: input.actorId },
    {
      country: input.country,
      registryNumber: input.registryNumber,
      currency,
      sourceKind: adapter.sourceKind,
      source: {
        url: latest.sourceDocumentUrl,
        title: `Offentligt regnskab, ${adapter.numberLabel} ${input.registryNumber} (${adapter.registryName})`,
        sourceType: REGISTRY_STATEMENT_SOURCE_TYPE,
        date: dateOrNull(latest.periodEnd),
      },
      statedBy: adapter.registryName,
      statements: found.map((statement) => ({
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        sourceDocumentUrl: statement.sourceDocumentUrl,
        reportingClassText: statement.reportingClassText,
        goingConcernNote: statement.goingConcernNote,
        facts: toFacts(statement),
      })),
      evidencePeriods: [{ ...latest, facts: toFacts(latest) }],
    },
  );
  const asPeriod = (statement: StoredFinancialStatement): ParsedStatementPeriod => ({
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    facts: statement.lineItems.map((item) => ({
      ...item,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
    })),
  });
  const [first, second] = stored.statements;
  return {
    statements: stored.statements,
    ratios: first ? computeFinancialRatios(asPeriod(first), second ? asPeriod(second) : null) : [],
    metrics: computeFinancialMetrics(
      stored.statements.map(toMetricsInput),
      new Date().toISOString().slice(0, 10),
      { currency, registryCountry: input.country, language: requestLanguage() },
    ),
    warnings: [...warnings, ...stored.warnings],
  };
}

function dateOrNull(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * Når et menneske afviser selskabet eller angiver et andet registernummer, må det forkerte
 * selskabs regnskaber ikke blive hængende. Regnskaberne slettes (de kan hentes igen), og
 * evidensen fra dem markeres som forkert selskab i stedet for at blive slettet, så gamle
 * analyser stadig kan vise, hvad de byggede på. Nye analyser ser dem ikke. Numrene har
 * forskelligt antal cifre pr. land (DK 8, NO 9), så nummeret alene afgør, hvad der beholdes.
 */
export async function retireCaseFinancials(
  service: SupabaseClient,
  input: { fundId: string; caseId: string; keepRegistryNumber: string | null },
): Promise<void> {
  let statements = service
    .from("financial_statements")
    .delete()
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId);
  if (input.keepRegistryNumber) {
    statements = statements.neq("cvr_number", input.keepRegistryNumber);
  }
  const { error: statementError } = await statements;
  if (statementError) {
    throw new Error(text("oldNotRemoved", { reason: statementError.message }));
  }
  let sources = service
    .from("sources")
    .update({ entity_match_status: "unconfirmed", entity_match_confidence: 0 })
    .eq("fund_id", input.fundId)
    .eq("case_id", input.caseId)
    // Regnskaber og CVR-stamdata fra et forkert selskab trækkes tilbage sammen.
    .in("source_type", ["cvr_regnskab", "cvr_stamdata", REGISTRY_STATEMENT_SOURCE_TYPE]);
  // Titlerne bærer nummeret som et helt ord ("…, CVR 12345678", "CVR 12345678 (…)",
  // "Org.nr. 998209218 (…)"), så et længere nummer, der starter med det samme, ikke tæller.
  if (input.keepRegistryNumber) {
    sources = sources
      .not("title", "ilike", `% ${input.keepRegistryNumber}`)
      .not("title", "ilike", `% ${input.keepRegistryNumber} %`);
  }
  const { error: sourceError } = await sources;
  if (sourceError) {
    throw new Error(text("oldSourcesNotMarked", { reason: sourceError.message }));
  }
}

/**
 * Casens gemte regnskaber regnet om til nøgletal, for ét selskab (selskabets CVR, ellers
 * det seneste regnskabs), plus om CVR-matchet er sikkert. Null-rapport, når der ingen
 * regnskaber er, eller de ikke kunne læses (logges); analysen kører så videre uden.
 */
export async function loadFinancialMetricsReport(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
): Promise<{
  report: FinancialMetricsReport | null;
  identityConfirmed: boolean;
  /** Regnskaber eller selskab kunne ikke læses; aldrig det samme som "ingen regnskaber". */
  loadError: boolean;
  /** Going concern-note i seneste regnskab; null = ukendt (ikke læst eller ikke egen årsrapport). */
  latestGoingConcernNote: boolean | null;
}> {
  const [{ data, error }, { data: caseRow, error: caseError }] = await Promise.all([
    service
      .from("financial_statements")
      .select(
        "cvr_number, registry_country, currency, period_start, period_end, source_document_url, reporting_class_text, going_concern_note, financial_statement_line_items(metric, value)",
      )
      .eq("fund_id", fundId)
      .eq("case_id", caseId)
      .order("period_end", { ascending: false }),
    service
      .from("cases")
      .select("companies(cvr_number, registry_number, identity_status)")
      .eq("id", caseId)
      .eq("fund_id", fundId)
      .maybeSingle(),
  ]);
  const none = { report: null, identityConfirmed: false, latestGoingConcernNote: null };
  if (caseError || error) {
    console.error(
      `[financial-metrics] financial data unreadable (case ${caseId})`,
      caseError?.message ?? error?.message,
    );
    return { ...none, loadError: true };
  }
  const rawCompany = caseRow?.["companies"] as unknown;
  const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
    cvr_number: string | null;
    registry_number: string | null;
    identity_status: string | null;
  } | null;
  if (!data?.length) return { ...none, loadError: false };
  // Har selskabet et registernummer (dansk CVR eller udenlandsk org.nr.), bruges kun dets
  // regnskaber; et andet selskabs tal må aldrig stå i stedet. Uden et gemt nummer bruges det
  // seneste regnskabs, men aldrig som "sikkert".
  const companyNumber = company?.cvr_number ?? company?.registry_number ?? null;
  if (companyNumber && !data.some((row) => row["cvr_number"] === companyNumber)) {
    return { ...none, loadError: false };
  }
  const cvrNumber = companyNumber ?? (data[0]!["cvr_number"] as string);
  const identityConfirmed = company?.identity_status === "confirmed" && companyNumber === cvrNumber;
  // Rækkerne kommer nyeste først; kun selskabets eget nummer tæller, og kun år i det seneste
  // regnskabs valuta, så en vækstrate aldrig blander to valutaer.
  const latest = data.find((row) => row["cvr_number"] === cvrNumber);
  const currency = (latest?.["currency"] as string | undefined) ?? "DKK";
  const report = computeFinancialMetrics(
    data
      .filter((row) => row["cvr_number"] === cvrNumber && (row["currency"] ?? "DKK") === currency)
      .map((row) => ({
        periodStart: row["period_start"] as string,
        periodEnd: row["period_end"] as string,
        sourceDocumentUrl: row["source_document_url"] as string,
        reportingClassText: row["reporting_class_text"] as string | null,
        lineItems: (
          (row["financial_statement_line_items"] as Array<{ metric: string; value: number }>) ?? []
        ).map((item) => ({ metric: item.metric, value: Number(item.value) })),
      })),
    new Date().toISOString().slice(0, 10),
    {
      currency,
      registryCountry: (latest?.["registry_country"] as string | undefined) ?? "DK",
      language: requestLanguage(),
    },
  );
  const note = latest?.["going_concern_note"];
  return {
    report,
    identityConfirmed,
    loadError: false,
    latestGoingConcernNote: typeof note === "boolean" ? note : null,
  };
}

/**
 * The audited reports of the case's own company, as the anchors the finance specialist's
 * numbers are checked against. Only a confirmed identity counts (a different company's report
 * must never overrule a number); otherwise there are no anchors and the check relies on the
 * evidence alone. `loadError` is true when the reports could not be read (never "none").
 */
export async function loadRegistryAnchors(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
): Promise<{ anchors: RegistryAnchor[]; loadError: boolean }> {
  const [{ data, error }, { data: caseRow, error: caseError }] = await Promise.all([
    service
      .from("financial_statements")
      .select(
        "cvr_number, currency, period_start, period_end, financial_statement_line_items(metric, value)",
      )
      .eq("fund_id", fundId)
      .eq("case_id", caseId),
    service
      .from("cases")
      .select("companies(cvr_number, registry_number, identity_status)")
      .eq("id", caseId)
      .eq("fund_id", fundId)
      .maybeSingle(),
  ]);
  if (caseError || error) {
    console.error(
      `[financial-input-check] registry reports unreadable (case ${caseId})`,
      caseError?.message ?? error?.message,
    );
    return { anchors: [], loadError: true };
  }
  const rawCompany = caseRow?.["companies"] as unknown;
  const company = (Array.isArray(rawCompany) ? rawCompany[0] : rawCompany) as {
    cvr_number: string | null;
    registry_number: string | null;
    identity_status: string | null;
  } | null;
  const companyNumber = company?.cvr_number ?? company?.registry_number ?? null;
  if (!companyNumber || company?.identity_status !== "confirmed") {
    return { anchors: [], loadError: false };
  }
  const anchors = (data ?? [])
    .filter((row) => row["cvr_number"] === companyNumber)
    .map((row) => {
      const items = (row["financial_statement_line_items"] ?? []) as Array<{
        metric: string;
        value: number | string;
      }>;
      const figure = (metric: string) => {
        const item = items.find((candidate) => candidate.metric === metric);
        return item === undefined ? null : Number(item.value);
      };
      return {
        periodStart: row["period_start"] as string,
        periodEnd: row["period_end"] as string,
        currency: (row["currency"] as string | null) ?? "DKK",
        revenue: figure("revenue"),
        cash: figure("cash"),
      };
    });
  return { anchors, loadError: false };
}

/** Kompakt udgave til finansspecialisten (C4). */
export async function loadCompactFinancialMetrics(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
): Promise<CompactFinancialMetrics | null> {
  const { report } = await loadFinancialMetricsReport(service, fundId, caseId);
  return report ? compactFinancialMetrics(report) : null;
}

/** Konteksten til finans-gates (C7); null-rapport giver "ukendt" for alle. */
export async function loadFinanceGateContext(
  service: SupabaseClient,
  fundId: string,
  caseId: string,
  stage: string | null,
): Promise<FinanceGateContext> {
  const { report, identityConfirmed, loadError, latestGoingConcernNote } =
    await loadFinancialMetricsReport(service, fundId, caseId);
  return {
    report,
    identityConfirmed,
    loadError,
    stage,
    latestGoingConcernNote,
    language: requestLanguage(),
  };
}

/**
 * C7: overskriv AI'ens vurdering af fondens finans-gates med kodens resultat. Regnskaberne
 * læses kun, når fonden faktisk har en finans-gate.
 */
export async function withFinanceGates<
  T extends {
    gates: Array<{
      gateKey: string;
      passed: boolean | null;
      confidence: number;
      rationale: string;
      evidenceIds: string[];
    }>;
  },
>(
  service: SupabaseClient,
  input: { fundId: string; caseId: string; stage: string | null; gateKeys: string[] },
  output: T,
  /** Allerede indlæst regnskabsgrundlag (samme som prompten fik); ellers hentes det her. */
  preloaded: FinanceGateContext | null = null,
): Promise<T> {
  if (!input.gateKeys.some(isFinanceGate)) return output;
  const context =
    preloaded ?? (await loadFinanceGateContext(service, input.fundId, input.caseId, input.stage));
  return { ...output, gates: applyFinanceGates(output.gates, context) };
}

/**
 * C8: kode-score for finansiel styrke, kun når fonden har et sådant kriterium, CVR-matchet
 * er sikkert, og regnskabet dækker mindst halvdelen af delmålene. Ellers null (den
 * nuværende metode bruges uændret).
 */
export async function loadFinanceCodeScore(
  service: SupabaseClient,
  input: { fundId: string; caseId: string; stage: string | null; hasFinanceCriterion: boolean },
  /** Allerede indlæst regnskabsgrundlag; ellers hentes det her. */
  preloaded: FinanceGateContext | null = null,
): Promise<FinancialScore | null> {
  if (!input.hasFinanceCriterion) return null;
  const { report, identityConfirmed, loadError } =
    preloaded ?? (await loadFinancialMetricsReport(service, input.fundId, input.caseId));
  if (loadError || !report || !identityConfirmed) return null;
  const score = computeFinancialScore(report, input.stage);
  return score.score === null ? null : score;
}
