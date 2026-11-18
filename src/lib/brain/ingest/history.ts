/**
 * Historiske beslutninger: turns the rows of a CSV/Excel file into decisions, in
 * code and without AI. Column guesses, decision words, dates (also Danish), CVR and domain,
 * deterministic entity keys, row hashes (so a repeated import gives no duplicates) and a match of
 * the free-text reason to the fund's own reason codes. A row that cannot be used is reported with
 * its row number, never guessed.
 */
import { createHash } from "node:crypto";
import { normalizeEntityName } from "../keys.ts";
import { serverText } from "../../i18n/server-text.ts";

export type HistoryMovement = "reject" | "decline_ic" | "invest" | "hold";

export const MAX_HISTORY_ROWS = 5_000;

export interface HistoryMapping {
  /** Zero-based column indexes; null = the file has no such column. */
  company: number | null;
  domain: number | null;
  cvr: number | null;
  date: number | null;
  decision: number | null;
  reason: number | null;
  amount: number | null;
}

export const MAPPING_FIELDS = [
  "company",
  "domain",
  "cvr",
  "date",
  "decision",
  "reason",
  "amount",
] as const;

const HEADER_WORDS: Record<(typeof MAPPING_FIELDS)[number], RegExp> = {
  company: /^(selskab|virksomhed|firma|company|navn|name|startup|target|case)\b/i,
  domain: /(dom[æa]ne|domain|website|hjemmeside|url|web)/i,
  cvr: /(cvr|org\.?\s?nr|organisationsnummer|registration)/i,
  date: /(dato|date|beslutningsdato|decided|m[øo]de|meeting|^(?:[åa]r|year)$)/i,
  decision: /(beslutning(?!sdato)|decision|udfald|outcome|status|resultat|result|afg[øo]relse)/i,
  reason: /([åa]rsag|begrundelse|reason|kommentar|comment|note|why|hvorfor)/i,
  amount: /(bel[øo]b|amount|ticket|investering|investment|dkk|kr\b|eur|size)/i,
};

/** The first column whose header fits each field, used only once. Never a guess without a match. */
export function suggestMapping(headers: readonly string[]): HistoryMapping {
  const used = new Set<number>();
  const mapping: HistoryMapping = {
    company: null,
    domain: null,
    cvr: null,
    date: null,
    decision: null,
    reason: null,
    amount: null,
  };
  // The more specific fields first, so "Selskabets domæne" is not taken as the company name.
  const order: Array<(typeof MAPPING_FIELDS)[number]> = [
    "cvr",
    "domain",
    "date",
    "decision",
    "reason",
    "amount",
    "company",
  ];
  for (const field of order) {
    const index = headers.findIndex(
      (header, i) => !used.has(i) && HEADER_WORDS[field].test(header.trim()),
    );
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

export function validMapping(mapping: HistoryMapping, columns: number): string | null {
  if (mapping.company === null) return serverText("brainServer.history.chooseCompany");
  if (mapping.decision === null) return serverText("brainServer.history.chooseDecision");
  const seen = new Set<number>();
  for (const field of MAPPING_FIELDS) {
    const index = mapping[field];
    if (index === null) continue;
    if (!Number.isInteger(index) || index < 0 || index >= columns)
      return serverText("brainServer.history.columnMissing");
    if (seen.has(index)) return serverText("brainServer.history.columnTwice");
    seen.add(index);
  }
  return null;
}

/** Decision words (Danish and English). Committee rejections are checked first. */
export function parseDecision(text: string): HistoryMovement | null {
  const value = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,;:!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return null;
  const committee = /\b(komit[ée]|committee|ic)\b/.test(value);
  const negative =
    /\b(nej|afvist|afvis|declin\w*|reject\w*|pass|passed|kasser\w*|ikke|fravalgt|no)\b/.test(value);
  if (committee && negative) return "decline_ic";
  if (
    /\b(invester\w*|investeret|invested|invest|portef[øo]lje|portfolio|closed won)\b/.test(value) &&
    !negative
  )
    return "invest";
  if (
    !negative &&
    /\b(hold|p[åa] hold|pause\w*|parker\w*|on hold|watch|f[øo]lg\w*|later|senere)\b/.test(value)
  )
    return "hold";
  if (negative || /\b(stop\w*|lukket|luk|lost|drop\w*)\b/.test(value)) return "reject";
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  januar: 1,
  january: 1,
  feb: 2,
  februar: 2,
  february: 2,
  mar: 3,
  marts: 3,
  march: 3,
  apr: 4,
  april: 4,
  maj: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function realDate(year: number, month: number, day: number): string | null {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    return null;
  return d.toISOString().slice(0, 10);
}

/** ISO, 31-12-2025, 31/12/2025, 31.12.2025, "31. december 2025". Anything else is null (never guessed). */
export function parseHistoryDate(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  if (/^\d{5}$/.test(value)) {
    const serial = Number(value);
    if (serial >= 25_569 && serial <= 73_050)
      return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
    return null;
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(value);
  if (m) return realDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (m) return realDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})\.?\s+([a-zæøå]+)\.?\s+(\d{4})$/i.exec(value);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    return month ? realDate(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

export function normalizeCvr(text: string): string | null {
  const digits = text.replace(/^dk/i, "").replace(/[\s-]/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
}

export function normalizeDomain(text: string): string | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!
    .replace(/:\d+$/, "");
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(value) ? value : null;
}

export function parseAmountDkk(text: string): number | null {
  const cleaned = text.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  // Danish "1.500.000,50" or English "1,500,000.50": the last separator is the decimal one.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalAt = Math.max(lastComma, lastDot);
  const digitsAfter = decimalAt >= 0 ? cleaned.length - decimalAt - 1 : 0;
  const normalized =
    decimalAt >= 0 && digitsAfter <= 2
      ? cleaned.slice(0, decimalAt).replace(/[.,]/g, "") + "." + cleaned.slice(decimalAt + 1)
      : cleaned.replace(/[.,]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export interface HistoryReasonCode {
  code: string;
  label: string;
}

/** Codes that the reason text names exactly (by code or label), split on ; , / and "og". */
export function matchReasonCodes(text: string, codes: readonly HistoryReasonCode[]): string[] {
  const found: string[] = [];
  for (const part of text.split(/[;,/\n]|\bog\b|\band\b/i)) {
    const value = part.trim().toLowerCase();
    if (!value) continue;
    const hit = codes.find(
      (c) => c.code.toLowerCase() === value || c.label.toLowerCase() === value,
    );
    if (hit && !found.includes(hit.code)) found.push(hit.code);
  }
  return found;
}

export interface HistoryRow {
  companyName: string;
  companyDomain: string | null;
  companyCvr: string | null;
  entityKey: string;
  decidedOn: string | null;
  movementKind: HistoryMovement;
  reasonCodes: string[];
  reasonText: string | null;
  amountDkk: number | null;
  rowHash: string;
}

export interface HistoryProblem {
  /** The row number in the file (the header is row 1). */
  row: number;
  message: string;
}

export interface HistoryBuild {
  rows: HistoryRow[];
  problems: HistoryProblem[];
  /** How often each decision word was read as each kind, for the user's check. */
  decisionWords: Array<{ word: string; kind: HistoryMovement | null; count: number }>;
  /** Distinct free-text reasons that no reason code matched exactly. */
  unmatchedReasons: Array<{ text: string; count: number }>;
}

function cell(row: readonly string[], index: number | null): string {
  return index === null ? "" : (row[index] ?? "").trim();
}

export function rowHash(parts: {
  companyName: string;
  decidedOn: string | null;
  movementKind: string;
  reasonText: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        (normalizeEntityName(parts.companyName) ?? parts.companyName).toLowerCase(),
        parts.decidedOn,
        parts.movementKind,
        (parts.reasonText ?? "").toLowerCase(),
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * Portfolio companies found on the fund's own website, after an Admin has confirmed them,
 * as "invest" decisions (no date, keyed on the domain). The reason names the domain, so two
 * companies with the same name are two rows, and confirming the same company again is no duplicate.
 */
export function portfolioRows(
  companies: ReadonlyArray<{ name: string; domain: string }>,
): HistoryRow[] {
  return companies.flatMap((company) => {
    const domain = normalizeDomain(company.domain);
    const companyName = company.name.trim().slice(0, 300);
    if (!domain || !companyName) return [];
    // i18n-keep: stored as the decision's reason. The row hash keeps the wording from before
    // So a company confirmed again still matches its earlier row and is no duplicate.
    const reasonText = `Porteføljeselskab ifølge teamets hjemmeside (${domain}).`;
    // i18n-keep: never shown; only hashed, as the rows confirmed were.
    const hashedReasonText = `Porteføljeselskab ifølge fondens hjemmeside (${domain}).`;
    return [
      {
        companyName,
        companyDomain: domain,
        companyCvr: null,
        entityKey: `domain:${domain}`,
        decidedOn: null,
        movementKind: "invest" as const,
        reasonCodes: [],
        reasonText,
        amountDkk: null,
        rowHash: rowHash({
          companyName,
          decidedOn: null,
          movementKind: "invest",
          reasonText: hashedReasonText,
        }),
      },
    ];
  });
}

/**
 * The file's rows as decisions. `reasonMap` is the user's confirmed mapping from a distinct
 * reason text (lower case) to codes; an exact match to a code or label is used when there is none.
 */
export function buildHistory(
  table: ReadonlyArray<readonly string[]>,
  mapping: HistoryMapping,
  codes: readonly HistoryReasonCode[],
  reasonMap: Readonly<Record<string, readonly string[]>> = {},
): HistoryBuild {
  const known = new Set(codes.map((c) => c.code));
  const rows: HistoryRow[] = [];
  const problems: HistoryProblem[] = [];
  const words = new Map<string, { kind: HistoryMovement | null; count: number }>();
  const unmatched = new Map<string, number>();
  const seen = new Set<string>();

  table.forEach((raw, offset) => {
    const rowNumber = offset + 2;
    if (raw.every((c) => !c.trim())) return;
    const name = cell(raw, mapping.company);
    if (!name) {
      problems.push({ row: rowNumber, message: serverText("brainServer.history.companyMissing") });
      return;
    }
    const decisionWord = cell(raw, mapping.decision);
    const kind = parseDecision(decisionWord);
    const wordKey = decisionWord.toLowerCase();
    const entry = words.get(wordKey) ?? { kind, count: 0 };
    entry.count += 1;
    words.set(wordKey, entry);
    if (!kind) {
      problems.push({
        row: rowNumber,
        message: decisionWord
          ? serverText("brainServer.history.decisionUnreadable", { decision: decisionWord })
          : serverText("brainServer.history.decisionMissing"),
      });
      return;
    }
    const dateText = cell(raw, mapping.date);
    const decidedOn = dateText ? parseHistoryDate(dateText) : null;
    if (dateText && !decidedOn) {
      problems.push({
        row: rowNumber,
        message: serverText("brainServer.history.dateUnreadable", { date: dateText }),
      });
      return;
    }
    const cvrText = cell(raw, mapping.cvr);
    const cvr = cvrText ? normalizeCvr(cvrText) : null;
    const domainText = cell(raw, mapping.domain);
    const domain = domainText ? normalizeDomain(domainText) : null;
    const normalizedName = normalizeEntityName(name);
    const entityKey = cvr
      ? `cvr:${cvr}`
      : domain
        ? `domain:${domain}`
        : normalizedName
          ? `name:${normalizedName}`
          : null;
    if (!entityKey) {
      problems.push({ row: rowNumber, message: serverText("brainServer.history.companyUnusable") });
      return;
    }
    const reasonText = cell(raw, mapping.reason) || null;
    let reasonCodes: string[] = [];
    if (reasonText) {
      const confirmed = reasonMap[reasonText.toLowerCase()];
      reasonCodes = (confirmed ?? matchReasonCodes(reasonText, codes)).filter((c) => known.has(c));
      if (!confirmed && reasonCodes.length === 0) {
        const key = reasonText.toLowerCase();
        unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
      }
    }
    const amountText = cell(raw, mapping.amount);
    const hash = rowHash({ companyName: name, decidedOn, movementKind: kind, reasonText });
    if (seen.has(hash)) {
      problems.push({ row: rowNumber, message: serverText("brainServer.history.duplicateRow") });
      return;
    }
    seen.add(hash);
    rows.push({
      companyName: name.slice(0, 300),
      companyDomain: domain,
      companyCvr: cvr,
      entityKey,
      decidedOn,
      movementKind: kind,
      reasonCodes,
      reasonText: reasonText ? reasonText.slice(0, 2000) : null,
      amountDkk: amountText ? parseAmountDkk(amountText) : null,
      rowHash: hash,
    });
  });

  return {
    rows,
    problems,
    decisionWords: [...words].map(([word, v]) => ({ word, kind: v.kind, count: v.count })),
    unmatchedReasons: [...unmatched].map(([text, count]) => ({ text, count })),
  };
}
