/**
 * Demo view: besides names, a company's web address and register number point straight at
 * the real company (a link to the register, a domain in a source). This masks them in text that
 * leaves the server for a screen: every known domain becomes `<alias>.example` and every known
 * register number becomes a made-up number of the same shape. Deterministic and stateless (the
 * made-up value follows from the team and the real value, so nothing is stored); nothing is
 * written back. Pure and tested in demo-identifiers.test.ts.
 */

import { companyForms, slugOf, type DisplayNamer } from "./display-names.ts";

export interface DemoCompanyIdentifiers {
  /** The company's invented display name, e.g. "Alder Labs". */
  alias: string;
  website: string | null;
  domains: readonly string[];
  /** Danish CVR number and other register numbers, as stored. */
  registerNumbers: readonly (string | null | undefined)[];
  /**
   * The company's real names as stored (name, legal name). One that is also its host ("Hungry.dk
   * ApS") stays a name where it is used as one, so the namer gives it the invented name.
   */
  names?: readonly (string | null | undefined)[];
}

export interface IdentifierMasker {
  apply(text: string): string;
  /** The made-up addresses and numbers the screen showed, back to the real ones (input only). */
  reverse(text: string): string;
  /** Only an exact made-up register number back to the real one (typed fields). */
  reverseNumber(value: string): string;
  applyJson<T>(value: T): T;
  /** A masker for one streamed text: `push` chunks as they come, `flush` once at the end. */
  stream(): { push(chunk: string): string; flush(): string };
}

const lower = (value: string) => value.normalize("NFC").trim().toLowerCase();

function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** "https://www.Veo.dk/om" -> "veo.dk"; null when it is not a host. */
export function hostOf(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/?#:]/)[0]!
    .replace(/^www\./i, "")
    .toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** A number of the same shape (digits swapped for others, other characters kept), never equal. */
export function fakeRegisterNumber(seed: string, real: string): string {
  let n = hash(`${seed}|${real}`);
  const out = real.replace(/\d/g, (digit) => {
    n = Math.imul(n ^ digit.charCodeAt(0), 0x01000193) >>> 0;
    return String(n % 10);
  });
  if (out !== real) return out;
  return real.replace(/\d/, (digit) => String((Number(digit) + 1) % 10));
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const digitsOf = (value: string) => value.replace(/\D/g, "");

/**
 * Swaps whole hosts: a key, with an optional "www." or other subdomain, not inside a longer word
 * or host; a compound word after it is no host ("veo.dk-sitet"), "veo.dk-evil.com" is.
 * `null` when there is nothing to swap.
 */
function hostSwapper(swap: ReadonlyMap<string, string>): ((text: string) => string) | null {
  if (swap.size === 0) return null;
  const keys = [...swap.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
  const matcher = new RegExp(
    `(?<![\\p{L}\\p{N}.-])(?:[a-z0-9-]+\\.)*(${keys.join("|")})(?![\\p{L}\\p{N}])(?!\\.[\\p{L}\\p{N}])(?!-[\\p{L}\\p{N}-]*\\.[\\p{L}\\p{N}])`,
    "giu",
  );
  return (text) => text.replace(matcher, (_all, host: string) => swap.get(lower(host)) ?? host);
}

/** A space within a number: also a hard one ("12 34", "123 456 789"), never a line break. */
const NUMBER_SPACE = /\p{Zs}/u;

/** `swap` on the text between the matches of `guard` only; the matches are kept as they are. */
function between(guard: RegExp, swap: (text: string) => string): (text: string) => string {
  return (text) => {
    let out = "";
    let last = 0;
    for (const m of text.matchAll(guard)) {
      out += swap(text.slice(last, m.index)) + m[0];
      last = m.index + m[0].length;
    }
    return out + swap(text.slice(last));
  };
}

/**
 * Where a register number's digits can stand without being one: an id ("abcd2024-1105-…") and a
 * date, also in a timestamp ("2024-11-05T09:12"). Both are host characters only, so the stream
 * holds them back whole (`safeCut`) and decides them as the whole text does.
 */
const NOT_A_NUMBER =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?<!\p{N})\d{4}-\d{2}-\d{2}(?!\p{N})/giu;

/**
 * Swaps whole register numbers, also written with spaces (hard ones too), dots or hyphens between
 * the digits, and written onto text ("DK12345678", "CVR12345678"); the text is kept. Not
 * inside a longer number or word, an id or a date. Keyed by digits.
 */
function numberSwapper(swap: ReadonlyMap<string, string>): ((text: string) => string) | null {
  if (swap.size === 0) return null;
  const flexible = (digits: string) => [...digits].join("[\\p{Zs}.-]?");
  const matcher = new RegExp(
    `(?<!\\p{N})(?:${[...swap.keys()]
      .sort((a, b) => b.length - a.length)
      .map(flexible)
      .join("|")})(?![\\p{L}\\p{N}])`,
    "gu",
  );
  return between(NOT_A_NUMBER, (text) =>
    text.replace(matcher, (found) => swap.get(digitsOf(found)) ?? found),
  );
}

/**
 * `swap`, but not on a company name that looks like a host ("Hungry.dk ApS", "Hungry.dk rejste"),
 * where it is used as a name: not followed by a path, a mail address or more host. Only a form of
 * host characters alone ("Hungry.dk", the short form of "Hungry.dk ApS"), so the stream decides
 * it as the whole text does: `safeCut` holds such a word back whole, and what comes before it only
 * counts as far as the stream holds it back (after "@" or "/" the namer makes the same `.example`
 * host of it).
 */
function outsideNames(
  names: readonly (string | null | undefined)[],
  swap: ((text: string) => string) | null,
): ((text: string) => string) | null {
  const forms = names
    .flatMap((name) => (name?.includes(".") ? companyForms(name.normalize("NFC").trim()) : []))
    .filter((form) => form.includes(".") && /^[\p{L}\p{N}.-]+$/u.test(form))
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);
  if (!swap || forms.length === 0) return swap;
  const guard = new RegExp(
    `(?<![\\p{L}\\p{N}.-])(?:${forms.join("|")})(?![\\p{L}\\p{N}-])(?![/?#@]|\\.[\\p{L}\\p{N}])`,
    "giu",
  );
  return between(guard, swap);
}

/** A host or register-number character: a match never crosses anything else but a space. */
const TOKEN = /[\p{L}\p{N}.-]/u;

/**
 * Where a streamed text can be cut so that what comes before is final: not inside a host or
 * number that the next chunk may still finish, and not on a space between two digits (a number
 * may go on: "12 34 " + "56 78", also with hard spaces). Everything from the cut on is held back.
 */
export function safeCut(buffer: string): number {
  let at = buffer.length;
  for (;;) {
    while (at > 0 && TOKEN.test(buffer[at - 1]!)) at -= 1;
    if (at >= 2 && NUMBER_SPACE.test(buffer[at - 1]!) && /\d/.test(buffer[at - 2]!)) {
      at -= 1;
      continue;
    }
    return at;
  }
}

export function createIdentifierMasker(
  seed: string,
  companies: readonly DemoCompanyIdentifiers[],
): IdentifierMasker {
  const domains = new Map<string, string>();
  const numbers = new Map<string, string>();
  for (const company of companies) {
    const base = slugOf(company.alias);
    // Each host its own made-up one (the website first), so the way back is one to one.
    let count = 0;
    for (const host of [hostOf(company.website), ...company.domains.map(hostOf)]) {
      if (!host || domains.has(host)) continue;
      count += 1;
      domains.set(host, count === 1 ? `${base}.example` : `${base}-${count}.example`);
    }
    for (const number of company.registerNumbers) {
      const real = number?.trim();
      // Short numbers would hit ordinary figures in the text.
      if (real && digitsOf(real).length >= 7 && !numbers.has(real)) {
        numbers.set(real, fakeRegisterNumber(seed, real));
      }
    }
  }
  if (domains.size === 0 && numbers.size === 0) {
    return {
      apply: (text) => text,
      reverse: (text) => text,
      reverseNumber: (value) => value,
      applyJson: (value) => value,
      stream: () => ({ push: (chunk) => chunk, flush: () => "" }),
    };
  }
  // The way back: each made-up host to its real one, each made-up number to the real one as stored.
  const domainsBack = new Map<string, string>();
  for (const [real, fake] of domains) if (!domainsBack.has(fake)) domainsBack.set(fake, real);
  const swapIn = [
    outsideNames(
      companies.flatMap((company) => company.names ?? []),
      hostSwapper(domains),
    ),
    numberSwapper(new Map([...numbers].map(([real, fake]) => [digitsOf(real), fake]))),
  ];
  const swapBack = [
    hostSwapper(domainsBack),
    numberSwapper(new Map([...numbers].map(([real, fake]) => [digitsOf(fake), real]))),
  ];
  const run = (swappers: typeof swapIn, text: string) =>
    text ? swappers.reduce((out, swap) => (swap ? swap(out) : out), text) : text;
  const apply = (text: string): string => run(swapIn, text);
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
  const exactBack = new Map([...numbers].map(([real, fake]) => [fake, real]));
  return {
    apply,
    reverse: (text) => run(swapBack, text),
    reverseNumber: (value) => exactBack.get(value.trim()) ?? value,
    applyJson,
    stream() {
      let buffer = "";
      return {
        push(chunk) {
          buffer += chunk;
          const cut = safeCut(buffer);
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

/**
 * The team's whole demo view as one namer: web addresses and register numbers first, then
 * names (the company's known hosts are `.example` before the namer writes the names left in an
 * address as one word; it leaves `.example` hosts alone). Back the other way: names first
 * (a host stays as typed), then the made-up hosts and numbers. For the Brain paths that pass text
 * on themselves: chat threads, the streamed answer, web proposals.
 */
export function withIdentifiers(namer: DisplayNamer, masker: IdentifierMasker): DisplayNamer {
  return {
    apply: (text) => namer.apply(masker.apply(text)),
    reverse: (text) => masker.reverse(namer.reverse(text)),
    applyJson: (value) => namer.applyJson(masker.applyJson(value)),
    stream() {
      const identifiers = masker.stream();
      const names = namer.stream();
      return {
        push: (chunk) => names.push(identifiers.push(chunk)),
        flush: () => names.push(identifiers.flush()) + names.flush(),
      };
    },
  };
}
