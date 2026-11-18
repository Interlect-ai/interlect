/**
 * Svenske årsredovisningar i iXBRL: Bolagsverket leverer digitalt indsendte
 * regnskaber som XHTML med skjulte XBRL-tags (`ix:nonFraction`) i den svenske taksonomi
 * (`se-gen-base`, K2 og K3). Tallene læses direkte fra tags, aldrig fra en AI, med tagets
 * egen skala (`scale`), fortegn (`sign="-"`) og talformat (`ixt:numspacecomma` m.fl.).
 *
 * Ren fil (ingen netværk). Testet på Bolagsverkets officielle eksempelfiler (taxonomier.se).
 */
import { load } from "cheerio";
import type { RegistryStatement } from "./types.ts";

/** se-gen-base-tags → vores regnskabsposter. Første tag i listen vinder for samme post. */
const SE_TAGS: Array<[tag: string, metric: string]> = [
  ["Nettoomsattning", "revenue"],
  ["Personalkostnader", "employee_expense"],
  ["AvskrivningarNedskrivningarMateriellaImmateriellaAnlaggningstillgangar", "depreciation"],
  ["Rorelseresultat", "operating_result"],
  ["ResultatForeSkatt", "result_before_tax"],
  ["SkattAretsResultat", "tax_expense"],
  ["AretsResultat", "net_result"],
  ["Tillgangar", "assets"],
  ["Anlaggningstillgangar", "noncurrent_assets"],
  ["Omsattningstillgangar", "current_assets"],
  ["VarulagerMm", "inventories"],
  ["Kundfordringar", "trade_receivables"],
  ["KassaBank", "cash"],
  ["KassaBankExklRedovisningsmedel", "cash"],
  ["LikvidaMedel", "cash"],
  ["EgetKapital", "equity"],
  // Aktiekapitalen er selskabskapital (som dansk selskabskapital), så kapitaltab regnes rigtigt.
  ["Aktiekapital", "contributed_capital"],
  ["Avsattningar", "provisions"],
  ["LangfristigaSkulder", "longterm_liabilities"],
  ["KortfristigaSkulder", "shortterm_liabilities"],
  ["Leverantorsskulder", "trade_payables"],
  ["EgetKapitalSkulder", "liabilities_and_equity"],
  ["KassaflodeLopandeVerksamheten", "cash_flow_operating"],
  ["KassaflodeInvesteringsverksamheten", "cash_flow_investing"],
  ["KassaflodeFinansieringsverksamheten", "cash_flow_financing"],
  ["MedelantaletAnstallda", "average_employees"],
];

const METRIC_PRIORITY = new Map(SE_TAGS.map(([tag], index) => [tag, index]));

/**
 * "2 650 000" (numspacecomma), "12,5" (numcomma), "1,234.5" (numdotdecimal), "-" (nul). Et
 * minus eller parenteser i selve teksten ("-500", "−500", "(500)") giver et negativt tal; det
 * kombineres med tagets `sign`. Uden kendt format tæller kun hele tal, så "1,234" aldrig gættes.
 */
export function parseIxNumber(raw: string, format: string | undefined): number | null {
  let text = raw.replace(/[\s\u00a0\u202f]/g, "");
  if (!text) return null;
  const local = (format ?? "").split(":").pop() ?? "";
  if (/^(fixed-?zero|zerodash|fixedzero)$/i.test(local) || /^[-–—]$/.test(text)) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  } else if (/^[-−–]/.test(text)) {
    negative = true;
    text = text.slice(1);
  }
  let normalized: string;
  if (/numdotdecimal|numcommadot|num-dot-decimal/i.test(local)) {
    normalized = text.replace(/,/g, "");
  } else if (/numcomma|numspacecomma|numdotcomma|num-comma-decimal/i.test(local)) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = text;
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return negative ? -value : value;
}

/** "INF" er mest præcis; et tal over -3 slår et afrundet til hele tusinder; mangler den, mindst. */
function precision(decimals: string | undefined): number {
  if (decimals === "INF") return Number.POSITIVE_INFINITY;
  const value = Number(decimals);
  return decimals && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

interface Context {
  start: string | null;
  end: string;
  instant: boolean;
}

export interface ParsedSwedishReport {
  companyName: string | null;
  /** Organisationsnummeret, som regnskabet selv oplyser det, kun cifre. */
  orgNumber: string | null;
  /** "K2" eller "K3" ud fra taksonomien; null, hvis den ikke kendes. */
  framework: "K2" | "K3" | null;
  statements: RegistryStatement[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IX_NS = "http://www.xbrl.org/2013/inlineXBRL";
const XBRLI_NS = "http://www.xbrl.org/2003/instance";
const LINK_NS = "http://www.xbrl.org/2003/linkbase";
const GEN_BASE_NS = /^http:\/\/www\.taxonomier\.se\/se\/fr\/gen-base\//;
const CD_BASE_NS = /^http:\/\/www\.taxonomier\.se\/se\/fr\/cd-base\//;

/** "556999-9999" eller "16556999-9999" → "5569999999"; ellers null. */
function orgDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("16")) return digits.slice(2);
  return null;
}

/**
 * Læser en årsredovisning i iXBRL til regnskabsår, nyeste først. Præfikserne læses fra filens
 * egne navnerum. Kun fakta uden dimensioner (ingen `segment`/`scenario`) og kun for selskabets
 * eget org.nr. (kontekstens identifier), så et tal for en del af selskabet eller et andet selskab
 * aldrig står som helheden. Et år skal have mindst 5 tal eller både balance og resultat (som den
 * danske læser), så et enkelt primo-tal ikke bliver et "regnskabsår". Et tal i en ukendt enhed
 * springes over.
 */
export function parseSwedishIxbrl(xhtml: string, sourceDocumentUrl: string): ParsedSwedishReport {
  const $ = load(xhtml, { xml: true });
  const prefixes = new Map<string, string>();
  $("*").each((_, element) => {
    for (const [name, value] of Object.entries(
      (element as { attribs?: Record<string, string> }).attribs ?? {},
    )) {
      if (name.startsWith("xmlns:") && !prefixes.has(value)) prefixes.set(value, name.slice(6));
    }
  });
  const prefixFor = (namespace: string | RegExp, fallback: string) => {
    if (typeof namespace === "string") return prefixes.get(namespace) ?? fallback;
    for (const [uri, prefix] of prefixes) if (namespace.test(uri)) return prefix;
    return fallback;
  };
  const ix = prefixFor(IX_NS, "ix");
  const xbrli = prefixFor(XBRLI_NS, "xbrli");
  const link = prefixFor(LINK_NS, "link");
  const genBase = prefixFor(GEN_BASE_NS, "se-gen-base");
  const cdBase = prefixFor(CD_BASE_NS, "se-cd-base");
  const tagOf = (prefix: string, local: string) => `${prefix}\\:${local}`;

  const orgFromReport = orgDigits(
    $(`${tagOf(ix, "nonNumeric")}[name="${cdBase}:Organisationsnummer"]`)
      .first()
      .text(),
  );
  const contextIdentifiers = $(tagOf(xbrli, "identifier"))
    .map((_, element) => orgDigits($(element).text()))
    .get()
    .filter((value): value is string => Boolean(value));
  const orgNumber = orgFromReport ?? contextIdentifiers[0] ?? null;

  const contexts = new Map<string, Context>();
  $(tagOf(xbrli, "context")).each((_, element) => {
    const node = $(element);
    const id = node.attr("id");
    if (!id || node.find(`${tagOf(xbrli, "segment")}, ${tagOf(xbrli, "scenario")}`).length > 0) {
      return;
    }
    const identifier = orgDigits(node.find(tagOf(xbrli, "identifier")).first().text());
    if (orgNumber && identifier && identifier !== orgNumber) return;
    const instant = node.find(tagOf(xbrli, "instant")).first().text().trim();
    const start = node.find(tagOf(xbrli, "startDate")).first().text().trim();
    const end = node.find(tagOf(xbrli, "endDate")).first().text().trim();
    if (instant && ISO_DATE.test(instant)) {
      contexts.set(id, { start: null, end: instant, instant: true });
    } else if (end && ISO_DATE.test(end)) {
      contexts.set(id, { start: ISO_DATE.test(start) ? start : null, end, instant: false });
    }
  });
  const units = new Map<string, string>();
  $(tagOf(xbrli, "unit")).each((_, element) => {
    const id = $(element).attr("id");
    const measure = $(element).find(tagOf(xbrli, "measure")).first().text().trim();
    if (id && measure) units.set(id, measure.split(":").pop() ?? measure);
  });

  // Pr. slutdato: pr. post den mest præcise værdi (resultaträkningen før flerårsöversikten).
  type Fact = { value: number; unit: string; precision: number; priority: number; tag: string };
  const byEnd = new Map<string, Map<string, Fact>>();
  const startByEnd = new Map<string, string>();
  $(tagOf(ix, "nonFraction")).each((_, element) => {
    const node = $(element);
    const name = node.attr("name") ?? "";
    const [prefix, tag] = name.split(":");
    if (prefix !== genBase || !tag) return;
    const priority = METRIC_PRIORITY.get(tag);
    if (priority === undefined) return;
    const metric = SE_TAGS[priority]![1];
    const context = contexts.get(node.attr("contextRef") ?? "");
    if (!context) return;
    const unit = units.get(node.attr("unitRef") ?? "");
    if (!unit) return;
    const parsed = parseIxNumber(node.text(), node.attr("format"));
    if (parsed === null) return;
    const scale = Number(node.attr("scale") ?? "0");
    if (!Number.isFinite(scale)) return;
    const value = (node.attr("sign") === "-" ? -1 : 1) * parsed * 10 ** scale;
    const facts = byEnd.get(context.end) ?? new Map<string, Fact>();
    const candidate: Fact = {
      value,
      unit,
      precision: precision(node.attr("decimals")),
      priority,
      tag: `se-gen-base:${tag}`,
    };
    const existing = facts.get(metric);
    if (
      !existing ||
      candidate.priority < existing.priority ||
      (candidate.priority === existing.priority && candidate.precision > existing.precision)
    ) {
      facts.set(metric, candidate);
    }
    byEnd.set(context.end, facts);
    if (!context.instant && context.start && !startByEnd.has(context.end)) {
      startByEnd.set(context.end, context.start);
    }
  });

  const statements: RegistryStatement[] = [];
  for (const [periodEnd, facts] of byEnd) {
    const metrics = new Set(facts.keys());
    const hasBalance = ["assets", "equity", "liabilities_and_equity"].some((m) => metrics.has(m));
    const hasResult = ["net_result", "operating_result", "revenue"].some((m) => metrics.has(m));
    if (facts.size < 5 && !(hasBalance && hasResult)) continue;
    // Valutaen er den, beløbene står i (antal ansatte har sin egen enhed).
    const money = [...facts.entries()].filter(([metric]) => metric !== "average_employees");
    const currency = money[0]?.[1].unit;
    if (!currency) continue;
    statements.push({
      periodStart: startByEnd.get(periodEnd) ?? periodEnd,
      periodEnd,
      currency,
      sourceDocumentUrl,
      reportingClassText: null,
      goingConcernNote: null,
      lineItems: [...facts.entries()]
        .filter(([metric, fact]) => metric === "average_employees" || fact.unit === currency)
        .map(([metric, fact]) => ({ metric, value: fact.value, tag: fact.tag })),
    });
  }
  statements.sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));

  const schema = $(tagOf(link, "schemaRef"))
    .map((_, element) => $(element).attr("xlink:href") ?? "")
    .get()
    .join(" ");
  const framework = /\/k3\//i.test(schema) ? "K3" : /\/k2\//i.test(schema) ? "K2" : null;
  // i18n-keep: the report's own type in Swedish, stored with the statement (register data).
  const reportingClassText = framework
    ? `Svensk årsredovisning (${framework === "K2" ? "K2, mindre företag" : "K3"})`
    : "Svensk årsredovisning";
  return {
    companyName:
      $(`${tagOf(ix, "nonNumeric")}[name="${cdBase}:ForetagetsNamn"]`)
        .first()
        .text()
        .trim() || null,
    orgNumber,
    framework,
    statements: statements.map((statement) => ({ ...statement, reportingClassText })),
  };
}
