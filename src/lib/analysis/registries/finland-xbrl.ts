/**
 * Finske tilinpäätökset i XBRL: PRH's åbne XBRL-API leverer de digitalt indsendte
 * regnskaber for aktieselskaber (OYTP, kpl-2016-12) som en XBRL-instans. Posterne står i en
 * datapunktmodel: ét element pr. type (`fi_met:mi53` = bogført værdi på balancen, `fi_met:md103`
 * = beløb for perioden i resultatopgørelsen), og posten selv er dimensionen `fi_dim:MCY`
 * (`fi_MC:x360` = Vastaavaa, altså aktiver i alt). Kodernes betydning står i Valtiokonttoris
 * taksonomi (SBR-DPM, tabellerne y-t04 balance og y-t05 resultatopgørelse), hentet 7. okt 2026.
 *
 * Kun fakta, hvis kontekst har MCY som eneste dimension, og hvor perioden er regnskabsåret selv
 * (ikke "Edellinen tilikausi", dimensionen REF). Resultatopgørelsens poster står også på
 * slutdatoen (en kontekst med et tidspunkt); årets start står i `di120`. Tallene læses direkte, aldrig af en AI.
 *
 * Ren fil (ingen netværk). Testet på et rigtigt regnskab fra PRH (`fixtures/fi-xbrl-*.xml`).
 */
import { load } from "cheerio";
import type { RegistryStatement } from "./types.ts";

type Sign = "as-is" | "cost";

/**
 * MCY-kode → vores regnskabspost. Omkostninger står negative i finsk XBRL (fx
 * `Liiketoiminnan muut kulut` −1.723,76); `cost` gør dem til positive omkostninger som i
 * Norge og Danmark, så nøgletallene regner ens. Skat står negativ som omkostning.
 */
const FI_MCY: Record<string, { metric: string; sign: Sign; section: "balance" | "income" }> = {
  // Balance (mi53)
  x360: { metric: "assets", sign: "as-is", section: "balance" },
  x513: { metric: "noncurrent_assets", sign: "as-is", section: "balance" },
  x435: { metric: "current_assets", sign: "as-is", section: "balance" },
  x807: { metric: "inventories", sign: "as-is", section: "balance" },
  x399: { metric: "cash", sign: "as-is", section: "balance" },
  x376: { metric: "equity", sign: "as-is", section: "balance" },
  // Aktiekapital (selskabskapital), så kapitaltab regnes rigtigt.
  x4116: { metric: "contributed_capital", sign: "as-is", section: "balance" },
  x932: { metric: "retained_earnings", sign: "as-is", section: "balance" },
  x746: { metric: "provisions", sign: "as-is", section: "balance" },
  x424: { metric: "liabilities", sign: "as-is", section: "balance" },
  x1830: { metric: "longterm_liabilities", sign: "as-is", section: "balance" },
  x1811: { metric: "shortterm_liabilities", sign: "as-is", section: "balance" },
  x481: { metric: "liabilities_and_equity", sign: "as-is", section: "balance" },
  // Resultatopgørelse (md103)
  x673: { metric: "revenue", sign: "as-is", section: "income" },
  x5: { metric: "employee_expense", sign: "cost", section: "income" },
  x448: { metric: "depreciation", sign: "cost", section: "income" },
  x689: { metric: "operating_result", sign: "as-is", section: "income" },
  x504: { metric: "finance_income", sign: "as-is", section: "income" },
  x502: { metric: "finance_expenses", sign: "cost", section: "income" },
  // Før regnskabsmæssige dispositioner og skat (Voitto ennen tilinpäätössiirtoja ja veroja).
  x738: { metric: "result_before_tax", sign: "as-is", section: "income" },
  x541: { metric: "tax_expense", sign: "cost", section: "income" },
  x740: { metric: "net_result", sign: "as-is", section: "income" },
};

/** Kort- og langfristede handelsposter lægges sammen (Myyntisaamiset, Ostovelat). */
const FI_SUMMED: Record<string, { metric: string; section: "balance" }> = {
  x1769: { metric: "trade_receivables", section: "balance" },
  x1762: { metric: "trade_receivables", section: "balance" },
  x1819: { metric: "trade_payables", section: "balance" },
  x1806: { metric: "trade_payables", section: "balance" },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Context {
  end: string;
  instant: boolean;
  /** MCY-koden, hvis den er den eneste dimension (REF = forrige år udelukker konteksten). */
  mcy: string | null;
  /** Ingen dimensioner overhovedet. */
  plain: boolean;
}

export interface ParsedFinnishStatement {
  businessId: string | null;
  statement: RegistryStatement | null;
}

function localName(name: string): string {
  return name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
}

/**
 * Ét års XBRL-instans fra PRH → regnskabet for `financialDate`. null, når instansen ikke har
 * nogen af de poster, vi kender (fx et regnskab uden resultatopgørelse og balance).
 */
export function parseFinnishXbrl(
  xml: string,
  financialDate: string,
  sourceDocumentUrl: string,
): ParsedFinnishStatement {
  const $ = load(xml, { xmlMode: true });
  const contexts = new Map<string, Context>();
  let businessId: string | null = null;

  $("*").each((_, element) => {
    if (element.type !== "tag" || localName(element.name) !== "context") return;
    const node = $(element);
    const id = node.attr("id");
    if (!id) return;
    const identifier = node
      .find("*")
      .filter((__, child) => child.type === "tag" && localName(child.name) === "identifier")
      .first()
      .text()
      .trim();
    if (identifier && !businessId) businessId = identifier;
    const text = (name: string) =>
      node
        .find("*")
        .filter((__, child) => child.type === "tag" && localName(child.name) === name)
        .first()
        .text()
        .trim();
    const instant = text("instant");
    const end = text("endDate");
    const dimensions: Array<[string, string]> = [];
    node
      .find("*")
      .filter((__, child) => child.type === "tag" && localName(child.name) === "explicitMember")
      .each((__, member) => {
        dimensions.push([
          ($(member).attr("dimension") ?? "").split(":").pop() ?? "",
          $(member).text().trim(),
        ]);
      });
    const periodEnd = instant || end;
    if (!ISO_DATE.test(periodEnd)) return;
    const mcyDimensions = dimensions.filter(([dimension]) => dimension === "MCY");
    contexts.set(id, {
      end: periodEnd,
      instant: Boolean(instant),
      mcy:
        dimensions.length === 1 && mcyDimensions.length === 1
          ? (mcyDimensions[0]![1].split(":").pop() ?? null)
          : null,
      plain: dimensions.length === 0,
    });
  });

  const units = new Map<string, string>();
  $("*").each((_, element) => {
    if (element.type !== "tag" || localName(element.name) !== "unit") return;
    const id = $(element).attr("id");
    const measure = $(element)
      .find("*")
      .filter((__, child) => child.type === "tag" && localName(child.name) === "measure")
      .first()
      .text()
      .trim();
    if (id && measure) units.set(id, measure.split(":").pop() ?? measure);
  });

  const lineItems = new Map<string, { value: number; tag: string }>();
  const summed = new Map<string, { value: number; tags: string[] }>();
  let currency: string | null = null;
  let periodStart: string | null = null;
  let employees: number | null = null;

  $("*").each((_, element) => {
    if (element.type !== "tag" || !element.name.startsWith("fi_met:")) return;
    const node = $(element);
    const context = contexts.get(node.attr("contextRef") ?? "");
    // Kun regnskabsåret selv (resultatet løber til slutdatoen, balancen står på den).
    if (!context || context.end !== financialDate) return;
    const metricName = element.name.slice("fi_met:".length);
    // Regnskabsårets start (`di120`, en dato uden dimensioner); resultatet står på slutdatoen.
    if (metricName === "di120" && context.plain) {
      const startText = node.text().trim();
      if (ISO_DATE.test(startText)) periodStart = startText;
      return;
    }
    const value = Number(node.text().trim());
    if (!Number.isFinite(value)) return;

    if (metricName === "ii52" && context.plain) {
      employees = value;
      return;
    }
    if (!context.mcy || (metricName !== "mi53" && metricName !== "md103")) return;
    const unit = units.get(node.attr("unitRef") ?? "");
    if (!unit || !/^[A-Z]{3}$/.test(unit)) return;
    const section = metricName === "mi53" ? "balance" : "income";
    const tag = `fi_MC:${context.mcy}`;

    const mapped = FI_MCY[context.mcy];
    const sum = FI_SUMMED[context.mcy];
    const chosen = mapped ?? sum;
    if (!chosen || chosen.section !== section) return;
    if (currency && currency !== unit) return;
    currency = unit;
    if (mapped) {
      // `0 - value` og ikke `-value`, så en nul ikke bliver til −0.
      const signed = mapped.sign === "cost" ? 0 - value : value;
      // Omkostninger er positive tal; et negativt resultat (en indtægt) bevares som det står.
      if (!lineItems.has(mapped.metric)) {
        lineItems.set(mapped.metric, { value: signed, tag });
      }
    } else if (sum) {
      const current = summed.get(sum.metric) ?? { value: 0, tags: [] };
      current.value += value;
      current.tags.push(context.mcy);
      summed.set(sum.metric, current);
    }
  });

  for (const [metric, { value, tags }] of summed) {
    if (!lineItems.has(metric)) {
      lineItems.set(metric, { value, tag: tags.map((code) => `fi_MC:${code}`).join("+") });
    }
  }
  if (employees !== null && !lineItems.has("average_employees")) {
    lineItems.set("average_employees", { value: employees, tag: "fi_met:ii52" });
  }

  const items = [...lineItems.entries()].map(([metric, { value, tag }]) => ({
    metric,
    value,
    tag,
  }));
  const hasBalance = items.some((item) => item.metric === "assets");
  if (!currency || (items.length < 3 && !hasBalance)) {
    return { businessId, statement: null };
  }
  return {
    businessId,
    statement: {
      periodStart: periodStart ?? financialDate,
      periodEnd: financialDate,
      currency,
      sourceDocumentUrl,
      reportingClassText: "Finsk tilinpäätös (OYTP, XBRL)",
      goingConcernNote: null,
      lineItems: items,
    },
  };
}
