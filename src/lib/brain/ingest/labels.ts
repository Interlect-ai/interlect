import { translate, type MessageKey } from "../../i18n/translate.ts";
import { LANGUAGE_TAGS, type Language } from "../../i18n/language.ts";

/** Words and number formats for the Kilder list (Danish by default). Pure, so the page and its tests agree. */
export const DOC_TYPE_KEYS: Record<string, MessageKey> = {
  fund_report: "brainKnowledge.ingest.docType.fund_report",
  status_report: "brainKnowledge.ingest.docType.status_report",
  investment_memo: "brainKnowledge.ingest.docType.investment_memo",
  lp_letter: "brainKnowledge.ingest.docType.lp_letter",
  thesis: "brainKnowledge.ingest.docType.thesis",
  website_page: "brainKnowledge.ingest.docType.website_page",
  portfolio_list: "brainKnowledge.ingest.docType.portfolio_list",
  decision_history: "brainKnowledge.ingest.docType.decision_history",
  other: "brainKnowledge.ingest.docType.other",
};

export const KIND_KEYS: Record<string, MessageKey> = {
  pdf: "brainKnowledge.ingest.kind.pdf",
  docx: "brainKnowledge.ingest.kind.docx",
  xlsx: "brainKnowledge.ingest.kind.xlsx",
  csv: "brainKnowledge.ingest.kind.csv",
  text: "brainKnowledge.ingest.kind.text",
  website: "brainKnowledge.ingest.kind.website",
};

export const TRUST_KEYS: Record<string, MessageKey> = {
  customer_doc: "brainKnowledge.ingest.trust.customer_doc",
  company_claim: "brainKnowledge.ingest.trust.company_claim",
  public_web: "brainKnowledge.ingest.trust.public_web",
};

const labelsIn = (keys: Record<string, MessageKey>, language: Language) =>
  Object.fromEntries(
    Object.entries(keys).map(([key, message]) => [key, translate(language, message)]),
  );

/** The label for a key in a language, or undefined for a key it does not know. */
export const docTypeLabel = (type: string, language: Language = "da"): string | undefined =>
  DOC_TYPE_KEYS[type] ? translate(language, DOC_TYPE_KEYS[type]) : undefined;
export const kindLabel = (kind: string, language: Language = "da"): string | undefined =>
  KIND_KEYS[kind] ? translate(language, KIND_KEYS[kind]) : undefined;
export const trustLabel = (tier: string, language: Language = "da"): string | undefined =>
  TRUST_KEYS[tier] ? translate(language, TRUST_KEYS[tier]) : undefined;

/** The Danish words (kept for callers that do not know the language). */
export const DOC_TYPE_LABELS: Record<string, string> = labelsIn(DOC_TYPE_KEYS, "da");
export const KIND_LABELS: Record<string, string> = labelsIn(KIND_KEYS, "da");
export const TRUST_LABELS: Record<string, string> = labelsIn(TRUST_KEYS, "da");

const decimals = (value: number, digits: number, language: Language) =>
  new Intl.NumberFormat(LANGUAGE_TAGS[language], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);

export function formatBytes(bytes: number | null, language: Language = "da"): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${decimals(kb, kb < 10 ? 1 : 0, language)} kB`;
  return `${decimals(kb / 1024, 1, language)} MB`;
}

/** "0,70 kr." with a decimal comma; under 5 øre it reads "under 0,05 kr.". */
export function formatKroner(value: number, language: Language = "da"): string {
  if (value > 0 && value < 0.05) return translate(language, "brainKnowledge.ingest.underKroner");
  return translate(language, "brainKnowledge.ingest.kroner", {
    amount: decimals(value, 2, language),
  });
}

export function formatPeriod(
  start: string | null,
  end: string | null,
  language: Language = "da",
): string | null {
  if (!start && !end) return null;
  const separator = language === "da" ? "." : "/";
  const short = (iso: string) => iso.slice(0, 10).split("-").reverse().join(separator);
  if (start && end) return `${short(start)} – ${short(end)}`;
  return short((start ?? end)!);
}
