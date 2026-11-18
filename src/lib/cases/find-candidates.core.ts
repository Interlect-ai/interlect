/**
 * Orkestreringen bag "Find selskabet", uden direkte netværk: alle eksterne kald kommer ind
 * som `deps`, så enhedstests kan køre hele flowet med falske CVR-, hjemmeside- og modelsvar.
 * Reglerne for hvem der er et match ligger i `identity-resolve.ts`.
 *
 * Rækkefølge (billigst først): CVR-opslag (eksakt) og forsiden samtidig → CVR fra forsidens
 * footer → stamdata til kortene → først derefter, og kun hvis CVR ikke afgjorde det (0 eller
 * flere end ét uafklaret hit), ét websøgningsopslag, hvis forslag kontrolleres i kode.
 */
import {
  companyNameVariants,
  parseCompanyQuery,
  resolveCompanyIdentity,
  shouldUseWebLookup,
  verifyWebCandidate,
  type CompanyCandidate,
  type CompanyQuery,
  type RegistryHit,
  type ResolveOutcome,
  type VerifiedWebHit,
} from "../analysis/identity-resolve.ts";
import { hostOf } from "../analysis/identity.ts";
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";

export interface RegistryCompany {
  cvrNumber: string;
  name: string;
  status: string;
}

export interface RegistryProfile {
  startDate: string | null;
  industryText: string | null;
  legalFormText: string | null;
  city: string | null;
}

export interface PeekResult {
  host: string;
  text: string;
  cvrNumbers: string[];
}

export interface RawWebHit {
  name: string;
  website: string | null;
  country: string | null;
  cvrNumber: string | null;
}

export interface FindDeps {
  searchNames(names: string[]): Promise<RegistryCompany[]>;
  lookupCvr(cvrNumber: string): Promise<RegistryCompany | null>;
  profile(cvrNumber: string): Promise<RegistryProfile | null>;
  /** `redirectsTo`: the homepage redirects to another domain (not followed). */
  peek(website: string): Promise<PeekResult | { redirectsTo: string } | null>;
  /** Selskabets navn → forslag (betalt, lille). */
  webLookup(name: string): Promise<{
    candidates: RawWebHit[];
    failed: boolean;
    skippedForCredits?: boolean;
    /** The hourly AI limit stopped the search: the limit's own text, shown as a note. */
    skippedForLimit?: string;
  }>;
  /** Hjemmeside → forside-tekst til kontrol af et forslag (null = kunne ikke læses). */
  pageText(website: string): Promise<{ host: string; text: string } | null>;
  /** Normaliserer og validerer brugerens hjemmeside; null = ikke en adresse. */
  websiteHost(raw: string): string | null;
  log?(message: string, detail?: unknown): void;
}

export interface FindInput {
  query: string;
  website: string;
  /** Sproget til `notes` (standard dansk). */
  language?: Language;
}

/** A note as a dictionary key (translated at display time) with its values. */
export interface FindNote {
  key: MessageKey;
  vars?: TranslateVars;
}

export interface FindResult {
  outcome: ResolveOutcome;
  candidates: CompanyCandidate[];
  autoSelectedId: string | null;
  /** Korte noter til brugeren (aldrig rå fejl), på `FindInput.language` (standard dansk). */
  notes: string[];
  /** De samme noter som ordbogsnøgler, så klienten kan vise dem på fondens sprog. */
  noteKeys: FindNote[];
  usedWebLookup: boolean;
  /** The paid web search was skipped because the balance is used up: "Fyld op" is shown. */
  creditsStopped: boolean;
  /** Registeret kunne ikke spørges (så er "ingen fund" ikke et svar). */
  registryFailed: boolean;
  /** Forsiden viderestiller hertil (et andet domæne); Opret case tilbyder "Brug den adresse". */
  websiteRedirect: string | null;
  query: CompanyQuery;
}

async function settled<T>(task: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await task };
  } catch {
    return { ok: false };
  }
}

function yearOf(date: string | null): number | null {
  const year = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isInteger(year) && year > 1800 && year < 2200 ? year : null;
}

export async function findCandidatesCore(deps: FindDeps, input: FindInput): Promise<FindResult> {
  const log = deps.log ?? (() => undefined);
  const query = parseCompanyQuery(input.query);
  const language = input.language ?? "da";
  const notes: string[] = [];
  const noteKeys: FindNote[] = [];
  const addNote = (key: MessageKey, vars?: TranslateVars) => {
    notes.push(translate(language, key, vars));
    noteKeys.push(vars ? { key, vars } : { key });
  };
  let registryFailed = false;
  if (query.kind === "empty") {
    return {
      outcome: "none",
      candidates: [],
      autoSelectedId: null,
      notes: [translate(language, "intake.note.empty")],
      noteKeys: [{ key: "intake.note.empty" }],
      usedWebLookup: false,
      creditsStopped: false,
      registryFailed: false,
      websiteRedirect: null,
      query,
    };
  }
  if (query.kind === "name" && query.invalidCvr) {
    addNote("intake.note.invalidCvr");
  }

  const websiteRaw = input.website.trim();
  const websiteHost = websiteRaw ? deps.websiteHost(websiteRaw) : null;
  if (websiteRaw && !websiteHost) {
    addNote("intake.note.badWebsite");
  }

  const hits: RegistryHit[] = [];

  // Trin 1: registeret (eksakt) og forsiden, samtidig.
  const registryTask =
    query.kind === "cvr"
      ? settled(deps.lookupCvr(query.cvrNumber).then((c) => (c ? [c] : [])))
      : settled(deps.searchNames(companyNameVariants(query.name)));
  const peekTask = websiteHost ? settled(deps.peek(websiteRaw)) : Promise.resolve(null);
  const [registry, peek] = await Promise.all([registryTask, peekTask]);

  if (!registry.ok) {
    registryFailed = true;
    log("registry lookup failed");
  } else {
    for (const company of registry.value) {
      hits.push({
        ...company,
        origin: query.kind === "cvr" ? "entered_cvr" : "registry_name",
      });
    }
    if (query.kind === "cvr" && registry.value.length === 0) {
      addNote("intake.note.cvrMissing", { cvr: query.cvrNumber });
    }
  }

  // Trin 2: CVR i forsidens footer (opslag kun for numre, der består kontrolcifferet).
  let peekedHost: string | null = null;
  let websiteRedirect: string | null = null;
  if (websiteHost) {
    const peeked = peek && peek.ok ? peek.value : null;
    if (peeked && "redirectsTo" in peeked) {
      websiteRedirect = peeked.redirectsTo;
      addNote("intake.note.websiteRedirects", {
        host: websiteHost,
        target: hostOf(websiteRedirect) ?? websiteRedirect,
      });
    } else if (peeked) {
      const page = peeked;
      peekedHost = page.host;
      const footer = await Promise.all(
        page.cvrNumbers.slice(0, 2).map(async (cvrNumber) => ({
          cvrNumber,
          result: await settled(deps.lookupCvr(cvrNumber)),
        })),
      );
      for (const { result } of footer) {
        if (!result.ok) {
          continue;
        }
        if (!result.value) continue;
        hits.push({
          ...result.value,
          origin: "website_footer",
          host: page.host,
        });
      }
    } else {
      addNote("intake.note.websiteUnreadable");
    }
  }

  const resolveWith = (webHits: VerifiedWebHit[]) =>
    resolveCompanyIdentity({
      query,
      websiteHost: peekedHost ?? websiteHost,
      hits,
      webHits,
      language,
    });
  let result = resolveWith([]);
  for (const reason of result.rejected) log(reason);

  // Trin 3: ét websøgningsopslag, kun når CVR ikke afgjorde det, og kun for navne.
  let usedWebLookup = false;
  let creditsStopped = false;
  const verifiedWeb: VerifiedWebHit[] = [];
  if (query.kind === "name" && !registryFailed && shouldUseWebLookup(result)) {
    usedWebLookup = true;
    const lookup = await deps.webLookup(query.name);
    if (lookup.skippedForCredits) {
      creditsStopped = true;
      addNote("intake.note.webSkippedCredits");
    } else if (lookup.skippedForLimit) {
      addNote("intake.note.webSkippedLimit", { message: lookup.skippedForLimit });
    } else if (lookup.failed) log("web lookup failed");
    const checked = await Promise.all(
      lookup.candidates.slice(0, 5).map(async (raw) => {
        const [registryHit, page] = await Promise.all([
          raw.cvrNumber ? settled(deps.lookupCvr(raw.cvrNumber)) : Promise.resolve(null),
          raw.website ? settled(deps.pageText(raw.website)) : Promise.resolve(null),
        ]);
        const registryCompany = registryHit && registryHit.ok ? registryHit.value : null;
        const pageInfo = page && page.ok ? page.value : null;
        const verdict = verifyWebCandidate({
          name: raw.name,
          website: raw.website,
          registryHit: registryCompany,
          pageText: pageInfo?.text ?? null,
          fetchedHost: pageInfo?.host ?? null,
        });
        return { raw, registryCompany, pageInfo, verdict };
      }),
    );
    for (const { raw, registryCompany, pageInfo, verdict } of checked) {
      if (!verdict.verified) continue;
      if (verdict.via === "registry" && registryCompany) {
        // Danske selskaber vises som registerhits (med CVR); resolveren dedupliker på CVR.
        hits.push({ ...registryCompany, origin: "web_lookup" });
      } else if (raw.website && pageInfo) {
        verifiedWeb.push({
          name: raw.name,
          website: raw.website,
          country: raw.country,
          sourceUrl: `https://${pageInfo.host}/`,
        });
      }
    }
    result = resolveWith(verifiedWeb);
  }

  // Trin 4: stamdata til de kort, der vises (by, stiftet, branche). Mangler den, vises kortet uden.
  const shown = result.candidates.slice(0, 6);
  const enriched = await Promise.all(
    shown.map(async (candidate) => {
      if (!candidate.cvrNumber) return candidate;
      const profile = await settled(deps.profile(candidate.cvrNumber));
      if (!profile.ok || !profile.value) return candidate;
      return {
        ...candidate,
        city: candidate.city ?? profile.value.city,
        foundedYear: candidate.foundedYear ?? yearOf(profile.value.startDate),
        legalForm: candidate.legalForm ?? profile.value.legalFormText,
        industryText: candidate.industryText ?? profile.value.industryText,
      };
    }),
  );

  if (registryFailed && enriched.length === 0) addNote("intake.note.registryDown");
  else if (registryFailed) {
    addNote("intake.note.registryPartial");
  }

  return {
    outcome: result.outcome,
    candidates: enriched,
    autoSelectedId: result.autoSelected?.id ?? null,
    notes,
    noteKeys,
    usedWebLookup,
    creditsStopped,
    registryFailed,
    websiteRedirect,
    query,
  };
}
