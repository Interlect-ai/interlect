/**
 * (proof test for port P4): which values of the demo team are real (its
 * companies' and people's names, their web addresses and register numbers, and the names only
 * Brain knows), and where one of them shows in a text. Pure; tested in demo-proof-scan.test.ts.
 * The walk through the pages is in t909-demo-proof.ts.
 *
 * Mirrors the demo view's own rules (src/lib/display/display-names.ts) so a hit means "the screen
 * shows what the namer should have swapped": a company name also without its legal form, a
 * person's full name and last name, a name inside a web address, a host with any subdomain, and a
 * register number however it is spaced. A name of one word that only Brain knows, or one of the
 * team's own that is a small word ("TWO AS"), counts only with a capital letter, as the namer reads
 * "two founders" as the ordinary word and "Two" as the name; "strise" or "eToro" always count.
 */
import { companyForms, SMALL_WORDS } from "../../src/lib/display/display-names.ts";
import { hostOf } from "../../src/lib/display/demo-identifiers.ts";

export type TermKind = "company" | "person" | "host" | "number";

export interface Term {
  kind: TermKind;
  /** What is looked for, folded (no accents): a name form, a host or the digits of a number. */
  value: string;
  /** The stored real value it comes from, for the report. */
  source: string;
  /** Only a hit that starts with a capital letter counts (display-names.ts `capital`). */
  capital: boolean;
}

export interface RealCompany {
  name: string | null;
  legal_name: string | null;
  website: string | null;
  domain: string | null;
  domains: readonly string[] | null;
  cvr_number: string | null;
  registry_number: string | null;
}

export interface RealValues {
  companies: readonly RealCompany[];
  /** The team's own people (`people.full_name`). */
  people: readonly string[];
  /**
   * Brain's points that name a company or a person, with their other spellings. `parts`: a real
   * person (Brain's type "person"), whose last name alone is looked for too; an investor written
   * like a person's name ("Business Finland") is looked for only as a whole.
   */
  brainNames: readonly { kind: "company" | "person"; name: string; parts?: boolean }[];
  /** Company names from the decision history file. */
  decisionNames: readonly string[];
  /** Every real name the demo view has an alias for (`display_aliases.real_name`). */
  aliasReals: readonly { kind: "company" | "person"; real: string }[];
}

/**
 * Names that are words of the product itself, so a hit in its own interface text is no leak. Each
 * with the reason; empty until a run shows one.
 */
export const IGNORED_NAMES: ReadonlyMap<string, string> = new Map<string, string>([]);

/** No accents, NFC: "Félix" and "Felix" are one name. */
export const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** What a file or a description writes where it has no name (display-names.server.ts). */
const NO_NAME = new Set([
  "n/a",
  "na",
  "n.a.",
  "-",
  "?",
  "unknown",
  "ukendt",
  "none",
  "ingen",
  "tbd",
]);

/** A usable name: letters, at least three characters, not over the alias table's limit. */
function usableName(value: string): boolean {
  const name = value.trim();
  return (
    name.length >= 3 &&
    name.length <= 300 &&
    /\p{L}/u.test(name) &&
    !NO_NAME.has(name.toLowerCase()) &&
    !IGNORED_NAMES.has(fold(name).toLowerCase())
  );
}

/** Labels that are no brand: second-level domains ("co.uk") and common app hosts. */
const NO_BRAND = new Set([
  "co",
  "com",
  "org",
  "net",
  "ac",
  "gov",
  "www",
  "app",
  "get",
  "try",
  "use",
  "my",
  "go",
]);

/** "veo.co" -> "Veo", "shop.example.co.uk" -> "Example"; null when the label is no brand. */
export function brandOf(host: string): string | null {
  const labels = host.split(".").slice(0, -1);
  while (labels.length > 1 && NO_BRAND.has(labels.at(-1)!)) labels.pop();
  const label = labels.at(-1);
  if (!label || label.length < 3 || NO_BRAND.has(label) || /^\d+$/.test(label)) return null;
  return label[0]!.toUpperCase() + label.slice(1);
}

/** The register number's digits, when it is long enough to point at one company. */
function numberDigits(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}

/** Every real value to look for, each once (folded and in lower case as the key). */
export function buildTerms(values: RealValues): Term[] {
  const terms = new Map<string, Term>();
  // The team's own names come first: a word that is also one of them is matched as strictly as
  // that name, as in the namer.
  const add = (kind: TermKind, value: string, source: string, outside = false) => {
    const folded = fold(value.trim()).replace(/\s+/g, " ");
    const lower = folded.toLowerCase();
    const keyOf = `${kind === "person" || kind === "company" ? "name" : kind}:${lower}`;
    if (terms.has(keyOf)) return;
    const capital =
      (kind === "company" || kind === "person") &&
      !/\s/.test(folded) &&
      /^\p{Lu}/u.test(folded) &&
      (outside || SMALL_WORDS.has(lower));
    terms.set(keyOf, { kind, value: folded, source, capital });
  };
  const company = (real: string | null | undefined, outside = false) => {
    if (!real || !usableName(real)) return;
    for (const form of companyForms(real.trim())) {
      if (usableName(form)) add("company", form, real, outside);
    }
  };
  const person = (real: string | null | undefined, parts = false, outside = false) => {
    if (!real || !usableName(real)) return;
    const name = real.trim();
    add("person", name, name, outside);
    const words = name.split(/\s+/);
    const last = words.at(-1)!;
    // The namer also swaps a last name alone; a short one ("Lee") is left to the full name.
    if (parts && words.length > 1 && last.length >= 4 && /^\p{Lu}/u.test(last)) {
      add("person", last, name, outside);
    }
  };
  for (const row of values.companies) {
    company(row.name);
    company(row.legal_name);
    for (const value of [row.website, row.domain, ...(row.domains ?? [])]) {
      const host = hostOf(value);
      if (!host) continue;
      add("host", host, value!);
      // The brand people write in a sentence is often the domain's name ("Veo" for veo.co, while
      // the company is "Veo Technologies ApS"): that is the company's name too.
      const brand = brandOf(host);
      if (brand) add("company", brand, `${host} (domain)`);
    }
    for (const value of [row.cvr_number, row.registry_number]) {
      const digits = numberDigits(value);
      if (digits) add("number", digits, value!);
    }
  }
  for (const name of values.people) person(name, true);
  for (const name of values.decisionNames) company(name);
  for (const entry of values.brainNames) {
    // Brain also keeps descriptions as company points; without a capital letter it is no name.
    if (entry.kind === "company" && !/\p{Lu}/u.test(entry.name)) continue;
    if (entry.kind === "person") person(entry.name, entry.parts === true, true);
    else company(entry.name, true);
  }
  for (const entry of values.aliasReals) {
    if (entry.kind === "person") person(entry.real, false, true);
    else company(entry.real, true);
  }
  return [...terms.values()];
}

export interface Hit {
  term: Term;
  /** The text as found, with about 60 characters on each side. */
  context: string;
  /** "name", "host", "number" or "address" (a name written inside a web address). */
  how: "name" | "host" | "number" | "address";
}

/** "styles.css?routes=__root__": a file of the app, not a web address (display-names.ts). */
const FILE_HOST =
  /\.(?:css|js|mjs|ts|tsx|map|json|svg|png|jpe?g|gif|webp|woff2?|ico|pdf|pptx?|docx?|xlsx?|csv|txt)(?:[/?#]|$)/i;

/** A web or mail address in running text (a simpler form of display-names.ts's ADDRESS). */
const ADDRESS =
  /(?:[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+|(?<![\p{L}\p{N}.-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?:[/?#][^\s<>"'`]*)?)/giu;

const words = (value: string) =>
  fold(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

export interface Scanner {
  terms: readonly Term[];
  scan(text: string): Hit[];
}

/**
 * One matcher per kind of value, all names in one alternation (longest first), so a whole crawl's
 * text is read a few times instead of once per name.
 */
export function createScanner(terms: readonly Term[]): Scanner {
  const names = terms.filter((t) => t.kind === "company" || t.kind === "person");
  const hosts = terms.filter((t) => t.kind === "host");
  const numbers = terms.filter((t) => t.kind === "number");
  const byName = new Map(names.map((t) => [t.value.toLowerCase(), t]));
  const byHost = new Map(hosts.map((t) => [t.value.toLowerCase(), t]));
  const byNumber = new Map(numbers.map((t) => [t.value, t]));
  const longestFirst = (list: readonly Term[], part: (t: Term) => string) =>
    [...list].sort((a, b) => b.value.length - a.value.length).map(part);

  // A name with an optional genitive ("Veos", "Veo's"); the next character is no letter or digit.
  const nameRe = names.length
    ? new RegExp(
        `(?<![\\p{L}\\p{N}])(${longestFirst(names, (t) => escapeRegex(t.value).replace(/ /g, "\\s+")).join("|")})(?:['’]?s)?(?![\\p{L}\\p{N}])`,
        "giu",
      )
    : null;
  // A host with any subdomain ("app.veo.co"), not part of a longer host ("veo.com", "veo.co.uk").
  const hostRe = hosts.length
    ? new RegExp(
        `(?<![\\p{L}\\p{N}-])(${longestFirst(hosts, (t) => escapeRegex(t.value)).join("|")})(?![\\p{L}\\p{N}-]|\\.[\\p{L}\\p{N}])`,
        "giu",
      )
    : null;
  // The digits however they are spaced ("37 24 08 34", "925 976 105", "1234567-8").
  const numberRe = numbers.length
    ? new RegExp(
        `(?<!\\d)(${longestFirst(numbers, (t) => t.value.split("").join("[\\s.\\-]?")).join("|")})(?!\\d)`,
        "g",
      )
    : null;
  // Names inside an address: their words in a row ("veo-technologies"), or written as one word.
  const nameWords = names
    .map((t) => ({ term: t, words: words(t.value) }))
    .filter((n) => n.words.length > 0 && n.words.join("").length >= 3);

  const context = (text: string, index: number, length: number) =>
    text
      .slice(Math.max(0, index - 60), index + length + 60)
      .replace(/\s+/g, " ")
      .trim();

  return {
    terms,
    scan(raw: string): Hit[] {
      const text = fold(raw);
      const hits: Hit[] = [];
      const at = (index: number, length: number) => context(text, index, length);
      // Addresses first: a name inside one is reported once, as an address (or as the host).
      const addresses = [...text.matchAll(ADDRESS)]
        .filter((m) => m[0].includes("://") || !FILE_HOST.test(m[0]))
        .map((m) => ({ start: m.index, end: m.index + m[0].length, value: m[0], host: false }));
      const inAddress = (index: number) => addresses.find((a) => index >= a.start && index < a.end);
      if (hostRe) {
        for (const match of text.matchAll(hostRe)) {
          const term = byHost.get(match[1]!.toLowerCase());
          if (!term) continue;
          const address = inAddress(match.index);
          if (address) address.host = true;
          hits.push({ term, how: "host", context: at(match.index, match[0].length) });
        }
      }
      if (nameRe) {
        for (const match of text.matchAll(nameRe)) {
          const found = match[1]!;
          const term = byName.get(found.replace(/\s+/g, " ").toLowerCase());
          if (!term || inAddress(match.index)) continue;
          // "Two" is the name, "two" the ordinary word.
          if (term.capital && !/^\p{Lu}/u.test(found)) continue;
          hits.push({ term, how: "name", context: at(match.index, match[0].length) });
        }
      }
      if (numberRe) {
        for (const match of text.matchAll(numberRe)) {
          const term = byNumber.get(match[1]!.replace(/\D/g, ""));
          if (term) hits.push({ term, how: "number", context: at(match.index, match[0].length) });
        }
      }
      for (const address of addresses) {
        if (address.host) continue;
        const tokens = words(address.value);
        const joined = new Set(tokens);
        const matched = nameWords.filter(
          ({ words: name }) =>
            tokens.some((_, i) => name.every((w, j) => tokens[i + j] === w)) ||
            (name.length > 1 && joined.has(name.join(""))),
        );
        // "veo-technologies" is "Veo Technologies", not also "Veo".
        for (const { term, words: name } of matched) {
          const longer = matched.some(
            (other) =>
              other.words.length > name.length &&
              other.words.some((_, i) => name.every((w, j) => other.words[i + j] === w)),
          );
          if (!longer) {
            hits.push({
              term,
              how: "address",
              context: at(address.start, address.end - address.start),
            });
          }
        }
      }
      return hits;
    },
  };
}
