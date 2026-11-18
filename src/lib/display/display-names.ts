/**
 * Demo view: a team with `funds.demo_view` shows invented display names
 * for companies and people everywhere, while the data underneath stays real (so the registers
 * still give real figures). One control point on the way out: text that leaves the server for a
 * screen passes `apply` (or `applyJson` for a payload, `stream` for a streamed answer). Nothing
 * is written back: the database, the evidence and the model calls keep the real names.
 *
 * Deterministic only: a stored real -> alias list (display_aliases), word-boundary matching,
 * longest name first. Besides the full name it also matches the short forms people use in a
 * sentence: a company without its legal suffix ("Veo Technologies ApS" -> "Veo Technologies"),
 * and a person's first and last name alone when that word belongs to one person only.
 * A name in a compound word is a name too ("Pleo-appen", "Pleo/Veo"). A name of one word that
 * only Brain or a file knows (a competitor, a bank, an investor), and one of the team's own that is
 * a number or a small word ("TWO AS"), is a name only where it is written as one, with a capital
 * letter ("Root", "Two"): in small letters as a word of the sentence it is the ordinary word
 * ("root cause", "two founders", "a two-year runway"); in a file name or a tag it is still
 * the name ("root-deck.pdf", "two_kort", "#two"). Inside a web or mail
 * address a name is written as the alias in one word ("linkedin.com/company/brixen-bio"), so the
 * address stays one word and shows no real name; a host with a real name becomes `.example`, so
 * the link leads nowhere real (the company's own known addresses are swapped before, in
 * demo-identifiers.ts).
 * Pure and tested in display-names.test.ts; loading and seeding is in display-names.server.ts.
 */

export type AliasKind = "company" | "person";

export interface DisplayAlias {
  kind: AliasKind;
  real: string;
  alias: string;
  /**
   * A name only Brain or a file knows, not one of the team's own companies and people:
   * written as one word in small letters in a sentence, it is the ordinary word ("root cause").
   */
  outside?: boolean | undefined;
}

export interface DisplayNamer {
  /** Replaces every known real name in one text. */
  apply(text: string): string;
  /**
   * The other way: the alias a user typed (they only see aliases) back to the real name, so a
   * question reaches the search and the model with names the data knows. Only for input.
   */
  reverse(text: string): string;
  /** Same for every string value in plain objects and arrays (keys and other values are kept). */
  applyJson<T>(value: T): T;
  /** A namer for one streamed answer: `push` chunks as they come, `flush` once at the end. */
  stream(): { push(chunk: string): string; flush(): string };
}

const WORD = /[\p{L}\p{N}]/u;
/** Exactly what `\s` matches, without a regex per character (a stream walks back over a word). */
const isSpace = (code: number) =>
  code === 32 ||
  (code >= 9 && code <= 13) ||
  code === 0xa0 ||
  code === 0x1680 ||
  (code >= 0x2000 && code <= 0x200a) ||
  code === 0x2028 ||
  code === 0x2029 ||
  code === 0x202f ||
  code === 0x205f ||
  code === 0x3000 ||
  code === 0xfeff;
/**
 * A web or mail address in running text: a link with a scheme, a mail address, or a host
 * with an optional path. Non-capturing: it is one alternative of the namer's matcher, tried before
 * a name at the same place. A link stops before punctuation that ends it ("(https://x.dk).").
 */
const ADDRESS = String.raw`(?<![\p{L}\p{N}+.-])[a-z][a-z0-9+.-]*:\/\/[^\s<>"'\x60]*[^\s<>"'\x60.,;:!?)\]]|(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+|(?<![\p{L}\p{N}.-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?:[/?#][^\s<>"'\x60]*)?`;
/** File endings that make "pleo-deck.pdf" a file name in running text, not a web address. */
const FILE_ENDING = /^(?:pdf|pptx?|docx?|xlsx?|csv|txt|png|jpe?g|gif|svg|webp|json|key)$/;
/** How an address may join the words of a name: "maria-holmgaard", "Maria%20Holmgaard". */
const SLUG_JOIN = "(?:[-_.+]|%20)*";
const LEGAL_SUFFIX =
  /[\s,]+(?:ApS|A\/S|IVS|K\/S|P\/S|AB|AS|ASA|Oy|Oyj|GmbH|AG|BV|B\.V\.|NV|SA|SAS|SARL|SIA|UAB|OÜ|Sp\. z o\.o\.|Ltd\.?|Limited|LLC|Inc\.?|Corp\.?|PLC)$/iu;
/**
 * A legal form written before the name ("SIA \"Sonarworks\"", "UAB Vinted"); "AS", "AB" and "SA"
 * only before a quoted name, so initials stay ("AB Testing Ltd").
 */
const LEGAL_PREFIX = /^(?:(?:SIA|UAB|AAS|OÜ)\s+|(?:AS|AB|SA)\s+(?=["'“”„«»‘’]))/u;
const QUOTES = /^["'“”„«»‘’]+|["'“”„«»‘’]+$/gu;
/** A word this short or common is never matched alone as a name. */
const MIN_PART_LENGTH = 4;
/** A name's first letter is a capital one. */
const CAPITAL = /^\p{Lu}/u;
/**
 * Number words and small words a team's own company may be named ("TWO AS"): in small letters in
 * a sentence they are the word ("two founders", "mit firma"), like a name only Brain knows.
 */
// i18n-keep: words the namer looks for in the text, never shown.
export const SMALL_WORDS = new Set([
  ...["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
  ...["eleven", "twelve", "hundred", "thousand", "first", "second", "third"],
  ...["tre", "fire", "fem", "seks", "syv", "sju", "otte", "åtte", "elleve", "tolv"],
  ...["ett", "två", "fyra", "sex", "åtta", "nio", "tio", "hundrede", "tusind", "tusen"],
  ...["mit", "min", "din", "dit", "sin", "sit", "som", "med", "til", "fra", "den", "det"],
  ...["and", "the", "for", "you", "all", "new", "now", "our", "out", "not", "but", "can"],
]);

const norm = (value: string) => value.normalize("NFC").toLowerCase();

/**
 * Countries and regions ("Finland", "Nordic"): a first or last name alone of a person only Brain
 * knows that is one of them is the place in a sentence ("headquartered in Helsinki, Finland"),
 * never matched as a name.
 */
// i18n-keep: words the namer looks for in the text, never shown.
const PLACE_WORDS = new Set([
  ...["denmark", "danmark", "norway", "norge", "sweden", "sverige", "finland", "suomi", "iceland"],
  ...["island", "france", "frankrig", "germany", "tyskland", "netherlands", "holland", "belgium"],
  ...["latvia", "letland", "lithuania", "litauen", "estonia", "estland", "poland", "polen"],
  ...["spain", "spanien", "italy", "italien", "portugal", "ireland", "irland", "austria", "østrig"],
  ...["switzerland", "schweiz", "england", "scotland", "britain", "europe", "europa", "european"],
  ...["nordic", "nordics", "norden", "baltic", "baltics", "baltikum", "scandinavia", "america"],
  ...["canada", "china", "kina", "india", "indien", "japan", "israel", "australia", "singapore"],
]);
/** Words for a public body or an organisation ("Business Finland", "Innovation Fund"). */
// i18n-keep: words the namer looks for in the text, never shown.
const BODY_WORDS = new Set([
  ...["business", "agency", "innovation", "council", "ministry", "authority", "association"],
  ...["government", "commission", "union", "network", "accelerator", "incubator", "centre"],
  ...["center", "society", "trust", "board", "office", "global", "international", "national"],
  ...["state", "public", "styrelsen", "fonden", "rådet", "ministeriet"],
]);

/**
 * A name with a word for a public body or an organisation in it ("Business Finland", "Innovation
 * Fund Denmark") is never a person, even when Brain wrote it like one. A place alone does
 * not decide it: "Israel Englander" and "Anna Holland" are people.
 */
export function namesABody(real: string): boolean {
  return real.split(/[\s-]+/).some((word) => BODY_WORDS.has(norm(word)));
}

/**
 * The name a company goes by, read off its own web address: "Veo Technologies" at veo.co
 * goes by "Veo". Only a first part of the name that is the address's first label counts, so an
 * address never gives a name the company does not carry. `null` when the name is that part already.
 */
export function brandName(real: string, hosts: readonly string[]): string | null {
  const words = companyForms(real).at(-1)!.split(/\s+/).filter(Boolean);
  const plain = (value: string) => slugOf(value).replace(/-/g, "");
  // Every label but the ending: "app.veo.co" and "veo.co.uk" both name "veo".
  const labels = new Set(
    hosts.flatMap((host) => host.split(".").slice(0, -1).map(plain)).filter(Boolean),
  );
  for (let count = 1; count < words.length; count += 1) {
    const prefix = words.slice(0, count).join(" ");
    if (labels.has(plain(prefix))) return prefix;
  }
  return null;
}

interface Pattern {
  /** Lower-case text to find. */
  key: string;
  alias: string;
  /** The real text this pattern stands for, as written in the data. */
  real: string;
  /**
   * One word written with a capital letter in the data, of a name only Brain knows or a small word
   * ("MIT", "Two"): in a sentence matched only where the text writes it with a capital letter too,
   * so the ordinary word ("mit", "two") is left alone.
   */
  capital: boolean;
}

/**
 * A company's name as written, without its legal suffix when it has one, and without a legal form
 * and quotes before it ("SIA \"Sonarworks\"" -> "Sonarworks").
 */
export function companyForms(real: string): string[] {
  const forms = [real];
  const add = (form: string) => {
    const trimmed = form.trim();
    if (trimmed && !forms.includes(trimmed)) forms.push(trimmed);
  };
  const short = real.replace(LEGAL_SUFFIX, "").trim();
  add(short);
  add(short.replace(LEGAL_PREFIX, "").replace(QUOTES, ""));
  return forms;
}

const oneWord = (key: string) => !/\s/.test(key);

/** A word of a sentence: letters, joined at most by a hyphen or an apostrophe ("two-year"). */
const SENTENCE_WORD = /^[\p{L}'’\-–—]+$/u;
/** Punctuation and markdown that open or close a word ("(two", "**root**", "„root“", "root…"). */
const WORD_OPEN = /^[("'“‘«[*_~`„‚¿¡…]+/u;
const WORD_CLOSE = /[)"'”’“‘»\].,;:!?*_~`…]+$/u;

/**
 * The run of non-space characters around `start`..`end`, and whether it is a word of the sentence
 * Letters only, without the punctuation that opens or closes it. Not a file name, a tag
 * or a path ("pleo-deck.pdf", "pleo_kort", "#pleo", ").
 */
function wordAt(text: string, start: number, end: number): { to: number; sentence: boolean } {
  let from = start;
  while (from > 0 && !isSpace(text.charCodeAt(from - 1))) from -= 1;
  let to = end;
  while (to < text.length && !isSpace(text.charCodeAt(to))) to += 1;
  const word = text.slice(from, to).replace(WORD_OPEN, "").replace(WORD_CLOSE, "");
  return { to, sentence: SENTENCE_WORD.test(word) };
}

function personForms(real: string): string[] {
  return [real];
}

/** Which patterns the list gives, longest first; a key two entries share goes to the first. */
export function buildPatterns(aliases: readonly DisplayAlias[]): Pattern[] {
  const byKey = new Map<string, { alias: string; real: string; outside: boolean }>();
  const add = (form: string, alias: string, outside: boolean, real = form) => {
    const key = norm(form).trim().replace(/\s+/g, " ");
    if (key.length < 3) return;
    const seen = byKey.get(key);
    // A word that is also a name of the team's own is matched as strictly as that name.
    if (seen) seen.outside &&= outside;
    else byKey.set(key, { alias, real: real.trim(), outside });
  };
  for (const entry of aliases) {
    if (!entry.real.trim() || !entry.alias.trim()) continue;
    for (const form of entry.kind === "company"
      ? companyForms(entry.real)
      : personForms(entry.real)) {
      add(form, entry.alias, entry.outside === true);
    }
  }
  // A name of two or more words written without its accents ("Joachim Kruger", "Soren
  // Baekgaard"), after every real name so it never takes one's alias; it goes back to the name as
  // written.
  for (const entry of aliases) {
    if (!entry.real.trim() || !entry.alias.trim()) continue;
    const forms = entry.kind === "company" ? companyForms(entry.real) : personForms(entry.real);
    for (const form of forms) {
      if (!/\s/.test(form.trim())) continue;
      for (const spelling of otherSpellings(form, 0)) {
        if (!byKey.has(spelling.trim().replace(/\s+/g, " "))) {
          add(spelling, entry.alias, entry.outside === true, form);
        }
      }
    }
  }
  // A person's first or last name alone, only when exactly one person has that word: one of the
  // team's own people when any of them has it, so a person only Brain knows never takes it away.
  const parts = new Map<string, { own: string[]; outside: string[]; real: string }>();
  const unaccented: { key: string; real: string; alias: string; outside: boolean }[] = [];
  for (const entry of aliases) {
    if (entry.kind !== "person") continue;
    const real = entry.real.trim().split(/\s+/);
    const alias = entry.alias.trim().split(/\s+/);
    if (real.length < 2 || alias.length < 2) continue;
    // Only for names Brain alone knows: "Business Finland", stored as a person before,
    // gives no name parts, and a part that is a country is the place. The team's own people keep
    // every part ("Lars Norden": "Norden" alone stays hidden).
    const brainOnly = entry.outside === true;
    if (brainOnly && real.some((word) => BODY_WORDS.has(norm(word)))) continue;
    const pairs: [string, string][] = [
      [real[0]!, alias[0]!],
      [real[real.length - 1]!, alias[alias.length - 1]!],
    ];
    for (const [realPart, aliasPart] of pairs) {
      if (realPart.length < MIN_PART_LENGTH || (brainOnly && PLACE_WORDS.has(norm(realPart)))) {
        continue;
      }
      const key = norm(realPart);
      const seen = parts.get(key) ?? { own: [], outside: [], real: realPart };
      const list = entry.outside === true ? seen.outside : seen.own;
      if (!list.includes(aliasPart)) list.push(aliasPart);
      parts.set(key, seen);
      // "Kruger" for "Krüger", a long word only, so "Høst" never takes "host".
      for (const spelling of otherSpellings(realPart, SPELLING_MIN_ONE_WORD)) {
        unaccented.push({
          key: spelling,
          real: realPart,
          alias: aliasPart,
          outside: entry.outside === true,
        });
      }
    }
  }
  // After every real part, so a spelling never makes a real part shared and left unhidden.
  for (const spelling of unaccented) {
    if (parts.has(spelling.key) && parts.get(spelling.key)!.real !== spelling.real) continue;
    const seen = parts.get(spelling.key) ?? { own: [], outside: [], real: spelling.real };
    const list = spelling.outside ? seen.outside : seen.own;
    if (!list.includes(spelling.alias)) list.push(spelling.alias);
    parts.set(spelling.key, seen);
  }
  const whole = new Set(byKey.keys());
  for (const [key, seen] of parts) {
    const own = seen.own.length > 0;
    // A whole name that is this word keeps its alias, matched as strictly as an own part.
    if (whole.has(key)) {
      byKey.get(key)!.outside &&= !own;
      continue;
    }
    const aliases = own ? seen.own : seen.outside;
    if (aliases.length !== 1) continue;
    byKey.set(key, { alias: aliases[0]!, real: seen.real, outside: !own });
  }
  return [...byKey.entries()]
    .map(([key, { alias, real, outside }]) => ({
      key,
      alias,
      real,
      capital: oneWord(key) && CAPITAL.test(real) && (outside || SMALL_WORDS.has(key)),
    }))
    .sort((a, b) => b.key.length - a.key.length || a.key.localeCompare(b.key));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** "Brixen Bio" -> "brixen-bio": a name as one word in a web address (and a made-up host). */
export function slugOf(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "company"
  );
}

// A genitive "s" after a name ("Veos grundlæggere") is part of the match and follows the alias.
const genitive = (alias: string, s: string | undefined) =>
  s ? (/s$/i.test(alias) ? alias : `${alias}s`) : alias;

interface AddressParts {
  /** "https://", or nothing. */
  scheme: string;
  /** A mail address's or a link's user part with its "@", or nothing. */
  local: string;
  host: string;
  /** Port, path, query, fragment and anything else after the host. */
  rest: string;
}

/**
 * An address in its parts, or `null` when the match is a word with a dot after all: a missing
 * space ("Pleo.The"), a number ("1.000") or a file name ("pleo-deck.pdf").
 */
function addressParts(address: string): AddressParts | null {
  const [, scheme = "", local = "", host = "", rest = ""] =
    /^((?:[a-z][a-z0-9+.-]*:\/\/)?)((?:[^/?#@]*@)?)([\p{L}\p{N}-]*(?:\.[\p{L}\p{N}-]+)*)([\s\S]*)$/iu.exec(
      address,
    ) ?? [];
  if (!scheme && !local && !rest) {
    const ending = host.slice(host.lastIndexOf(".") + 1);
    if (!/^[a-z]{2,}$/.test(ending) || FILE_ENDING.test(ending)) return null;
  }
  return { scheme, local, host, rest };
}

/** The words of a name, however it is joined: "Maria%20Holmgaard" -> ["maria", "holmgaard"]. */
const wordsOf = (value: string) =>
  norm(value.replace(/%20/gi, " "))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

interface SlugTarget {
  words: string[];
  slug: string;
}

/**
 * The ways an address writes a name's words without its accents: "krüger" as "kruger" or
 * "krueger", "søren" as "soren" or "soeren", "bækgaard" as "baekgaard".
 */
function addressSpellings(words: readonly string[]): string[][] {
  const all = [[...words], words.map(withoutAccents), words.map(accentsSpelledOut)];
  return all.filter(
    (spelling, i) => all.findIndex((other) => other.join("") === spelling.join("")) === i,
  );
}

/** Lower-case text without its accents: "krüger" -> "kruger", "søren" -> "soren". */
function withoutAccents(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l")
    .replace(/[đð]/g, "d")
    .replace(/þ/g, "th")
    .replace(/ı/g, "i")
    .normalize("NFC");
}

/** Lower-case text with its accents spelled out: "krüger" -> "krueger", "søren" -> "soeren". */
function accentsSpelledOut(text: string): string {
  return withoutAccents(
    text
      .replace(/ü/g, "ue")
      .replace(/ö/g, "oe")
      .replace(/ä/g, "ae")
      .replace(/ø/g, "oe")
      .replace(/å/g, "aa"),
  );
}

/** The other ways `text` is written without accents, at least `minLength` letters long. */
function otherSpellings(text: string, minLength: number): string[] {
  const lower = norm(text);
  return [...new Set([withoutAccents(lower), accentsSpelledOut(lower)])].filter(
    (spelling) => spelling !== lower && spelling.replace(/[^\p{L}]/gu, "").length >= minLength,
  );
}

/** A name written without accents only counts when it is two words or a long word. */
const SPELLING_MIN_ONE_WORD = 6;

/**
 * Inside an address: each name in `to` (keyed by its words joined) becomes its slug, however the
 * address joins the words ("maria-holmgaard", "veotechnologies", "?q=veo%20pleo").
 */
function slugSwapper(to: ReadonlyMap<string, SlugTarget>): (part: string) => string {
  if (to.size === 0) return (part) => part;
  // A genitive "s" right after the name ("connecting-with-strises-aml") goes with it.
  const matcher = new RegExp(
    `(?:(?<=%[0-9a-f]{2})|(?<![\\p{L}\\p{N}]))(${[...to.values()]
      .sort((a, b) => b.words.join("").length - a.words.join("").length)
      .map((target) => target.words.map(escapeRegex).join(SLUG_JOIN))
      .join("|")})(s?)(?![\\p{L}\\p{N}])`,
    "giu",
  );
  const swap = (part: string) =>
    part.replace(matcher, (found: string, name: string, s: string) => {
      const slug = to.get(wordsOf(name).join(""))?.slug;
      return slug ? genitive(slug, s || undefined) : found;
    });
  return (part) => {
    if (!part) return part;
    const swapped = swap(part);
    // Letters written as percent codes ("kim_h%C3%B8st"): read them, but only change the address
    // when a name is in it.
    if (!/%[89a-f][0-9a-f]/i.test(swapped)) return swapped;
    const decoded = swapped.replace(/(?:%[89a-f][0-9a-f])+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
    const named = swap(decoded);
    return named === decoded ? swapped : named;
  };
}

interface Replacement {
  index: number;
  end: number;
  out: string;
}

/**
 * Names in running text become what `to` maps them to (a genitive "s" kept), also in a compound
 * word ("Pleo-appen", "Pleo/Veo"); a name in `capital` only where it starts with a capital letter
 * . An address is handed to `inAddress`. One pass over a text: an
 * address is tried before a name at each place, but a name wins where it is the whole address
 * ("Hungry.dk ApS") or runs on past its end ("?q=Veo Technologies ApS"); the address then stops
 * before the name.
 */
function nameReplacer(
  to: ReadonlyMap<string, string>,
  capital: ReadonlySet<string>,
  inAddress: (parts: AddressParts) => string,
): { replacements: (text: string) => Replacement[]; replace: (text: string) => string } {
  const names = [...to.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => escapeRegex(key).replace(/\s+/g, "\\s+"))
    .join("|");
  const name = `(?<![\\p{L}\\p{N}])(${names})(s)?(?![\\p{L}\\p{N}])`;
  const matcher = new RegExp(`(${ADDRESS})|${name}`, "giu");
  const nameAt = new RegExp(name, "iuy");
  const namesOnly = new RegExp(name, "giu");
  /** `inSentence`: whether the match is a word of the sentence, where small letters are the word. */
  const swap = (found: string, s: string | undefined, inSentence?: () => boolean) => {
    const key = norm(found).replace(/\s+/g, " ");
    if (capital.has(key) && !CAPITAL.test(found) && inSentence?.()) return found + (s ?? "");
    return genitive(to.get(key) ?? found, s);
  };
  /** Running-text names only, for a word that only looked like an address ("Pleo.The"). */
  const inWords = (text: string) =>
    text.replace(namesOnly, (_all, found: string, s?: string) => swap(found, s));

  // Only a name with an address character can be all of an address, and one that runs on past it
  // has a space, so it starts within its first word's length of the address's end.
  const dotted = [...to.keys()].some((key) => /[.@:/]/.test(key));
  const head = Math.max(0, ...[...to.keys()].map((key) => key.search(/\s/)));

  /** Where a name starts in the address `from`..`end` that is all of it or runs on past it. */
  const nameInside = (text: string, from: number, end: number): RegExpExecArray | null => {
    for (let at = from; at < end; at += 1) {
      if (at === from ? !dotted : at < end - head || WORD.test(text[at - 1]!)) continue;
      nameAt.lastIndex = at;
      const found = nameAt.exec(text);
      if (found && (at + found[0].length > end || (at === from && at + found[0].length === end))) {
        return found;
      }
    }
    return null;
  };

  const replacements = (text: string): Replacement[] => {
    const out: Replacement[] = [];
    // The word around a match, kept while the next matches are in it (they come in order), so a
    // long run of names without a space is walked once, not once per name.
    let word = { to: -1, sentence: false };
    const inSentence = (start: number, end: number) => {
      if (start >= word.to) word = wordAt(text, start, end);
      return word.sentence;
    };
    // One scan at a time (nothing below scans again), so the matcher's own position is used.
    const scan = matcher;
    scan.lastIndex = 0;
    for (let m = scan.exec(text); m; m = scan.exec(text)) {
      const [all, address, found, s] = m;
      if (address === undefined) {
        const start = m.index;
        const end = start + all.length;
        out.push({ index: start, end, out: swap(found!, s, () => inSentence(start, end)) });
        continue;
      }
      const inside = nameInside(text, m.index, m.index + all.length);
      const end = inside ? inside.index : m.index + all.length;
      if (end > m.index) {
        const piece = text.slice(m.index, end);
        const parts = addressParts(piece);
        out.push({ index: m.index, end, out: parts ? inAddress(parts) : inWords(piece) });
      }
      if (inside) {
        const nameEnd = inside.index + inside[0].length;
        out.push({ index: inside.index, end: nameEnd, out: swap(inside[1]!, inside[2]) });
        scan.lastIndex = nameEnd;
      }
    }
    return out;
  };

  const replace = (text: string): string => {
    let out = "";
    let last = 0;
    for (const r of replacements(text)) {
      out += text.slice(last, r.index) + r.out;
      last = r.end;
    }
    return out + text.slice(last);
  };
  return { replacements, replace };
}

export function createDisplayNamer(aliases: readonly DisplayAlias[]): DisplayNamer {
  const patterns = buildPatterns(aliases);
  if (patterns.length === 0) {
    return {
      apply: (text) => text,
      reverse: (text) => text,
      applyJson: (value) => value,
      stream: () => ({ push: (chunk) => chunk, flush: () => "" }),
    };
  }
  const lookup = new Map(patterns.map((p) => [p.key, p.alias]));
  const capital = new Set(patterns.filter((p) => p.capital).map((p) => p.key));
  // alias -> real: the first pattern of an alias wins (full names are added before short forms).
  const back = new Map<string, string>();
  for (const p of [...patterns].sort((a, b) => b.key.length - a.key.length)) {
    const aliasKey = norm(p.alias).replace(/\s+/g, " ");
    if (!back.has(aliasKey)) back.set(aliasKey, p.real);
  }
  // In an address: the real name -> the alias as one word, and back the alias -> the shortest real
  // form (an address uses the short name: linkedin.com/company/veo-technologies).
  const slugTo = new Map<string, SlugTarget>();
  const slugBack = new Map<string, SlugTarget>();
  for (const p of patterns) {
    const real = wordsOf(p.key);
    if (real.length && !slugTo.has(real.join(""))) {
      slugTo.set(real.join(""), { words: real, slug: slugOf(p.alias) });
    }
    const alias = wordsOf(p.alias);
    const slug = slugOf(p.real);
    const seen = slugBack.get(alias.join(""));
    if (alias.length && (!seen || slug.length < seen.slug.length)) {
      slugBack.set(alias.join(""), { words: alias, slug });
    }
  }
  // Then as an address writes a name without accents ("joachimkruger" for "Joachim Krüger"), never
  // over a real name, and a short word only when long enough ("Høst" is not "host").
  for (const p of patterns) {
    for (const spelling of addressSpellings(wordsOf(p.key)).slice(1)) {
      const long = spelling.length >= 2 || (spelling[0]?.length ?? 0) >= SPELLING_MIN_ONE_WORD;
      if (long && !slugTo.has(spelling.join(""))) {
        slugTo.set(spelling.join(""), { words: spelling, slug: slugOf(p.alias) });
      }
    }
  }
  const slugsIn = slugSwapper(slugTo);
  const slugsBack = slugSwapper(slugBack);
  // A host with a real name is no known address of the company (those are `.example` already, see
  // demo-identifiers.ts): it becomes `.example` too, so the link leads nowhere real.
  const hostIn = (host: string): string => {
    if (/\.example$/i.test(host)) return host;
    const swapped = slugsIn(host);
    if (swapped === host) return host;
    const dot = host.lastIndexOf(".");
    const ending = dot < 0 ? "" : host.slice(dot);
    return ending && swapped.endsWith(ending)
      ? `${swapped.slice(0, -ending.length)}.example`
      : `${swapped}.example`;
  };
  const forward = nameReplacer(
    lookup,
    capital,
    ({ scheme, local, host, rest }) => scheme + slugsIn(local) + hostIn(host) + slugsIn(rest),
  );
  // Typed input: a host is left alone (a made-up one goes back in demo-identifiers.ts), and a name
  // goes back in any case (a search box is often typed in small letters).
  const backward = nameReplacer(
    back,
    new Set(),
    ({ scheme, local, host, rest }) => scheme + slugsBack(local) + host + slugsBack(rest),
  );
  const reverse = (text: string): string => (text ? backward.replace(text.normalize("NFC")) : text);
  const longest = patterns.reduce((n, p) => Math.max(n, p.key.length), 0);

  const apply = (text: string): string => (text ? forward.replace(text.normalize("NFC")) : text);

  const applyJson = <T>(value: T): T => {
    if (typeof value === "string") return apply(value) as T;
    if (Array.isArray(value)) return value.map((item) => applyJson(item)) as T;
    const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
    if (value && (proto === Object.prototype || proto === null)) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = applyJson(item);
      return out as T;
    }
    return value;
  };

  /** How many trailing characters could still grow into a name (or are one, not yet closed). */
  const heldBack = (buffer: string): number => {
    const lower = norm(buffer);
    // A character whose lower case has another length ("İ") would shift the positions: fail
    // closed and hold as much as the longest name could need, from the start of a word.
    if (lower.length !== buffer.length) {
      let from = Math.max(0, buffer.length - longest - 1);
      while (from > 0 && WORD.test(buffer[from - 1]!)) from -= 1;
      return buffer.length - from;
    }
    const from = Math.max(0, buffer.length - longest - 1);
    for (let i = from; i < buffer.length; i += 1) {
      if (i > 0 && WORD.test(buffer[i - 1]!)) continue;
      const tail = lower.slice(i).replace(/\s+/g, " ");
      // A whole name with an "s" waits too: it is the genitive, or the start of another word.
      if (patterns.some((p) => p.key.startsWith(tail) || `${p.key}s` === tail)) {
        return buffer.length - i;
      }
    }
    return 0;
  };

  /**
   * Where a streamed buffer can be cut so that the text before it is named exactly as if the
   * whole answer had come at once: after what could still grow into a name, only after a
   * space (whether a name in a word is a name, part of a web address or of a file name is known
   * only when the whole word is there: "veo" + ".dk", "Pleo" + "-appen"), and never through
   * a name the buffer already shows ("Maria " + "Holmgaard e…" while another name starts
   * "Holmgaard E").
   */
  const cutAt = (buffer: string): number => {
    let cut = buffer.length - heldBack(buffer);
    while (cut > 0 && !isSpace(buffer.charCodeAt(cut - 1))) cut -= 1;
    if (cut === 0) return 0;
    const text = buffer.normalize("NFC");
    // Only a name that crosses the cut matters, and it ends within a few name lengths of it: the
    // rest of a long word (a long link) is not scanned again on every chunk.
    const shown =
      text.length === buffer.length
        ? forward.replacements(text.slice(0, cut + 4 * longest + 64))
        : [];
    for (let moved = true; moved;) {
      moved = false;
      while (cut > 0 && !isSpace(buffer.charCodeAt(cut - 1))) {
        cut -= 1;
        moved = true;
      }
      const through = shown.find((r) => r.index < cut && r.end > cut);
      if (through) {
        cut = through.index;
        moved = true;
      }
    }
    return cut;
  };

  return {
    apply,
    reverse,
    applyJson,
    stream() {
      let buffer = "";
      return {
        push(chunk) {
          // Composed once here (as `apply` does), so a decomposed accent shifts no position.
          buffer = (buffer + chunk).normalize("NFC");
          const cut = cutAt(buffer);
          const ready = buffer.slice(0, cut);
          buffer = buffer.slice(cut);
          return apply(ready);
        },
        flush() {
          const rest = buffer;
          buffer = "";
          return apply(rest);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Invented names. Stable: the same real name in the same team always gets the same alias.
// ---------------------------------------------------------------------------------------------

const COMPANY_FIRST = [
  "Alder",
  "Brixen",
  "Calder",
  "Dovrel",
  "Elmwood",
  "Fennel",
  "Garnet",
  "Halvard",
  "Ivory",
  "Juniper",
  "Kestrel",
  "Lindor",
  "Marlow",
  "Nordale",
  "Oakhurst",
  "Pellam",
  "Quillon",
  "Rowan",
  "Stavik",
  "Tamsin",
  "Umber",
  "Vesper",
  "Willow",
  "Yarrow",
  "Zephyr",
  "Arvik",
  "Borealis",
  "Cinder",
  "Delmar",
  "Everly",
];
const COMPANY_SECOND = [
  "Labs",
  "Systems",
  "Health",
  "Analytics",
  "Robotics",
  "Energy",
  "Logistics",
  "Bio",
  "Cloud",
  "Mobility",
  "Foods",
  "Materials",
  "Software",
  "Networks",
  "Therapeutics",
  "Finance",
  "Security",
  "Learning",
  "Devices",
  "Studio",
];
/** For an investor: "Backed by Kestrel Ventures" reads as the sentence meant it. */
const INVESTOR_SECOND = ["Capital", "Ventures", "Partners", "Invest", "Growth"];
/**
 * Last words that say what kind of organisation a name is ("Sequoia Capital", "Danske Bank",
 * "Burnley FC"): an invented name keeps them, so a sentence about it still reads right.
 */
const KIND_WORDS = new Set([
  "academy",
  "bank",
  "capital",
  "club",
  "college",
  "fc",
  "football",
  "foundation",
  "fund",
  "group",
  "growth",
  "holding",
  "holdings",
  "institute",
  "invest",
  "investments",
  "league",
  "partners",
  "program",
  "rugby",
  "school",
  "soccer",
  "trade",
  "university",
  "vc",
  "venture",
  "ventures",
]);
const PERSON_FIRST = [
  "Elin",
  "Marek",
  "Saga",
  "Tobias",
  "Ines",
  "Anders",
  "Noor",
  "Viktor",
  "Linnea",
  "Jonas",
  "Amara",
  "Henrik",
  "Sofia",
  "Emil",
  "Freja",
  "Lukas",
  "Mira",
  "Oskar",
  "Thea",
  "Casper",
  "Ida",
  "Rasmus",
  "Nora",
  "Felix",
  "Maja",
  "Dario",
  "Selma",
  "Anton",
  "Livia",
  "Magnus",
];
const PERSON_LAST = [
  "Vester",
  "Lindqvist",
  "Brandt",
  "Okafor",
  "Halloran",
  "Duvall",
  "Nygaard",
  "Castell",
  "Ravn",
  "Solberg",
  "Marchetti",
  "Winther",
  "Aldous",
  "Berglund",
  "Kessler",
  "Ostrand",
  "Pelletier",
  "Rasmussen",
  "Thorne",
  "Valdez",
  "Ekblad",
  "Fontaine",
  "Grindal",
  "Havsten",
  "Imaz",
  "Jessen",
  "Korsgaard",
  "Lunde",
  "Moberg",
  "Nyström",
];

function hash(value: string): number {
  // FNV-1a, 32 bit: small, stable and good enough to spread names over short lists.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The last words of a company's name that say what kind it is ("Capital", "Rugby Club"), or "". */
export function kindWords(real: string): string {
  const words = companyForms(real).at(-1)!.split(/\s+/);
  let from = words.length;
  while (from > 1 && KIND_WORDS.has(norm(words[from - 1]!))) from -= 1;
  return words.slice(from).join(" ");
}

/**
 * An invented name for `real`. `taken` holds the aliases and real names already in use in the
 * team; the result is never one of them (a collision steps to the next combination). A company
 * keeps the words that say what kind it is, and an investor sounds like one.
 */
export function inventAlias(
  kind: AliasKind,
  real: string,
  seed: string,
  taken: ReadonlySet<string>,
  opts: { investor?: boolean | undefined } = {},
): string {
  const base = hash(`${seed}|${kind}|${norm(real)}`);
  const tail = kind === "company" ? kindWords(real) : "";
  if (tail) {
    for (let step = 0; step < COMPANY_FIRST.length; step += 1) {
      const candidate = `${COMPANY_FIRST[(base + step) % COMPANY_FIRST.length]} ${tail}`;
      if (!taken.has(norm(candidate))) return candidate;
    }
  }
  const [first, second] =
    kind === "person"
      ? [PERSON_FIRST, PERSON_LAST]
      : [COMPANY_FIRST, opts.investor ? INVESTOR_SECOND : COMPANY_SECOND];
  const total = first.length * second.length;
  for (let step = 0; step < total; step += 1) {
    const index = (base + step * 7919) % total;
    const candidate = `${first[index % first.length]} ${second[Math.floor(index / first.length)]}`;
    if (!taken.has(norm(candidate))) return candidate;
  }
  // Every combination taken: a number counts up until the name is free too (the database lets no
  // two names own one alias, so the same answer again would fail every load).
  for (let n = base % 1000; ; n += 1) {
    const candidate = `${first[base % first.length]} ${second[0]} ${n}`;
    if (!taken.has(norm(candidate))) return candidate;
  }
}
