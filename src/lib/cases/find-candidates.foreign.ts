/**
 * "Find selskabet" i et andet lands register (fx Enhetsregisteret for Norge). Brugeren har
 * valgt landet, så der er intet at gætte: et gyldigt registernummer slås op direkte, ellers søges
 * på navnet. Interlect vælger aldrig selv et udenlandsk selskab; brugeren klikker. Uden netværk:
 * registret kommer ind som `adapter`, så flowet kan testes med falske svar.
 */
import { parseCompanyQuery, type CompanyCandidate } from "../analysis/identity-resolve.ts";
import {
  assessIdentity,
  identitySignal,
  normalizeCompanyName,
  type IdentitySignal,
} from "../analysis/identity.ts";
import type {
  ForeignRegistryCountry,
  RegistryAdapter,
  RegistryCompany,
} from "../analysis/registries/types.ts";
import type { Language } from "../i18n/language.ts";
import { translate, type MessageKey, type TranslateVars } from "../i18n/translate.ts";
import type { FindNote, FindResult } from "./find-candidates.core.ts";

export type ForeignFindAdapter = Pick<
  RegistryAdapter,
  | "registryName"
  | "numberLabel"
  | "supportsNameSearch"
  | "configured"
  | "normalizeNumber"
  | "searchByName"
  | "lookupByNumber"
>;

function candidateOf(
  company: RegistryCompany,
  context: { country: ForeignRegistryCountry; countryName: string; numberLabel: string },
  entered: boolean,
  query: string,
): CompanyCandidate {
  const { country } = context;
  const signals: IdentitySignal[] = [];
  if (entered) {
    signals.push(
      identitySignal(
        "registry_number_in_material",
        `${context.numberLabel} ${company.registryNumber}`,
      ),
    );
  } else if (normalizeCompanyName(company.name) === normalizeCompanyName(query)) {
    signals.push(identitySignal("registry_name_exact", company.name));
  }
  if (!company.active) signals.push(identitySignal("registry_inactive", company.status));
  return {
    id: `reg:${country}:${company.registryNumber}`,
    name: company.name,
    cvrNumber: company.registryNumber,
    registryCountry: country,
    website: company.website,
    country: context.countryName,
    city: null,
    foundedYear: null,
    legalForm: null,
    industryText: null,
    status: company.status,
    inactive: !company.active,
    source: "cvr",
    origin: entered ? "entered_cvr" : "registry_name",
    matches: entered
      ? ["cvr"]
      : signals.some((s) => s.key === "registry_name_exact")
        ? ["name"]
        : [],
    assessment: assessIdentity(signals),
  };
}

export async function findForeignCandidates(
  adapter: ForeignFindAdapter,
  input: { country: ForeignRegistryCountry; query: string; language?: Language },
): Promise<FindResult> {
  const language = input.language ?? "da";
  const raw = input.query.trim();
  const notes: string[] = [];
  const noteKeys: FindNote[] = [];
  const addNote = (key: MessageKey, vars?: TranslateVars) => {
    notes.push(translate(language, key, vars));
    noteKeys.push(vars ? { key, vars } : { key });
  };
  const result = (candidates: CompanyCandidate[], registryFailed = false): FindResult => ({
    outcome: candidates.length === 0 ? "none" : candidates.length === 1 ? "unique" : "ambiguous",
    candidates,
    autoSelectedId: null,
    notes,
    noteKeys,
    usedWebLookup: false,
    creditsStopped: false,
    registryFailed,
    websiteRedirect: null,
    query: parseCompanyQuery(raw),
  });
  const vars = { registry: adapter.registryName, label: adapter.numberLabel };
  const context = {
    country: input.country,
    countryName:
      new Intl.DisplayNames([language], { type: "region" }).of(input.country) ?? input.country,
    numberLabel: adapter.numberLabel,
  };
  if (!raw) {
    addNote("intake.note.emptyForeign", vars);
    return result([]);
  }
  if (!adapter.configured()) {
    addNote("intake.note.registryNotSetUp", vars);
    return result([]);
  }
  const number = adapter.normalizeNumber(raw);
  try {
    if (number) {
      const company = await adapter.lookupByNumber(number);
      if (!company) addNote("intake.note.numberMissing", { ...vars, number });
      return result(company ? [candidateOf(company, context, true, raw)] : []);
    }
    if (!adapter.supportsNameSearch) {
      addNote("intake.note.numberOnly", vars);
      return result([]);
    }
    const found = await adapter.searchByName(raw);
    return result(found.map((company) => candidateOf(company, context, false, raw)));
  } catch {
    addNote("intake.note.foreignRegistryDown", vars);
    return result([], true);
  }
}
