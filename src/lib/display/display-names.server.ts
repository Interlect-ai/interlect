import type { SupabaseClient } from "@supabase/supabase-js";
import {
  brandName,
  companyForms,
  createDisplayNamer,
  inventAlias,
  kindWords,
  namesABody,
  type AliasKind,
  type DisplayAlias,
  type DisplayNamer,
} from "./display-names.ts";
import {
  createIdentifierMasker,
  hostOf,
  withIdentifiers,
  type IdentifierMasker,
} from "./demo-identifiers.ts";

/**
 * Demo view of one team: the namer that turns real names into the team's invented ones,
 * or `null` when the team does not use the demo view (then nothing is touched). Built with the
 * service role, every query scoped to the team.
 *
 * Fails closed: when the team uses the demo view and its aliases cannot be loaded or made, this
 * throws, so a screen never shows the real names by accident.
 */
const PAGE = 1000;

type Row = Record<string, unknown>;

async function allRows(
  label: string,
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    // i18n-keep: carries the database's own message, so userMessage shows the fallback.
    if (error) throw new Error(`Demovisningen (${label}) kunne ikke hentes: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const key = (value: string) => value.normalize("NFC").trim().toLowerCase();

interface Missing {
  kind: AliasKind;
  real: string;
  /** The real name this one shares its alias with (a company's legal name and brand name). */
  sameAs?: string | undefined;
  /** An investor's invented name sounds like one ("Kestrel Ventures"). */
  investor?: boolean | undefined;
}

/**
 * The Brain points that name a company or a person: founders, competitors, customers,
 * investors and programmes Brain found in documents, registers and on the web. People first, then
 * investors, so a name that is both gets the alias that fits it best.
 */
const BRAIN_NAME_TYPES = ["person", "investor", "company", "fund_vehicle"];

/** A company name that only a file or a site carries so far, with the name it shares an alias with. */
export interface ExtraName {
  name: string;
  sameAs?: string;
}

/** What a file writes where it has no name. */
// i18n-keep: values looked for in a file, never shown.
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

/**
 * An investor Brain has written as a person's name ("Niklas Zennström"): two or three words, each
 * a capital letter and small ones, and no word for a kind of firm or a public body ("Business
 * Finland" is an agency). It gets a person's name, so its first and last name alone are
 * hidden too.
 */
const PERSON_NAME = /^\p{Lu}[\p{Ll}'’-]+(?: \p{Lu}[\p{Ll}'’-]+){1,2}$/u;
const looksLikePerson = (name: string) =>
  PERSON_NAME.test(name) &&
  !kindWords(name) &&
  companyForms(name).length === 1 &&
  !namesABody(name);

/** A company's own web addresses ("veo.co"), from its site and its domains. */
function companyHosts(row: Row): string[] {
  const domains = Array.isArray(row["domains"]) ? row["domains"] : [];
  return [row["website"], row["domain"], ...domains]
    .map((value) => hostOf(typeof value === "string" ? value : null))
    .filter((host): host is string => !!host);
}

/**
 * "Félix Blossier" and "Felix Blossier", or "Veo Technologies" and "Veo Technologies ApS", are one
 * name written two ways: they share one alias.
 */
const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/\s+/g, " ");

interface NameSources {
  companies: Row[];
  people: Row[];
  entities: Row[];
  decisions: Row[];
}

/**
 * Where the team's names are: its companies and people, Brain's points, the decision history. The
 * companies carry their addresses and register numbers too, for the masker.
 */
async function nameSources(service: SupabaseClient, fundId: string): Promise<NameSources> {
  const [companies, people, entities, decisions] = await Promise.all([
    allRows("companies", (from, to) =>
      service
        .from("companies")
        .select(
          "id, name, legal_name, website, domain, domains, cvr_number, registry_country, registry_number",
        )
        .eq("fund_id", fundId)
        .order("id")
        .range(from, to),
    ),
    allRows("people", (from, to) =>
      service
        .from("people")
        .select("id, full_name")
        .eq("fund_id", fundId)
        .order("id")
        .range(from, to),
    ),
    allRows("brain_entities", (from, to) =>
      service
        .from("brain_entities")
        .select("id, type, name, aliases, ref_table, ref_id")
        .eq("fund_id", fundId)
        .eq("status", "active")
        .in("type", BRAIN_NAME_TYPES)
        .order("id")
        .range(from, to),
    ),
    allRows("brain_historical_decisions", (from, to) =>
      service
        .from("brain_historical_decisions")
        .select("id, company_name")
        .eq("fund_id", fundId)
        .order("id")
        .range(from, to),
    ),
  ]);
  return { companies, people, entities, decisions };
}

/**
 * Every company and person name of the team that has no alias yet: from the team's companies and
 * people, from Brain's points and their other spellings, from the decision history, and `extra`
 * company names that only a file or a site carries so far.
 */
function missingNames(
  { companies, people, entities, decisions }: NameSources,
  known: readonly DisplayAlias[],
  extra: readonly ExtraName[],
): Missing[] {
  const have = new Set(known.map((a) => key(a.real)));
  const spelled = new Map<string, { kind: AliasKind; real: string }>();
  const forms = (kind: AliasKind, real: string) =>
    (kind === "company" ? companyForms(real) : [real]).map(fold);
  const spell = (kind: AliasKind, real: string) => {
    for (const form of forms(kind, real)) if (!spelled.has(form)) spelled.set(form, { kind, real });
  };
  for (const alias of known) spell(alias.kind, alias.real);
  const found = new Map<string, Missing>();
  const take = (
    kind: AliasKind,
    value: unknown,
    opts: {
      sameAs?: string | null | undefined;
      investor?: boolean;
      /** A Brain point on a company, or a name from a file: it may be no name at all. */
      check?: "point" | "file" | undefined;
    } = {},
  ) => {
    const real = text(value)?.normalize("NFC");
    // A name over the table's limit is left out rather than failing the whole team's seeding.
    if (!real || real.length > 300 || have.has(key(real)) || found.has(key(real))) return;
    // Brain also keeps descriptions and words as points ("leading payments company",
    // "competitors"): without a capital letter it is no name, and an alias would only make the
    // sentence wrong. A file writes "N/A" or "-" where it has no name.
    if (opts.check === "point" && !/\p{Lu}/u.test(real)) return;
    if (opts.check === "file" && (!/\p{L}/u.test(real) || NO_NAME.has(real.toLowerCase()))) return;
    const twin = forms(kind, real)
      .map((form) => spelled.get(form))
      .find((other) => other?.kind === kind);
    // A name it shares an alias with that got none itself (a description) does not count.
    const sameAs =
      opts.sameAs && (have.has(key(opts.sameAs)) || found.has(key(opts.sameAs)))
        ? opts.sameAs
        : twin?.real;
    found.set(key(real), { kind, real, sameAs, investor: opts.investor });
    spell(kind, real);
  };
  const nameOf = new Map<string, string>();
  for (const row of companies) {
    take("company", row["name"]);
    const brand = text(row["name"]);
    take("company", row["legal_name"], { sameAs: brand });
    // The name it goes by: "Veo" for "Veo Technologies" at veo.co, with the same alias.
    const goesBy = brand ? brandName(brand, companyHosts(row)) : null;
    if (goesBy) take("company", goesBy, { sameAs: brand });
    if (brand) nameOf.set(`companies:${String(row["id"])}`, brand);
  }
  for (const row of people) {
    take("person", row["full_name"]);
    const name = text(row["full_name"]);
    if (name) nameOf.set(`people:${String(row["id"])}`, name);
  }
  const rank = (row: Row) => BRAIN_NAME_TYPES.indexOf(String(row["type"]));
  for (const row of [...entities].sort((a, b) => rank(a) - rank(b))) {
    const name = text(row["name"]);
    const person = row["type"] === "person";
    const investor = row["type"] === "investor";
    const kind: AliasKind =
      person || (investor && name && looksLikePerson(name)) ? "person" : "company";
    // A point on the team's own company or person shares its alias.
    const owner = row["ref_table"]
      ? nameOf.get(`${String(row["ref_table"])}:${String(row["ref_id"])}`)
      : undefined;
    const opts = { investor, check: person || investor ? undefined : ("point" as const) };
    take(kind, name, { ...opts, sameAs: owner });
    const aliases = Array.isArray(row["aliases"]) ? row["aliases"] : [];
    for (const other of aliases) take(kind, other, { ...opts, sameAs: owner ?? name });
  }
  for (const row of decisions) take("company", row["company_name"], { check: "file" });
  for (const entry of extra) take("company", entry.name, { check: "file", sameAs: entry.sameAs });
  return [...found.values()];
}

/**
 * Marks each name only Brain's points know: not a name of the team's own companies and
 * people, nor one a file or a site gave (a file is often typed in small letters), nor one sharing
 * their alias ("Labster ApS" in Brain, "Labster" in the team).
 */
function markOutside(
  aliases: readonly DisplayAlias[],
  sources: NameSources,
  extra: readonly ExtraName[],
): DisplayAlias[] {
  const own = new Set<string>();
  const strict = [
    ...sources.companies.flatMap((row) => {
      const name = text(row["name"]);
      // The name it goes by is the team's own too, also when Brain stored it first.
      return [row["name"], row["legal_name"], name ? brandName(name, companyHosts(row)) : null];
    }),
    ...sources.people.map((row) => row["full_name"]),
    ...sources.decisions.map((row) => row["company_name"]),
    ...extra.map((entry) => entry.name),
  ];
  for (const value of strict) {
    const name = text(value);
    if (name) own.add(key(name));
  }
  const ownAlias = new Set(aliases.filter((a) => own.has(key(a.real))).map((a) => key(a.alias)));
  return aliases.map((a) => ({
    ...a,
    outside: !own.has(key(a.real)) && !ownAlias.has(key(a.alias)),
  }));
}

async function storedAliases(service: SupabaseClient, fundId: string): Promise<DisplayAlias[]> {
  const rows = await allRows("display_aliases", (from, to) =>
    service
      .from("display_aliases")
      .select("kind, real_name, alias")
      .eq("fund_id", fundId)
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({
    kind: row["kind"] === "person" ? "person" : "company",
    real: String(row["real_name"]),
    alias: String(row["alias"]),
  }));
}

interface AliasRow {
  fund_id: string;
  kind: AliasKind;
  real_name: string;
  alias: string;
  owns_alias: boolean;
}

async function saveAliases(service: SupabaseClient, rows: readonly AliasRow[]) {
  if (rows.length === 0) return null;
  const { error } = await service
    .from("display_aliases")
    .upsert(rows, { onConflict: "fund_id,real_key", ignoreDuplicates: true });
  return error as { code?: string; message: string; details?: string | null } | null;
}

function saveFailed(error: { message: string; details?: string | null }): Error {
  // The details name the alias that is taken, so the log says which name is stuck.
  const details = error.details ? ` (${error.details})` : "";
  // i18n-keep: carries the database's own message, so userMessage shows the fallback.
  return new Error(`Demovisningens navne kunne ikke gemmes: ${error.message}${details}`);
}

/** How often a load invents again after another load took the same alias at the same moment. */
const SEED_ATTEMPTS = 3;
/** Postgres' code for a unique violation: here only `display_aliases_one_owner` (0111). */
const UNIQUE_VIOLATION = "23505";

/**
 * Makes an alias for each missing name and returns the team's aliases as stored, which are the
 * truth (another load may have seeded at the same moment). First the names that get an alias of
 * their own: two loads may invent the same alias for two different names at once, and the
 * database lets only one of them through, so the other invents again. Then the names
 * that share an alias (a legal name, another spelling), with the alias the other name has as
 * stored.
 */
async function seed(
  service: SupabaseClient,
  fundId: string,
  before: readonly DisplayAlias[],
  missing: readonly Missing[],
): Promise<DisplayAlias[]> {
  if (missing.length === 0) return [...before];
  let stored = before;
  let wrote = false;
  for (let attempt = 1; ; attempt += 1) {
    const have = new Set(stored.map((a) => key(a.real)));
    // Real names count as taken too, so an alias is never another real name of the team.
    const taken = new Set([...stored.map((a) => key(a.alias)), ...have]);
    for (const entry of missing) taken.add(key(entry.real));
    const owners: AliasRow[] = [];
    for (const entry of missing) {
      if (entry.sameAs || have.has(key(entry.real))) continue;
      const alias = inventAlias(entry.kind, entry.real, fundId, taken, {
        investor: entry.investor,
      });
      taken.add(key(alias));
      owners.push({
        fund_id: fundId,
        kind: entry.kind,
        real_name: entry.real,
        alias,
        owns_alias: true,
      });
    }
    const error = await saveAliases(service, owners);
    if (!error) {
      wrote = owners.length > 0;
      break;
    }
    if (error.code !== UNIQUE_VIOLATION || attempt === SEED_ATTEMPTS) throw saveFailed(error);
    stored = await storedAliases(service, fundId);
  }
  // Read back what was written: a name another load stored first keeps the alias stored.
  if (wrote) stored = await storedAliases(service, fundId);
  if (!missing.some((entry) => entry.sameAs)) return [...stored];

  const byReal = new Map(stored.map((a) => [key(a.real), a.alias]));
  const sharers: AliasRow[] = [];
  // In order: the name an entry shares with is stored or comes before it (see `missingNames`).
  for (const entry of missing) {
    if (!entry.sameAs || byReal.has(key(entry.real))) continue;
    const alias = byReal.get(key(entry.sameAs));
    // The name it shares with is gone: nothing is shown rather than a real name.
    // i18n-keep: an internal message, so userMessage shows the fallback.
    if (!alias) throw new Error(`Demovisningens navne mangler et alias at dele`);
    byReal.set(key(entry.real), alias);
    sharers.push({
      fund_id: fundId,
      kind: entry.kind,
      real_name: entry.real,
      alias,
      owns_alias: false,
    });
  }
  const error = await saveAliases(service, sharers);
  if (error) throw saveFailed(error);
  return sharers.length > 0 ? storedAliases(service, fundId) : [...stored];
}

/** What the demo view of one team is made from. */
interface DemoState {
  aliases: DisplayAlias[];
  /** The team's companies, with their addresses and register numbers. */
  companies: Row[];
}

/**
 * Teams this server has seen with the demo view on. Their names are read alongside the flag, so a
 * screen waits for one round trip to the database instead of two. The flag is still read
 * every time: a stale entry only costs reads that are thrown away.
 */
const demoTeams = new Set<string>();

async function demoFlag(service: SupabaseClient, fundId: string): Promise<boolean> {
  const { data: fund, error } = await service
    .from("funds")
    .select("demo_view")
    .eq("id", fundId)
    .maybeSingle();
  // i18n-keep: carries the database's own message, so userMessage shows the fallback.
  if (error) throw new Error(`Demovisningen kunne ikke slås op: ${error.message}`);
  return !!fund?.demo_view;
}

const readNames = (service: SupabaseClient, fundId: string) =>
  Promise.all([nameSources(service, fundId), storedAliases(service, fundId)]);

/**
 * Everything the team's demo view needs, read once per screen, or `null` when the team does not
 * use it. No cache over several screens: a name added a second ago (a new case, a Brain
 * point) must have its alias before the screen that shows it, so a few seconds' cache would show
 * the real name. The aliases are read again only after this load stored new ones.
 */
async function loadDemoState(
  service: SupabaseClient,
  fundId: string,
  extra: readonly ExtraName[],
): Promise<DemoState | null> {
  const early = demoTeams.has(fundId) ? readNames(service, fundId) : null;
  // When the flag turns out off, these reads are not used, and their failure is no failure.
  early?.catch(() => undefined);
  if (!(await demoFlag(service, fundId))) {
    demoTeams.delete(fundId);
    return null;
  }
  demoTeams.add(fundId);
  const [sources, before] = await (early ?? readNames(service, fundId));
  const stored = await seed(service, fundId, before, missingNames(sources, before, extra));
  return { aliases: markOutside(stored, sources, extra), companies: sources.companies };
}

/**
 * The team's aliases, or `null` when the team does not use the demo view. `extra` are company
 * names only a file or a site carries so far (a site's portfolio, a decision file): they
 * get an alias too before anything is shown.
 */
export async function loadDisplayAliases(
  service: SupabaseClient,
  fundId: string,
  extra: readonly ExtraName[] = [],
): Promise<DisplayAlias[] | null> {
  return (await loadDemoState(service, fundId, extra))?.aliases ?? null;
}

/** The namer of the team, or `null` when the team does not use the demo view. */
export async function loadDisplayNamer(
  service: SupabaseClient,
  fundId: string,
  extra: readonly ExtraName[] = [],
): Promise<DisplayNamer | null> {
  const aliases = await loadDisplayAliases(service, fundId, extra);
  return aliases ? createDisplayNamer(aliases) : null;
}

/**
 * The masker of the team's web addresses and register numbers, from the companies the
 * demo view read. Each company's address and numbers follow its invented name.
 */
function identifierMasker(
  fundId: string,
  namer: DisplayNamer,
  companies: readonly Row[],
): IdentifierMasker {
  return createIdentifierMasker(
    fundId,
    companies.map((row) => ({
      alias: namer.apply(text(row["name"]) ?? ""),
      website: text(row["website"]),
      domains: [
        text(row["domain"]),
        ...(Array.isArray(row["domains"]) ? row["domains"] : []),
      ].filter((d): d is string => typeof d === "string"),
      registerNumbers: [text(row["cvr_number"]), text(row["registry_number"])],
      names: [text(row["name"]), text(row["legal_name"])],
    })),
  );
}

/** The team's namer and masker, both from one read of the team's names. */
async function loadDemoParts(
  service: SupabaseClient,
  fundId: string,
  extra: readonly ExtraName[] = [],
): Promise<{ namer: DisplayNamer; masker: IdentifierMasker } | null> {
  const state = await loadDemoState(service, fundId, extra);
  if (!state) return null;
  const namer = createDisplayNamer(state.aliases);
  return { namer, masker: identifierMasker(fundId, namer, state.companies) };
}

/**
 * The team's whole demo view: web addresses and register numbers first, then names,
 * also on a streamed answer; `null` when the team does not use the demo view. Fails closed, like
 * `loadDisplayAliases` (and `extra` as there). Every path that shows the team's text goes through
 * this one.
 */
export async function loadDemoView(
  service: SupabaseClient,
  fundId: string,
  extra: readonly ExtraName[] = [],
): Promise<DisplayNamer | null> {
  const parts = await loadDemoParts(service, fundId, extra);
  return parts ? withIdentifiers(parts.namer, parts.masker) : null;
}

/**
 * What a server function returns to the screen, in the team's demo view (or untouched when the
 * team does not use it). `extra` are company names in `value` the data does not know yet (see
 * `loadDisplayAliases`). Fails closed, like `loadDisplayAliases`.
 */
export async function inDemoView<T>(
  fundId: string,
  value: T,
  extra: readonly ExtraName[] = [],
): Promise<T> {
  const { getServiceClient } = await import("@/lib/supabase/admin.server");
  const view = await loadDemoView(getServiceClient(), fundId, extra);
  return view ? view.applyJson(value) : value;
}

/**
 * Wraps a server function's handler so that what it returns passes `inDemoView`. The
 * handler's input must carry `fundId`. Use it for every function that sends company or person
 * names to a screen, so the demo view has one place per function and not one per return.
 */
export function withDemoView<A extends { data: { fundId: string } }, R>(
  handler: (args: A) => Promise<R>,
): (args: A) => Promise<R> {
  return async (args) => inDemoView(args.data.fundId, await handler(args));
}

/**
 * A choice among values the server itself sent (a proposed company's domain, a reason text from a
 * file) comes back as the screen showed it. This gives each real value the key the screen's
 * choice is compared with: as the team's demo view shows it, in lower case (the value itself in
 * lower case when the team does not use the demo view). Compare `key(real)` with the choice in
 * lower case, never turn the choice back: two values the demo view shows alike are then chosen
 * together, as the screen showed them. Fails closed, like `loadDisplayAliases`.
 */
export async function loadChoiceKey(
  service: SupabaseClient,
  fundId: string,
): Promise<(real: string) => string> {
  const view = await loadDemoView(service, fundId);
  return (real) => (view ? view.apply(real) : real).toLowerCase();
}

/**
 * Register hits of a search on a company name in `country`'s register. In the team's demo
 * view only the team's own companies are kept, those with the hit's number in that register, and
 * each shows the team's own name for it (the register may spell it otherwise): `withDemoView` then
 * masks name and number, and a number picked goes back (`fromDemoView`). Any other hit would show a
 * real company's name and number, and its number could not go back. All hits when the team does
 * not use the demo view. Fails closed, like `loadDisplayAliases`.
 */
export async function teamRegisterHits<T extends { cvrNumber: string; name: string }>(
  service: SupabaseClient,
  fundId: string,
  country: string,
  hits: readonly T[],
): Promise<T[]> {
  const state = await loadDemoState(service, fundId, []);
  if (!state) return [...hits];
  const digits = (value: unknown) => text(value)?.replace(/\D/g, "") || null;
  const own = new Map<string, string>();
  for (const row of state.companies) {
    const number =
      country === "DK"
        ? digits(row["cvr_number"])
        : row["registry_country"] === country
          ? digits(row["registry_number"])
          : null;
    const name = text(row["legal_name"]) ?? text(row["name"]);
    if (number && name && !own.has(number)) own.set(number, name);
  }
  // Only a number the masker hides too (it leaves short numbers alone).
  const masker = identifierMasker(fundId, createDisplayNamer(state.aliases), state.companies);
  return hits.flatMap((hit) => {
    const name = own.get(hit.cvrNumber.replace(/\D/g, ""));
    return name && masker.apply(hit.cvrNumber) !== hit.cvrNumber ? [{ ...hit, name }] : [];
  });
}

/**
 * What a user typed into a search box, back to the real names the data knows (they only see the
 * invented ones). Untouched when the team does not use the demo view.
 */
export async function fromDemoView(fundId: string, text: string): Promise<string> {
  const { getServiceClient } = await import("@/lib/supabase/admin.server");
  const parts = await loadDemoParts(getServiceClient(), fundId);
  if (!parts) return text;
  // A typed field goes back only when it is exactly a made-up number, never a number inside a
  // sentence: these fields are repeated in error messages, which must not show the real one.
  return parts.masker.reverseNumber(parts.namer.reverse(text));
}
