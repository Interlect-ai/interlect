/**
 * Masking of personal data before text is sent to an AI model (decision log 4 Oct 2026: data minimisation
 * under GDPR). One control point: routes every model call
 * (prompts, embeddings, search queries, Brain loops, chat, ingest) through a Redactor.
 *
 * Always masked: e-mail addresses (also "navn (at) firma.dk"), phone numbers (Danish and
 * international), CPR numbers (with and without hyphen), bank accounts, IBAN and card numbers,
 * street addresses (the postcode and city stay, so geography survives) and private persons from
 * the fund's own data (see redact-dictionary.ts), plus a name written right next to a CPR number.
 * Kept, because the analysis needs them: the company's name, domain and CVR, founders,
 * management and board, and investors that are companies or funds (`keep`).
 *
 * Deterministic only: a dictionary, regular expressions and validation rules (date check on CPR,
 * mod-97 on IBAN, Luhn on cards). No model guesses. Placeholders are consistent within one call
 * (`[Person 1]`, `[E-mail 1]`), so the model can still reason about who is who. The mapping lives
 * only in this object, in memory, for the length of the call; it is never sent or stored.
 * `restore` turns placeholders in the model's answer back into the real values on the server,
 * before anything is saved or shown.
 *
 * Known limits: an 8-digit number without a label or grouping ("12345678") is left alone, since
 * it cannot be told apart from a CVR number, unless it stands close to a private person or an
 * e-mail on the same line (then it is their phone); so is a grouped number right after a
 * figure word ("Bruttomargin 25 30 35 40"); a private person who is in neither the dictionary nor next to a
 * CPR number is not found (no guessing); bytes (images, PDF files) are refused by redactJson, not
 * masked; a streamed answer must be restored once it is complete, since a placeholder can be
 * split across chunks.
 */

export type RedactionKind =
  "person" | "email" | "phone" | "cpr" | "account" | "iban" | "card" | "address";

export interface RedactionPerson {
  name: string;
  aliases?: readonly string[];
}

export interface RedactionDictionary {
  /** Private persons: masked wherever they are named (full name, aliases, a lone first name). */
  mask: readonly RedactionPerson[];
  /** Founders, management, board, the company and investor firms: never masked as a person. */
  keep: readonly string[];
}

export interface Redactor {
  /** Masks one text. Use `redactAll`/`redactJson` for a whole payload (see below). */
  redact(text: string): string;
  /**
   * Masks every text of one payload. A name found next to a CPR number in one text is then also
   * masked in the texts before it, which `redact` called one text at a time cannot do.
   */
  redactAll(texts: readonly string[]): string[];
  /** Masks every string value in plain objects and arrays (keys and other values are kept). */
  redactJson<T>(value: T): T;
  /** Turns this call's placeholders back into the real values. Unknown placeholders stay. */
  restore(text: string): string;
  restoreJson<T>(value: T): T;
  /** Distinct values masked per kind in this call, for the AI log. Never the values. */
  counts(): Record<RedactionKind, number>;
}

/** For the system prompt of a masked call, so the model keeps the placeholders intact. */
export const REDACTION_INSTRUCTION =
  "Personoplysninger i teksten er erstattet af pladsholdere som [Person 1], [E-mail 1] og [Telefon 1]. Skriv pladsholderne præcis, som de står, når du henviser til dem, og gæt aldrig, hvad der står bag dem.";

const LABELS: Record<RedactionKind, string> = {
  person: "Person",
  email: "E-mail",
  phone: "Telefon",
  cpr: "CPR",
  account: "Konto",
  iban: "IBAN",
  card: "Kort",
  address: "Adresse",
};

const PLACEHOLDER =
  /\[(Person|E-mail|Email|Telefon|CPR|Konto|IBAN|Kort|Adresse)[ \u00a0]+(\d{1,6})\]/giu;

/** A fresh copy of the placeholder pattern, for code that must find placeholders in an answer. */
export function placeholderPattern(): RegExp {
  return new RegExp(PLACEHOLDER.source, PLACEHOLDER.flags);
}

/** Overlapping finds: the longest wins, then the most specific kind. */
const PRIORITY: Record<RedactionKind, number> = {
  iban: 7,
  card: 6,
  account: 5,
  cpr: 4,
  email: 3,
  phone: 2,
  address: 1,
  person: 0,
};

interface Span {
  start: number;
  end: number;
  kind: RedactionKind;
  /** Identity of the value within the call (normalised), so repeats share one placeholder. */
  key: string;
  /** What `restore` puts back. */
  restore: string;
}

// ---------------------------------------------------------------------------------------------
// Structured values. Separators are bounded ({0,n}), never runs of \s*, so a long run of spaces
// (PDF layout text) cannot make a pattern backtrack for seconds.
// ---------------------------------------------------------------------------------------------

const EMAIL_LOCAL = "[\\p{L}\\p{N}._%+-]+";
const DOMAIN_LABEL = "[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?";
const AT_BRACKET = "[\\(\\[\\{<] ?(?:at|snabel-?a) ?[\\)\\]\\}>]";
const DOT_BRACKET = "[\\(\\[\\{<] ?(?:dot|punktum) ?[\\)\\]\\}>]";
// A plain dot only without spaces: "firma.dk. Anna" must end at "dk".
const DOT_ANY = `(?:\\.| ?${DOT_BRACKET} ?| (?:dot|punktum) )`;
const DOT_WORD = `(?: ?${DOT_BRACKET} ?| (?:dot|punktum) )`;
const EMAIL_START = "(?<![\\p{L}\\p{N}._%+-])";
const EMAIL_END = "\\p{L}{2,24}(?![\\p{L}\\p{N}])";

const EMAIL_PATTERNS = [
  new RegExp(
    `${EMAIL_START}${EMAIL_LOCAL} ?@ ?${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})*\\.${EMAIL_END}`,
    "gu",
  ),
  // "line (at) firma.dk", "line [at] firma [dot] dk", "line (snabel-a) firma.dk"
  new RegExp(
    `${EMAIL_START}${EMAIL_LOCAL} ?${AT_BRACKET} ?${DOMAIN_LABEL}(?:${DOT_ANY}${DOMAIN_LABEL})*${DOT_ANY}${EMAIL_END}`,
    "giu",
  ),
  // "line at firma dot dk": a bare "at" only counts with a spelled-out dot ("at" is Danish).
  new RegExp(
    `${EMAIL_START}${EMAIL_LOCAL} (?:at|snabel-?a) ${DOMAIN_LABEL}(?:${DOT_WORD}${DOMAIN_LABEL})*${DOT_WORD}${EMAIL_END}`,
    "giu",
  ),
];

function emailKey(surface: string): string {
  return surface
    .toLowerCase()
    .replace(/ ?[([{<] ?(?:at|snabel-?a) ?[)\]}>] ?| (?:at|snabel-?a) | ?@ ?/u, "@")
    .replace(/ ?[([{<] ?(?:dot|punktum) ?[)\]}>] ?| (?:dot|punktum) /gu, ".");
}

const PHONE_SEP = "[ \\u00a0.\\-]";
const INTL_SEP = "[ \\u00a0\\-]";
const DK_PREFIX = "(?:\\(\\+?45\\)|(?:\\+|00)45)";
const DK_START = /^(?:\(\+?45\)|(?:\+|00)45)/u;
// +45/0045 takes exactly the 8 national digits; other countries take up to 15 digits in all.
const PHONE_DK_PREFIXED = `${DK_PREFIX}${INTL_SEP}?(?:\\d{2}(?:${PHONE_SEP}?\\d{2}){3}|\\d{4}${PHONE_SEP}?\\d{4})(?!\\d)`;
const PHONE_INTL = `(?:\\+|00)\\d{1,3}(?:${INTL_SEP}?\\(\\d{1,4}\\))?(?:${INTL_SEP}?\\d{1,5}){1,5}(?!\\d)`;
const PHONE_DK_ANY = `(?:\\d{2}(?:${PHONE_SEP}?\\d{2}){3}|\\d{4}${PHONE_SEP}?\\d{4})(?!\\d)`;
const PHONE_LABEL =
  "(?:tlf|telefon(?:nummer|nr)?|mobiltelefon|mobil(?:nummer|nr)?|mob|telephone|phone(?: number)?|tel|cell(?:phone)?|mobile(?: phone)?|direkte|fax|[mt](?= ?:))";

const PHONE_PREFIXED = new RegExp(
  `(?<![\\p{L}\\p{N}+.,])(?:${PHONE_DK_PREFIXED}|${PHONE_INTL})`,
  "gu",
);
const PHONE_LABELLED = new RegExp(
  `(?<!\\p{L})${PHONE_LABEL}[ \\u00a0.:]{0,4}(?:(?:nr|no|nummer)[ \\u00a0.:]{0,4})?(${PHONE_DK_PREFIXED}|${PHONE_INTL}|${PHONE_DK_ANY})`,
  "dgiu",
);
// Without a label or prefix only a grouped Danish number counts (2-2-2-2 with one kind of
// separator, or 4-4 with a space), never as part of a longer row of numbers, not two years
// ("2023 2024") and not right after a figure word ("Bruttomargin 25 30 35 40", "(t.kr.) 3500
// 4200"). "2500-5000" is a range, not a phone number.
const PHONE_GROUPED = new RegExp(
  `(?<!\\p{N}[ \\u00a0.,\\-]?)(?<!\\+)(?:[2-9]\\d([ \\u00a0.\\-])\\d{2}\\1\\d{2}\\1\\d{2}|[2-9]\\d{3}[ \\u00a0]\\d{4})(?![ \\u00a0.,\\-]?\\p{N})`,
  "gu",
);
// A figure word shortly before in the same sentence: "Bruttomargin 25 30 35 40", "(t.kr.) 25 …".
const ABBREVIATION_DOT = "(?:\\.(?!\\s*\\p{Lu}))?"; // "t.kr.)" yes, "80 mio. kr. Kontakt" no
const FIGURES_BEFORE = new RegExp(
  `(?:%|\\bkr\\b|t\\.\\s?kr|\\bmio\\b|\\bmia\\b|\\bdkk\\b|\\beur\\b|\\busd\\b|\\bpct\\b|margin|omsætning|vækst|ebitda|resultat|budget|kvartal|\\bq[1-4]\\b)${ABBREVIATION_DOT}[^.!?\\n]{0,25}$`,
  "iu",
);

const AFTER_AMOUNT =
  /^\s{0,3}(?:kr\b|dkk|eur|usd|sek|nok|gbp|chf|%|pct|procent|mio|mia|t\.?\s?kr|stk|aktier|anparter)/iu;
// "CVR 12 34 56 78", "SE-nr. 1234 5678", "P-nr. 1012345678": public company numbers. "SE" and
// "P" need the "nr", or "Se 22 33 44 55" ("see") would hide a phone number.
const BEFORE_REGISTRY_ID =
  /(?<!\p{L})(?:cvr[\s.-]{0,3}(?:nr|nummer|no)?|(?:se|p)[\s.-]{0,3}(?:nr|nummer|no))[\s.:]{0,4}$/iu;
const YEAR = /^(?:19|20)\d{2}$/u;

function digits(value: string): string {
  return value.replace(/\D/gu, "");
}

function phoneKey(surface: string): string {
  let d = digits(surface);
  if (surface.trim().startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("45") && DK_START.test(surface.trim())) d = d.slice(2);
  return d;
}

function findPhones(text: string, out: Span[]): void {
  const add = (start: number, end: number) => {
    const surface = text.slice(start, end);
    const count = digits(surface).length;
    if (count < 8 || count > 15) return;
    if (AFTER_AMOUNT.test(text.slice(end, end + 12))) return;
    if (BEFORE_REGISTRY_ID.test(text.slice(Math.max(0, start - 16), start))) return;
    const groups = surface.trim().split(/[ \u00a0.-]+/u);
    if (groups.length === 2 && groups.every((g) => YEAR.test(g))) return;
    if (/^(?:\+|00)/u.test(surface) && !DK_START.test(surface)) {
      // Another country: a real number has 10 digits or more, and "+12 345 678" is an amount.
      if (count < 10 || groups.slice(1).every((g) => /^\d{3}$/u.test(g))) return;
    }
    out.push({ start, end, kind: "phone", key: `phone:${phoneKey(surface)}`, restore: surface });
  };
  for (const m of text.matchAll(PHONE_PREFIXED)) add(m.index, m.index + m[0].length);
  for (const m of text.matchAll(PHONE_LABELLED)) {
    const at = m.indices?.[1];
    if (at) add(at[0], at[1]);
  }
  for (const m of text.matchAll(PHONE_GROUPED)) {
    if (FIGURES_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
    add(m.index, m.index + m[0].length);
  }
}

// A bare 8-digit number ("22334455") looks like a CVR number, so alone it is left. On
// the same line as a private person or an e-mail, close by and with no company word or CVR label
// in between, it is that person's phone number ("Line Hansen, line@firma.dk, 22334455"). Danish
// phone numbers never start with 0 or 1.
const BARE_EIGHT = /(?<![\p{L}\p{N}+.,\-/])[2-9]\d{7}(?![\p{L}\p{N}]|[.,\-/]\p{N})/gu;
const CONTACT_REACH = 60;

/** Not a phone: an amount, a figure, or a number behind a CVR/SE/P label. */
function isFigureOrRegistry(text: string, start: number, end: number): boolean {
  return (
    AFTER_AMOUNT.test(text.slice(end, end + 12)) ||
    BEFORE_REGISTRY_ID.test(text.slice(Math.max(0, start - 16), start)) ||
    FIGURES_BEFORE.test(text.slice(Math.max(0, start - 40), start))
  );
}

/** Spans sorted by start, read in order: one pass over a text, never numbers × spans. */
class SpanCursor {
  private readonly spans: Span[];
  private at = 0;

  constructor(spans: readonly Span[]) {
    this.spans = [...spans].sort((a, b) => a.start - b.start);
  }

  /** Spans that end at or after `from` and start at or before `to` (calls in rising `from`). */
  *near(from: number, to: number): Generator<Span> {
    while (this.at < this.spans.length && (this.spans[this.at]?.end ?? 0) < from) {
      this.at += 1;
    }
    for (let i = this.at; i < this.spans.length; i += 1) {
      const span = this.spans[i];
      if (!span || span.start > to) return;
      if (span.end >= from) yield span;
    }
  }
}

function overlapsAny(cursor: SpanCursor, start: number, end: number): boolean {
  for (const span of cursor.near(start, end)) if (span.start < end && span.end > start) return true;
  return false;
}

/** Bare 8-digit numbers in `text` that sit next to a person or an e-mail span (`contacts`). */
function contactNumbers(text: string, contacts: readonly Span[], taken: readonly Span[]): string[] {
  const found: string[] = [];
  if (contacts.length === 0) return found;
  const near = new SpanCursor(contacts);
  const blocked = new SpanCursor(taken);
  for (const m of text.matchAll(BARE_EIGHT)) {
    const start = m.index;
    const end = start + m[0].length;
    if (overlapsAny(blocked, start, end) || isFigureOrRegistry(text, start, end)) continue;
    for (const c of near.near(start - CONTACT_REACH, end + CONTACT_REACH)) {
      if (c.start < end && c.end > start) continue;
      const gap = c.end <= start ? text.slice(c.end, start) : text.slice(end, c.start);
      // "Nordlys ApS, 31415926": a company word before punctuation counts too.
      const words = gap.replace(/[,.;:()|]/gu, " ");
      if (
        gap.length <= CONTACT_REACH &&
        !gap.includes("\n") &&
        !COMPANY_WORDS.test(words) &&
        !/cvr/iu.test(gap)
      ) {
        found.push(m[0]);
        break;
      }
    }
  }
  return found;
}

// 010190-1234, 0101901234, 010190 1234, 010190 - 1234, 010190 \u2013 1234, 010190-⏎1234
const CPR = new RegExp(
  "(?<!\\p{N})(0[1-9]|[12]\\d|3[01])(0[1-9]|1[0-2])(\\d{2})(?:[ \\u00a0]?[-\\u2010-\\u2015\\u2212][ \\u00a0\\n]?|[ \\u00a0])?(\\d{4})(?!\\p{N})",
  "gu",
);
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function findCprs(text: string, out: Span[]): void {
  for (const m of text.matchAll(CPR)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day > (DAYS_IN_MONTH[month - 1] ?? 0)) continue;
    if (BEFORE_REGISTRY_ID.test(text.slice(Math.max(0, m.index - 16), m.index))) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: "cpr",
      key: `cpr:${digits(m[0])}`,
      restore: m[0],
    });
  }
}

const ACCOUNT_SEP = "[\\s.:\\-]{0,6}";
const KONTO_LABEL = `(?:bank)?(?:konto|kto|account)${ACCOUNT_SEP}(?:nr|nummer|no|number)?${ACCOUNT_SEP}`;
const REG_LABEL = `reg(?:istrerings)?${ACCOUNT_SEP}(?:nr|nummer)?${ACCOUNT_SEP}(?:\\/${ACCOUNT_SEP}${KONTO_LABEL})?`;
// "Reg.nr. 1234 kontonr. 1234567890", "Reg.nr./kontonr.: 1234/1234567890", "Bankkonto: 1234 …"
const ACCOUNT_LABELLED = new RegExp(
  `(?<!\\p{L})(?:${REG_LABEL}(\\d{4})[\\s,/;]{0,4}(?:og\\s{1,3})?(?:${KONTO_LABEL})?(\\d{6,10})|${KONTO_LABEL}((?:\\d{4}[ \\-/])?\\d{6,10}))(?!\\p{N})`,
  "dgiu",
);
const ACCOUNT_BARE = /(?<![\p{N}-])\d{4}-\d{6,10}(?![\p{N}-])/gu;

function findAccounts(text: string, out: Span[]): void {
  const add = (start: number, end: number) => {
    const surface = text.slice(start, end);
    out.push({ start, end, kind: "account", key: `account:${digits(surface)}`, restore: surface });
  };
  for (const m of text.matchAll(ACCOUNT_LABELLED)) {
    const reg = m.indices?.[1];
    const account = m.indices?.[2];
    const single = m.indices?.[3];
    if (reg && account) add(reg[0], account[1]);
    else if (single) add(single[0], single[1]);
  }
  for (const m of text.matchAll(ACCOUNT_BARE)) add(m.index, m.index + m[0].length);
}

const IBAN =
  /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?:[ \u00a0]?[A-Z0-9]{4}){2,7}(?:[ \u00a0]?[A-Z0-9]{1,4})?(?![\p{L}\p{N}])/gu;

export function isValidIban(value: string): boolean {
  const compact = value.replace(/[ \u00a0]/gu, "");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

function findIbans(text: string, out: Span[]): void {
  for (const m of text.matchAll(IBAN)) {
    // A trailing word can be swallowed as a last group; drop groups until the checksum holds.
    let surface = m[0];
    while (!isValidIban(surface) && /[ \u00a0]/u.test(surface)) {
      surface = surface.replace(/[ \u00a0][A-Z0-9]*$/u, "");
    }
    if (!isValidIban(surface)) continue;
    out.push({
      start: m.index,
      end: m.index + surface.length,
      kind: "iban",
      key: `iban:${surface.replace(/[ \u00a0]/gu, "")}`,
      restore: surface,
    });
  }
}

const CARD =
  /(?<!\p{N})(?:\d{4}([ \u00a0-])\d{4}\1\d{4}\1\d{1,7}|\d{4}([ \u00a0-])\d{6}\2\d{5}|\d{13,19})(?!\p{N})/gu;

export function isLuhnValid(value: string): boolean {
  const d = digits(value);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i += 1) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

function findCards(text: string, out: Span[]): void {
  for (const m of text.matchAll(CARD)) {
    const groups = m[0].split(/[ \u00a0-]/u);
    if (groups.length > 1 && groups.every((g) => YEAR.test(g))) continue;
    if (!isLuhnValid(m[0])) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: "card",
      key: `card:${digits(m[0])}`,
      restore: m[0],
    });
  }
}

// Danish street names: a capitalised compound ending in a street word ("Vesterbrogade",
// "Strandvejen") or a separate street word after a name ("Niels Juels Gade", "H.C. Andersens
// Boulevard"), then a house number and maybe a floor, all on one line. The postcode and city are
// left alone.
const STREET_END =
  "(?:vej|vejen|gade|gaden|gyde|gyden|allé|alle|alléen|boulevard|boulevarden|stræde|strædet|torv|torvet|plads|pladsen|vænge|vænget|park|parken|bakke|bakken|have|haven|toft|toften|sti|stien|kaj|kajen|vang|vangen|høj|højen|lund|lunden|holmen|engen|marken|hegn|krog|krogen|gård|gården|dal|dalen|skov|skoven|strand|stranden|bro|broen|brygge|bryggen|løkke|løkken)";
const STREET_WORD = "(?:Vej|Gade|Allé|Alle|Boulevard|Plads|Torv|Stræde|Vænge|Kaj|Kanal|Brygge)";
const STREET_PREFIX = "(?:(?:\\p{Lu}\\.){1,3}[ \\u00a0]?|\\p{Lu}[\\p{Ll}\\p{M}]+[ \\u00a0])";
const ADDRESS = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${STREET_PREFIX}{0,2}\\p{Lu}[\\p{Ll}\\p{M}]*${STREET_END}|${STREET_PREFIX}{1,2}${STREET_WORD})[ \\u00a0]{1,3}\\d{1,3}[A-Za-z]?(?:[ \\u00a0]{0,2},[ \\u00a0]{0,2}(?:\\d{1,2}\\.?[ \\u00a0]{0,2}(?:sal|th|tv|mf)?\\.?|st\\.?(?:[ \\u00a0]{0,2}(?:th|tv|mf)\\.?)?))?(?![\\p{L}\\p{N}])`,
  "gu",
);

function findAddresses(text: string, out: Span[]): void {
  for (const m of text.matchAll(ADDRESS)) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: "address",
      key: `address:${m[0].toLowerCase().replace(/\s+/gu, " ")}`,
      restore: m[0],
    });
  }
}

function findEmails(text: string, out: Span[]): void {
  for (const pattern of EMAIL_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: "email",
        key: `email:${emailKey(m[0])}`,
        restore: m[0],
      });
    }
  }
}

/** Earliest first, longest first, most specific kind first; overlapping finds are dropped. */
function resolveOverlaps(spans: Span[]): Span[] {
  const sorted = [...spans].sort(
    (a, b) =>
      a.start - b.start ||
      b.end - b.start - (a.end - a.start) ||
      PRIORITY[b.kind] - PRIORITY[a.kind],
  );
  const kept: Span[] = [];
  let end = -1;
  for (const span of sorted) {
    if (span.start < end) continue;
    kept.push(span);
    end = span.end;
  }
  return kept;
}

function findStructured(text: string): Span[] {
  const spans: Span[] = [];
  findIbans(text, spans);
  findCards(text, spans);
  findAccounts(text, spans);
  findCprs(text, spans);
  findEmails(text, spans);
  findPhones(text, spans);
  findAddresses(text, spans);
  return resolveOverlaps(spans);
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

// Letters, plus the invisible characters PDF text puts inside words (soft hyphen, zero width).
// A hyphen at a line break ("Øster-⏎gaard") keeps the word together.
const NAME_CHAR = "[\\p{L}\\p{M}\\u00ad\\u200b-\\u200d\\u2060]";
const TOKEN = new RegExp(`${NAME_CHAR}+(?:(?:['’]|-(?:\\r?\\n)?)${NAME_CHAR}+)*`, "gu");
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060]/gu;
/** Between two parts of a name: spaces or a line break, or the dot of an initial ("K. Hansen"). */
const NAME_GAP = /^(?:\.?\s{1,4}|\.)$/u;
const REVERSED_GAP = /^,[ \t\u00a0]{0,3}$/u;
const GENITIVE = ["s", "'s", "’s"];

const words = (list: string) => new Set(list.split(" "));

/** First names that are also everyday words; a lone one is never taken for a person. */
const COMMON_WORD_NAMES = words(
  "per bo hans max liv lone gry jan mai maj kaj tim even mark will may rose april juni juli august sten storm sol dag bent vinter ask tor bill rob sue pat art dawn hope grace joy faith chase frank june kunden investoren stifteren direktøren medarbejderen",
);

/** First names that end in s: "Jens" is not the genitive of "Jen". */
const S_NAMES = words(
  "jens lars mads klaus claus niels nils hans anders thomas tomas nicolas niklas andreas jonas elias lucas lukas tobias mathias matthias matias magnus marcus markus julius linus rasmus kristians agnes inges iris doris",
);

/** Words in front of a name in an owner list ("Køber Peter Holm, CPR 020285-4321"). */
const NAME_LABELS = words(
  "navn ejer ejere aktionær kapitalejer anpartshaver investor medarbejder kontakt køber sælger kunde shareholder owner buyer seller hr fru mr mrs ms dr",
);

const COMPANY_WORDS =
  /(?:^|\s)(?:aps|a\/s|ivs|k\/s|p\/s|i\/s|holding|holdings|invest|investment|investments|capital|kapital|ventures|partners|equity|growth|pension|fond|fonden|fund|foundation|group|gruppen|bank|labs)(?:\s|$)/iu;

interface Token {
  start: number;
  end: number;
  raw: string;
  norm: string;
}

/** For comparing names: case, hyphens and invisible characters do not matter. */
function norm(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(INVISIBLE, "")
    .replace(/-\r?\n?/gu, "");
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const n = norm(m[0]);
    if (n) tokens.push({ start: m.index, end: m.index + m[0].length, raw: m[0], norm: n });
  }
  return tokens;
}

function nameTokens(name: string): string[] {
  return tokenize(name).map((t) => t.norm);
}

function startsUpper(raw: string): boolean {
  const first = raw.replace(INVISIBLE, "").charAt(0);
  return first !== "" && first !== first.toLowerCase();
}

function isCapitalised(raw: string): boolean {
  return startsUpper(raw) && /\p{Ll}/u.test(raw);
}

interface NameEntry {
  tokens: string[];
  keep: boolean;
  key: string;
  /** What `restore` puts back; empty: the text as it was found. */
  restore: string;
  /** A lone first name: only capitalised, never right before another capitalised word. */
  lone: boolean;
  /** "Hansen, Line": the first two parts are separated by a comma. */
  reversed: boolean;
}

interface NameHit {
  entry: NameEntry;
  /** Where the name ends in the text (a genitive "s" stays outside). */
  end: number;
  /** Tokens of the text it covers (initials inside the name included). */
  used: number;
}

function isInitial(text: string, token: Token): boolean {
  return token.norm.length === 1 && text.charAt(token.end) === ".";
}

function matchEntry(text: string, tokens: Token[], i: number, entry: NameEntry): NameHit | null {
  const last = entry.tokens.length - 1;
  let t = i;
  let end = -1;
  for (let k = 0; k <= last; k += 1) {
    const want = entry.tokens[k];
    let token = tokens[t];
    if (!token || want === undefined) return null;
    if (k > 0) {
      const previous = tokens[t - 1];
      const gap = entry.reversed && k === 1 ? REVERSED_GAP : NAME_GAP;
      if (!previous || !gap.test(text.slice(previous.end, token.start))) return null;
      // Up to two initials inside the name: "Line B. Hansen" is Line Hansen.
      for (let skipped = 0; token.norm !== want && skipped < 2 && isInitial(text, token);) {
        const following: Token | undefined = tokens[t + 1];
        if (!following || !NAME_GAP.test(text.slice(token.end, following.start))) return null;
        t += 1;
        skipped += 1;
        token = following;
      }
    }
    t += 1;
    if (token.norm === want) {
      end = token.end;
      continue;
    }
    if (k !== last) return null;
    const suffix = GENITIVE.find((s) => token.norm === want + s);
    if (!suffix) return null;
    end = token.end - suffix.length;
  }
  if (entry.lone) {
    const token = tokens[i];
    if (!token || !isCapitalised(token.raw)) return null;
    const next = tokens[i + 1];
    const gap = next ? text.slice(token.end, next.start) : "";
    if (next && /^[ \t\u00a0]{1,3}$/u.test(gap) && startsUpper(next.raw)) return null;
  }
  return { entry, end, used: t - i };
}

class NameIndex {
  private readonly byFirst = new Map<string, NameEntry[]>();
  private readonly firstNames: Set<string>;

  constructor(firstNames: Set<string>) {
    this.firstNames = firstNames;
  }

  add(entry: NameEntry): void {
    const first = entry.tokens[0];
    if (first === undefined) return;
    const list = this.byFirst.get(first) ?? [];
    list.push(entry);
    this.byFirst.set(first, list);
  }

  /** The longest entry matching at token i (keep wins a tie). */
  match(text: string, tokens: Token[], i: number): NameHit | null {
    const token = tokens[i];
    if (!token) return null;
    const candidates = [...(this.byFirst.get(token.norm) ?? [])];
    // "Lines aktier": a genitive of a lone first name, unless the word is a first name itself.
    if (!this.firstNames.has(token.norm) && !S_NAMES.has(token.norm)) {
      for (const suffix of GENITIVE) {
        if (token.norm.endsWith(suffix) && token.norm.length > suffix.length + 1) {
          for (const entry of this.byFirst.get(token.norm.slice(0, -suffix.length)) ?? []) {
            if (entry.tokens.length === 1) candidates.push(entry);
          }
        }
      }
    }
    let best: NameHit | null = null;
    for (const entry of candidates) {
      const hit = matchEntry(text, tokens, i, entry);
      if (!hit) continue;
      if (
        !best ||
        hit.used > best.used ||
        (hit.used === best.used && entry.keep && !best.entry.keep)
      ) {
        best = hit;
      }
    }
    return best;
  }
}

/** "Hansen, Line" → "Line Hansen"; "Line Hansen (LH)" → "Line Hansen". */
function cleanName(value: string): string {
  const name = value
    .replace(/\([^)]*\)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const parts = name.split(",").map((p) => p.trim());
  if (parts.length === 2 && parts[0] && parts[1]) return `${parts[1]} ${parts[0]}`;
  return name;
}

/** Any written form of a name will do (case does not matter); a one-word name must look like one. */
function isMaskable(name: string): boolean {
  if (!name || name.length > 80 || /\d/u.test(name)) return false;
  const tokens = tokenize(name);
  if (tokens.length === 0 || tokens.length > 6) return false;
  return tokens.length > 1 || isCapitalised(tokens[0]?.raw ?? "");
}

function variants(tokens: string[]): { tokens: string[]; reversed: boolean }[] {
  const out = [{ tokens, reversed: false }];
  if (tokens.length > 2)
    out.push({ tokens: [tokens[0] ?? "", tokens.at(-1) ?? ""], reversed: false });
  for (const v of [...out]) {
    if (v.tokens.length > 1) {
      out.push({ tokens: [v.tokens.at(-1) ?? "", ...v.tokens.slice(0, -1)], reversed: true });
    }
  }
  return out;
}

/** The one private person a lone first name can stand for; see buildIndex. */
interface FirstOwner {
  key: string;
  restore: string;
}

function buildIndex(dictionary: RedactionDictionary): {
  index: NameIndex;
  keepNames: Set<string>;
  ownerOfFirst: Map<string, FirstOwner | null>;
} {
  const keepNames = new Set<string>();
  const keepFirsts = new Set<string>();
  const firstNames = new Set<string>();
  const keepTokens: string[][] = [];
  for (const name of dictionary.keep) {
    const tokens = nameTokens(cleanName(name));
    if (tokens.length === 0) continue;
    keepNames.add(tokens.join(" "));
    keepFirsts.add(tokens[0] ?? "");
    firstNames.add(tokens[0] ?? "");
    keepTokens.push(tokens);
  }

  const people = dictionary.mask.map((person) =>
    [person.name, ...(person.aliases ?? [])].map(cleanName).filter(isMaskable),
  );
  for (const names of people) for (const name of names) firstNames.add(nameTokens(name)[0] ?? "");

  const index = new NameIndex(firstNames);
  for (const tokens of keepTokens) {
    for (const v of variants(tokens)) {
      index.add({
        tokens: v.tokens,
        keep: true,
        key: "",
        restore: "",
        lone: false,
        reversed: v.reversed,
      });
    }
  }

  const loneFirsts = new Set<string>();
  // Which person each first name belongs to; null when two people share it ("Mikkel Ravn" and
  // "Mikkel Storm"), so a lone "Mikkel" is never tied to either.
  const ownerOfFirst = new Map<string, FirstOwner | null>();
  people.forEach((names, p) => {
    const canonical = names.find((n) => nameTokens(n).length > 1) ?? names[0];
    if (!canonical) return;
    for (const name of names) {
      const tokens = nameTokens(name);
      const first = tokens[0] ?? "";
      loneFirsts.add(first);
      const owner = ownerOfFirst.get(first);
      if (owner === undefined) ownerOfFirst.set(first, { key: `person:${p}`, restore: canonical });
      else if (owner && owner.key !== `person:${p}`) ownerOfFirst.set(first, null);
      if (tokens.length === 1) continue;
      for (const v of variants(tokens)) {
        if (keepNames.has(v.tokens.join(" "))) continue;
        index.add({
          tokens: v.tokens,
          keep: false,
          key: `person:${p}`,
          restore: canonical,
          lone: false,
          reversed: v.reversed,
        });
      }
    }
  });
  // A lone first name gets its own placeholder and comes back exactly as written: "Mikkel" may be
  // another Mikkel than the one in the dictionary.
  for (const first of loneFirsts) {
    if (first.length < 2 || keepFirsts.has(first) || COMMON_WORD_NAMES.has(first)) continue;
    index.add({
      tokens: [first],
      keep: false,
      key: `first:${first}`,
      restore: "",
      lone: true,
      reversed: false,
    });
  }
  return { index, keepNames, ownerOfFirst };
}

const CPR_LABEL_TAIL =
  /(?:[\s,;:|()\t-]|cpr(?:-?\s?(?:nr|nummer)\.?)?|personnummer|personnr\.?|f\.\s?d\.)*$/iu;
const CPR_LABEL_HEAD =
  /^(?:[\s,;:|()\t-]|cpr(?:-?\s?(?:nr|nummer)\.?)?|personnummer|personnr\.?)*/iu;
const NAME_WORD =
  "(?:\\p{Lu}[\\p{Ll}\\p{M}]+|\\p{Lu}{2,}|\\p{Lu}\\.)(?:-(?:\\p{Lu}[\\p{Ll}\\p{M}]+|\\p{Lu}{2,}))*";
const NAME_AT_END = new RegExp(`(?:${NAME_WORD}[ \\t\\u00a0]{1,3}){1,4}${NAME_WORD}$`, "u");
const NAME_AT_START = new RegExp(`^(?:${NAME_WORD}[ \\t\\u00a0]{1,3}){1,4}${NAME_WORD}`, "u");

/** A name on the same line as a CPR number, right before it or right after it. */
function namesNextToCprs(text: string, spans: Span[]): string[] {
  const found: string[] = [];
  for (const span of spans) {
    if (span.kind !== "cpr") continue;
    const line = text.lastIndexOf("\n", span.start - 1) + 1;
    const before = text.slice(Math.max(line, span.start - 120), span.start);
    let name = before.replace(CPR_LABEL_TAIL, "").match(NAME_AT_END)?.[0];
    if (!name) {
      const lineEnd = text.indexOf("\n", span.end);
      const after = text.slice(
        span.end,
        lineEnd === -1 ? span.end + 120 : Math.min(lineEnd, span.end + 120),
      );
      name = after.replace(CPR_LABEL_HEAD, "").match(NAME_AT_START)?.[0];
    }
    if (name && !COMPANY_WORDS.test(name)) found.push(name);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// The redactor
// ---------------------------------------------------------------------------------------------

/** "[Person 1]" already in the input would be restored to a real value: make it "(Person 1)". */
function neutralise(text: string): string {
  return text.replace(PLACEHOLDER, (whole) => `(${whole.slice(1, -1)})`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Applies fn to every string, object keys included. Anything that is not text, a number, a
 * boolean, an array or a plain object is refused: bytes, Maps or class instances would otherwise
 * pass unmasked without anyone noticing (closed on doubt, like the ZDR check).
 */
function mapJson(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => mapJson(item, fn));
  if (!isPlainObject(value)) {
    const type = Object.prototype.toString.call(value).slice(8, -1);
    throw new TypeError(
      `Maskeringen kan kun læse tekst, tal og almindelige objekter, ikke ${type}. Lav det om til tekst først.`,
    );
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const mapped = fn(key);
    if (Object.hasOwn(out, mapped)) {
      throw new Error("Maskeringen gav to ens nøgler i samme objekt. Kaldet er stoppet.");
    }
    out[mapped] = mapJson(item, fn);
  }
  return out;
}

export function createRedactor(dictionary: RedactionDictionary = { mask: [], keep: [] }): Redactor {
  const { index, keepNames, ownerOfFirst } = buildIndex(dictionary);
  const discovered = new Set<string>();
  /** Dictionary persons named in full in this call, so a lone first name can join them. */
  const named = new Set<string>();
  /** Bare 8-digit numbers found next to a person or an e-mail in this call. */
  const contactPhones = new Set<string>();
  /** First names of people found next to a CPR number in this redactor's calls. */
  const foundFirsts = new Set<string>();
  const structuredByText = new Map<string, Span[]>();
  const placeholderByKey = new Map<string, string>();
  const restoreByPlaceholder = new Map<string, string>();
  const next: Record<RedactionKind, number> = {
    person: 0,
    email: 0,
    phone: 0,
    cpr: 0,
    account: 0,
    iban: 0,
    card: 0,
    address: 0,
  };

  function structuredOf(text: string): Span[] {
    let spans = structuredByText.get(text);
    if (!spans) {
      spans = findStructured(text);
      structuredByText.set(text, spans);
    }
    return spans;
  }

  function containsKept(tokens: string[]): boolean {
    for (let a = 0; a < tokens.length; a += 1) {
      for (let b = a + 2; b <= tokens.length; b += 1) {
        if (keepNames.has(tokens.slice(a, b).join(" "))) return true;
      }
    }
    return false;
  }

  /** Names next to a CPR number; every ending of two words or more ("Peter Holm" in "Køber
   * Peter Holm"), unless it holds a kept name or starts with a label word. */
  function discover(input: string): void {
    const text = neutralise(input);
    for (const name of namesNextToCprs(text, structuredOf(text))) {
      const parts = name.split(/[ \t\u00a0]+/u);
      for (let from = parts.length - 2; from >= 0; from -= 1) {
        const surface = parts.slice(from).join(" ");
        // Initials are skipped when matching, so "Peter K. Holm" also finds "Peter Holm".
        const tokens = nameTokens(surface).filter((t) => t.length > 1);
        if (tokens.length < 2) continue;
        if (containsKept(tokens)) break;
        if (NAME_LABELS.has(tokens[0] ?? "")) continue;
        const joined = tokens.join(" ");
        if (discovered.has(joined)) continue;
        discovered.add(joined);
        index.add({
          tokens,
          keep: false,
          key: `found:${joined}`,
          restore: surface,
          lone: false,
          reversed: false,
        });
      }
    }
  }

  function placeholder(span: Span, surface: string): string {
    const existing = placeholderByKey.get(span.key);
    if (existing) return existing;
    next[span.kind] += 1;
    const value = `[${LABELS[span.kind]} ${next[span.kind]}]`;
    placeholderByKey.set(span.key, value);
    restoreByPlaceholder.set(value.toLowerCase(), span.restore || surface);
    return value;
  }

  /** The private persons in one text (already neutralised), before any placeholder is given. */
  function nameSpans(text: string, structured: Span[]): Span[] {
    const spans: Span[] = [];
    const tokens = tokenize(text);
    let s = 0;
    for (let i = 0; i < tokens.length;) {
      const token = tokens[i];
      if (!token) break;
      while (s < structured.length && (structured[s]?.end ?? 0) <= token.start) s += 1;
      const blocking = structured[s];
      if (blocking && blocking.start < token.end) {
        i += 1;
        continue;
      }
      const hit = index.match(text, tokens, i);
      if (!hit) {
        i += 1;
        continue;
      }
      const overlaps = structured.some((x) => x.start < hit.end && x.end > token.start);
      if (!hit.entry.keep && !overlaps) {
        spans.push({
          start: token.start,
          end: hit.end,
          kind: "person",
          key: hit.entry.key,
          restore: hit.entry.restore,
        });
      }
      i += hit.used;
    }
    return spans;
  }

  /**
   * Finds the names of every text of one payload and notes who is named in full, before any text
   * is masked: "Line" in the first message and "Line Hansen" in the last are then one person.
   */
  function scan(texts: readonly string[]): Map<string, Span[]> {
    const found = new Map<string, Span[]>();
    for (const input of texts) {
      if (found.has(input)) continue;
      const text = neutralise(input);
      const structured = structuredOf(text);
      const spans = nameSpans(text, structured);
      for (const span of spans) {
        if (span.key.startsWith("person:")) named.add(span.key);
        if (span.key.startsWith("found:")) foundFirsts.add(span.key.slice(6).split(" ")[0] ?? "");
      }
      const contacts = [...spans, ...structured.filter((x) => x.kind === "email")];
      for (const number of contactNumbers(text, contacts, structured)) contactPhones.add(number);
      found.set(input, spans);
    }
    return found;
  }

  /**
   * A lone first name that only one person in the dictionary has, and that person is named in
   * full in this call or an earlier one of this redactor, is that person: same
   * placeholder, so the model does not take "Line" and "Line Hansen" for two people. It then
   * comes back as the full name. Otherwise it keeps its own placeholder and comes back exactly as
   * written, as it does when a person found next to a CPR number shares the first name. Known
   * limit: a Line who is in no data at all is taken for Line Hansen once she is named; the model
   * only sees one person, and the answer names Line Hansen. A chat turn masks its whole history
   * again at every step, so a question that said
   * only "Torben" joins Torben Rask as soon as a search result names him.
   */
  function joinLoneFirst(span: Span): Span {
    if (!span.key.startsWith("first:")) return span;
    const first = span.key.slice("first:".length);
    // "Køber Line Nielsen 010190-1234": another Line is in the call, so "Line" is not tied.
    if (foundFirsts.has(first)) return span;
    const owner = ownerOfFirst.get(first);
    if (!owner || !named.has(owner.key)) return span;
    return { ...span, key: owner.key, restore: owner.restore };
  }

  function mask(input: string, names: Map<string, Span[]>): string {
    const text = neutralise(input);
    const structured = structuredOf(text);
    const people = (names.get(input) ?? nameSpans(text, structured)).map(joinLoneFirst);
    const spans: Span[] = [...structured, ...people];
    // A contact number is masked wherever it stands in the call, not only next to the name.
    if (contactPhones.size > 0) {
      const taken = new SpanCursor(spans);
      for (const m of text.matchAll(BARE_EIGHT)) {
        const start = m.index;
        const end = start + m[0].length;
        if (!contactPhones.has(m[0])) continue;
        if (overlapsAny(taken, start, end) || isFigureOrRegistry(text, start, end)) continue;
        spans.push({ start, end, kind: "phone", key: `phone:${m[0]}`, restore: m[0] });
      }
    }
    spans.sort((a, b) => a.start - b.start);
    let out = "";
    let cursor = 0;
    for (const span of spans) {
      const surface = text.slice(span.start, span.end);
      out += text.slice(cursor, span.start) + placeholder(span, surface);
      cursor = span.end;
    }
    return out + text.slice(cursor);
  }

  function restore(text: string): string {
    return text.replace(PLACEHOLDER, (whole, label: string, n: string) => {
      const kind = label.toLowerCase() === "email" ? "E-mail" : label;
      const value = restoreByPlaceholder.get(`[${kind} ${Number(n)}]`.toLowerCase());
      return value ?? whole;
    });
  }

  return {
    redact(text) {
      discover(text);
      return mask(text, scan([text]));
    },
    redactAll(texts) {
      for (const text of texts) discover(text);
      const names = scan(texts);
      return texts.map((text) => mask(text, names));
    },
    redactJson<T>(value: T): T {
      // First every string (keys too) for names next to CPR numbers and for who is named in
      // full, then the masking.
      const texts: string[] = [];
      mapJson(value, (text) => {
        discover(text);
        texts.push(text);
        return text;
      });
      const names = scan(texts);
      return mapJson(value, (text) => mask(text, names)) as T;
    },
    restore,
    restoreJson<T>(value: T): T {
      return mapJson(value, restore) as T;
    },
    counts() {
      return { ...next };
    },
  };
}
