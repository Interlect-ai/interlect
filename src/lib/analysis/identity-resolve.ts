/**
 * "hvilket selskab er det?" som ren funktion, uden netværk og uden AI. Samme regler som
 * screeningens trin 0 (B1, `public-research.ts`): Find-trinnet i Opret case og screeningen
 * bruger denne kode, så der ikke findes to sandheder om identitet.
 *
 * Reglerne:
 * - Et CVR-nummer tæller kun, når det består modulus 11 og findes i registret (hits kommer
 *   altid fra et registeropslag; funktionen får aldrig et uverificeret nummer).
 * - Et nummer fra selskabets eget website tæller kun, når registernavnet passer til navnet
 *   eller domænet (ellers er det fx en accelerators nummer).
 * - Kandidater uden en kontrolleret kilde vises aldrig. Kandidater fra en websøgning kan
 *   aldrig vælges automatisk.
 * - Kun ét aktivt, sikkert match (assessIdentity ≥ 0,8) springer valget over; alt andet
 *   viser et menneske kandidaterne.
 */
import {
  assessIdentity,
  domainLabelEqualsName,
  domainMatchesName,
  hostOf,
  identitySignal,
  isValidCvrNumber,
  namesEqual,
  namesMatch,
  normalizeCompanyName,
  registrableDomain,
  type IdentityAssessment,
  type IdentitySignal,
} from "./identity.ts";

import type { RegistryCountry } from "./registries/types.ts";
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";

/** The signals' and rejections' texts in `language`; this file also runs in the browser. */
function say(language: Language | undefined, key: string, vars?: TranslateVars) {
  return translate(language ?? "da", `analysisServer.identity.resolve.${key}` as MessageKey, vars);
}

// ---------------------------------------------------------------------------------------
// Fælles navneregler (bruges også af screeningens trin 0)
// ---------------------------------------------------------------------------------------

export interface NameContext {
  brandName: string;
  /** Navnet, websøgningen fandt (kan afvige fra det indtastede). */
  discoveredName?: string | null;
  legalName?: string | null;
  /** Trin 0's juridiske navn, når det selv har et uafhængigt anker (se `anchorLegalName`). */
  anchoredLegalName?: string | null;
}

/** Passer et registernavn til selskabet? Samme regel som B1 (`namesMatch` mod alle kendte navne). */
export function buildNameAgrees(context: NameContext): (registryName: string) => boolean {
  return (registryName) =>
    namesMatch(registryName, context.brandName) ||
    Boolean(context.discoveredName && namesMatch(registryName, context.discoveredName)) ||
    Boolean(context.legalName && namesMatch(registryName, context.legalName)) ||
    Boolean(context.anchoredLegalName && namesMatch(registryName, context.anchoredLegalName));
}

/**
 * Trin 0's juridiske navn tæller kun, når det selv passer til et uafhængigt anker
 * (brandnavnet, det fundne navn eller domænet). Ellers kunne decket "gå god for" sit eget CVR.
 */
export function anchorLegalName(input: {
  extractedLegalName: string | null | undefined;
  brandName: string;
  discoveredName?: string | null;
  websiteHost?: string | null;
}): string | null {
  const legal = input.extractedLegalName;
  if (!legal) return null;
  const anchored =
    namesMatch(legal, input.brandName) ||
    Boolean(input.discoveredName && namesMatch(legal, input.discoveredName)) ||
    Boolean(input.websiteHost && domainMatchesName(input.websiteHost, legal));
  return anchored ? legal : null;
}

/** Navnesignalerne for et valgt CVR-match: "præcis samme navn" eller "ligner". */
export function cvrNameSignals(input: {
  registryName: string;
  context: NameContext;
  /** Nummeret stod i casens eget materiale (så tæller trin 0's juridiske navn ikke som bevis). */
  fromMaterial: boolean;
  language?: Language;
}): IdentitySignal[] {
  const { registryName, context, fromMaterial, language } = input;
  const exact =
    namesEqual(registryName, context.brandName) ||
    Boolean(context.discoveredName && namesEqual(registryName, context.discoveredName)) ||
    Boolean(
      !fromMaterial &&
      context.anchoredLegalName &&
      namesEqual(registryName, context.anchoredLegalName),
    );
  if (exact) {
    return [
      identitySignal("cvr_name_exact", say(language, "nameExactCompany", { name: registryName })),
    ];
  }
  if (buildNameAgrees(context)(registryName)) {
    return [
      identitySignal(
        "cvr_name_matches_brand",
        say(language, "nameLikeCompany", { name: registryName }),
      ),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------------------
// Indtastning: navn eller CVR
// ---------------------------------------------------------------------------------------

export type CompanyQuery =
  | { kind: "empty" }
  | { kind: "cvr"; cvrNumber: string }
  | { kind: "name"; name: string; invalidCvr: boolean };

/** 8 cifre med gyldigt kontrolciffer er et CVR-nummer; alt andet er et navn. */
export function parseCompanyQuery(raw: string): CompanyQuery {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return { kind: "empty" };
  const digits = text
    .replace(/^(?:cvr|vat|dk)[\s.:-]*(?:nr|no|nummer)?[\s.:-]*(?:dk)?[\s-]*/i, "")
    .replace(/[\s.-]/g, "");
  if (/^\d{8}$/.test(digits)) {
    return isValidCvrNumber(digits)
      ? { kind: "cvr", cvrNumber: digits }
      : { kind: "name", name: text, invalidCvr: true };
  }
  return { kind: "name", name: text, invalidCvr: false };
}

const FORM_AT_END =
  /[\s,]+(aps|a\/s|ivs|i\/s|p\/s|k\/s|smba|amba|fmba|a\.m\.b\.a|as|ab|oy|ltd|limited|inc|gmbh|bv)\.?$/i;
const FORMS = ["ApS", "A/S", "IVS"] as const;

/**
 * De stavemåder, registret skal prøves med. Navnefeltet i CVR er kun eksakt match, og
 * selskabsformen står i navnet ("Pleo Technologies A/S"), så vi prøver navnet som indtastet,
 * uden form og med de almindelige former.
 */
export function companyNameVariants(rawName: string): string[] {
  const typed = rawName.trim().replace(/\s+/g, " ");
  if (!typed) return [];
  const base = typed.replace(FORM_AT_END, "").trim() || typed;
  const out = new Set<string>([typed, base]);
  for (const form of FORMS) out.add(`${base} ${form}`);
  return [...out];
}

// ---------------------------------------------------------------------------------------
// Kandidater og afgørelse
// ---------------------------------------------------------------------------------------

export type CandidateOrigin = "entered_cvr" | "website_footer" | "registry_name" | "web_lookup";

/** Et selskab, der er slået op og fundet i CVR (verificeret kilde). */
export interface RegistryHit {
  cvrNumber: string;
  name: string;
  status: string;
  origin: CandidateOrigin;
  /** Domænet, nummeret stod på (kun `website_footer`). */
  host?: string;
  /** Beriget stamdata (kan mangle; vises kun, når den findes). */
  city?: string | null;
  foundedYear?: number | null;
  legalForm?: string | null;
  industryText?: string | null;
}

/** Et selskab uden dansk registernummer, men med en kontrolleret hjemmeside (websøgning). */
export interface VerifiedWebHit {
  name: string;
  website: string;
  country: string | null;
  /** Den side, selskabet blev bekræftet på. */
  sourceUrl: string;
}

export type MatchSignalKey = "name" | "website" | "cvr";

export interface CompanyCandidate {
  id: string;
  name: string;
  /** The registry number: the CVR in Denmark, else the number in `registryCountry`'s register. */
  cvrNumber: string | null;
  /** The register the number belongs to; left out (or "DK") for a Danish CVR. */
  registryCountry?: RegistryCountry;
  website: string | null;
  country: string | null;
  city: string | null;
  foundedYear: number | null;
  legalForm: string | null;
  industryText: string | null;
  status: string | null;
  inactive: boolean;
  source: "cvr" | "web";
  origin: CandidateOrigin;
  /** Hvad kandidaten matcher af det, brugeren gav: vises som "Matcher navn" osv. */
  matches: MatchSignalKey[];
  assessment: IdentityAssessment;
}

export type ResolveOutcome = "unique" | "ambiguous" | "none";

export interface ResolveInput {
  query: CompanyQuery;
  /** Domænet brugeren gav (uden www), ellers null. */
  websiteHost: string | null;
  hits: RegistryHit[];
  webHits?: VerifiedWebHit[];
  /** The language of the signals and rejections; Danish when left out. */
  language?: Language;
}

export interface ResolveResult {
  outcome: ResolveOutcome;
  candidates: CompanyCandidate[];
  /** Kun ved `unique`: kandidaten, der er valgt uden menneskets klik. */
  autoSelected: CompanyCandidate | null;
  /** Hits fra materialet, der ikke blev brugt, og hvorfor (til logning, ikke til visning som fakta). */
  rejected: string[];
}

function isInactive(status: string): boolean {
  return /ophørt|opløst|konkurs|tvangsopløs|slettet|inaktiv|ceased|dissolved/i.test(status);
}

function queryName(query: CompanyQuery): string | null {
  return query.kind === "name" ? query.name : null;
}

function scoreHit(
  hit: RegistryHit,
  input: ResolveInput,
): { candidate: CompanyCandidate | null; rejected: string | null } {
  const name = queryName(input.query);
  const signals: IdentitySignal[] = [];
  const matches = new Set<MatchSignalKey>();
  const hostAgrees = input.websiteHost ? domainMatchesName(input.websiteHost, hit.name) : false;

  if (hit.origin === "entered_cvr") {
    signals.push(
      identitySignal("cvr_entered", say(input.language, "cvrEntered", { cvr: hit.cvrNumber })),
    );
    matches.add("cvr");
  } else if (hit.origin === "website_footer") {
    const agrees =
      (name ? namesMatch(hit.name, name) : false) ||
      (hit.host ? domainMatchesName(hit.host, hit.name) : false) ||
      (input.query.kind === "cvr" && input.query.cvrNumber === hit.cvrNumber);
    if (!agrees) {
      return {
        candidate: null,
        rejected: say(input.language, "cvrOtherCompany", {
          cvr: hit.cvrNumber,
          host: hit.host ?? say(input.language, "theWebsite"),
          name: hit.name,
        }),
      };
    }
    signals.push(
      identitySignal(
        "cvr_in_material",
        say(input.language, "cvrOnWebsite", { cvr: hit.cvrNumber }),
      ),
    );
    matches.add("website");
    matches.add("cvr");
  }

  if (name) {
    if (namesEqual(hit.name, name)) {
      signals.push(
        identitySignal(
          "cvr_name_exact",
          say(input.language, "nameExactEntered", { name: hit.name }),
        ),
      );
      matches.add("name");
    } else if (namesMatch(hit.name, name)) {
      signals.push(
        identitySignal(
          "cvr_name_matches_brand",
          say(input.language, "nameLikeEntered", { name: hit.name }),
        ),
      );
      matches.add("name");
    } else if (hit.origin === "registry_name" || hit.origin === "web_lookup") {
      // Et navnehit skal ligne navnet; ellers er det ikke en kandidat.
      return { candidate: null, rejected: null };
    }
  }
  if (hostAgrees) {
    signals.push(
      identitySignal(
        "domain_matches_brand",
        say(input.language, "domainMatches", { host: input.websiteHost ?? "", name: hit.name }),
      ),
    );
    matches.add("website");
  }
  if (isInactive(hit.status)) {
    signals.push(
      identitySignal("cvr_inactive", say(input.language, "inactive", { status: hit.status ?? "" })),
    );
  }

  return {
    candidate: {
      id: `cvr:${hit.cvrNumber}`,
      name: hit.name,
      cvrNumber: hit.cvrNumber,
      website: hostAgrees ? input.websiteHost : null,
      country: "Danmark",
      city: hit.city ?? null,
      foundedYear: hit.foundedYear ?? null,
      legalForm: hit.legalForm ?? null,
      industryText: hit.industryText ?? null,
      status: hit.status,
      inactive: isInactive(hit.status),
      source: "cvr",
      origin: hit.origin,
      matches: [...matches],
      assessment: assessIdentity(signals),
    },
    rejected: null,
  };
}

/**
 * Samler registerhits til kandidater og afgør, om valget kan springes over. Ren funktion:
 * samme input giver altid samme svar, og den kan efterregnes.
 */
export function resolveCompanyIdentity(input: ResolveInput): ResolveResult {
  const byCvr = new Map<string, CompanyCandidate>();
  const rejected: string[] = [];
  for (const hit of input.hits) {
    if (!isValidCvrNumber(hit.cvrNumber)) {
      rejected.push(say(input.language, "checkDigit", { cvr: hit.cvrNumber }));
      continue;
    }
    const scored = scoreHit(hit, input);
    if (scored.rejected) rejected.push(scored.rejected);
    if (!scored.candidate) continue;
    const existing = byCvr.get(hit.cvrNumber);
    // Samme selskab fra flere kilder: signalerne lægges sammen (hver slags tælles én gang).
    if (existing) {
      const merged = new Map(existing.assessment.signals.map((s) => [s.key, s]));
      for (const signal of scored.candidate.assessment.signals) merged.set(signal.key, signal);
      byCvr.set(hit.cvrNumber, {
        ...existing,
        website: existing.website ?? scored.candidate.website,
        city: existing.city ?? scored.candidate.city,
        foundedYear: existing.foundedYear ?? scored.candidate.foundedYear,
        legalForm: existing.legalForm ?? scored.candidate.legalForm,
        industryText: existing.industryText ?? scored.candidate.industryText,
        matches: [...new Set([...existing.matches, ...scored.candidate.matches])],
        assessment: assessIdentity([...merged.values()]),
      });
    } else {
      byCvr.set(hit.cvrNumber, scored.candidate);
    }
  }

  const webCandidates: CompanyCandidate[] = [];
  const seenWeb = new Set<string>();
  for (const web of input.webHits ?? []) {
    const host = hostOf(web.website);
    if (!host || seenWeb.has(host)) continue;
    if ([...byCvr.values()].some((c) => c.website && hostOf(c.website) === host)) continue;
    const name = queryName(input.query);
    // Et forslag, der ikke ligner det søgte navn, er støj og vises ikke.
    if (name && !namesMatch(web.name, name)) continue;
    seenWeb.add(host);
    const signals: IdentitySignal[] = [
      identitySignal(
        "domain_matches_brand",
        say(input.language, "domainMatches", { host, name: web.name }),
      ),
    ];
    const matches = new Set<MatchSignalKey>(["website"]);
    if (name && namesMatch(web.name, name)) matches.add("name");
    webCandidates.push({
      id: `web:${host}`,
      name: web.name,
      cvrNumber: null,
      website: host,
      country: web.country,
      city: null,
      foundedYear: null,
      legalForm: null,
      industryText: null,
      status: null,
      inactive: false,
      source: "web",
      origin: "web_lookup",
      matches: [...matches],
      assessment: assessIdentity(signals),
    });
  }

  const candidates = [...byCvr.values(), ...webCandidates].sort((a, b) => {
    if (a.inactive !== b.inactive) return a.inactive ? 1 : -1;
    if (a.assessment.confidence !== b.assessment.confidence) {
      return b.assessment.confidence - a.assessment.confidence;
    }
    return a.name.localeCompare(b.name, "da");
  });

  const active = candidates.filter((c) => !c.inactive);
  const only = active.length === 1 ? active[0]! : null;
  const sure =
    only && only.source === "cvr" && only.assessment.status === "confirmed" ? only : null;
  return {
    outcome: sure ? "unique" : candidates.length ? "ambiguous" : "none",
    candidates,
    autoSelected: sure,
    rejected,
  };
}

/**
 * Skal et websøgningsopslag (Sonar) bruges? Kun når CVR ikke gav en afgørelse: 0 eller flere
 * end ét aktivt uafklaret hit. Aldrig, når der er netop ét hit (så skal et menneske bare
 * vælge) eller et sikkert match.
 */
export function shouldUseWebLookup(result: ResolveResult): boolean {
  if (result.outcome === "unique") return false;
  return result.candidates.filter((c) => !c.inactive).length !== 1;
}

/**
 * Er en kandidat fra en websøgning kontrolleret i kode? Enten står det foreslåede CVR-nummer
 * i registret under et navn, der passer, eller også er hjemmesiden hentet, domænet passer til
 * navnet, og siden nævner navnet. En kilde, modellen blot nævnte, er aldrig nok.
 */
export function verifyWebCandidate(input: {
  name: string;
  website: string | null;
  /** Registerhit for det foreslåede CVR-nummer (null = ikke fundet eller ikke foreslået). */
  registryHit: { cvrNumber: string; name: string } | null;
  /** Tekst fra den hentede forside (null = kunne ikke hentes). */
  pageText: string | null;
  /** Værten, siden faktisk blev hentet fra efter viderestillinger (null = ukendt). */
  fetchedHost: string | null;
}): { verified: boolean; via: "registry" | "website" | null } {
  if (input.registryHit && isValidCvrNumber(input.registryHit.cvrNumber)) {
    if (namesMatch(input.registryHit.name, input.name)) return { verified: true, via: "registry" };
  }
  // Et websted bekræfter kun selskabet, når (1) domænets navnedel er netop navnet, (2) siden
  // faktisk blev hentet fra samme registrerbare domæne (ikke et tilfældigt mål efter en
  // viderestilling) og (3) siden nævner navnet.
  const host = hostOf(input.website);
  if (
    host &&
    input.fetchedHost &&
    input.pageText &&
    registrableDomain(input.fetchedHost) === registrableDomain(host) &&
    domainLabelEqualsName(host, input.name)
  ) {
    const wanted = normalizeCompanyName(input.name);
    if (normalizeCompanyName(input.pageText).includes(wanted)) {
      return { verified: true, via: "website" };
    }
  }
  return { verified: false, via: null };
}
